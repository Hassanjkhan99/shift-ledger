"use server";
// Occurrence write Server Actions (M4 #17) — the client→server write path for the Today command
// center. Writes are Server Actions, NEVER GraphQL mutations (ADR-b, D10). Each action:
//   1. Zod-validates its input (invalid → { status: "validation" }).
//   2. Resolves the authenticated member context for the named org (fail-closed → "unauthorized").
//   3. Runs the domain write inside withTenant() (RLS, D6) — completeOccurrence()/skipOccurrence().
//   4. On success, revalidates the SCOPED RSC cache tags (today:{outletId}, occurrence:{id}) only —
//      not the whole tree. The client reconciles its TanStack cache via the #15 graphqlScopeKey prefix
//      ([org, property?, outlet?, 'graphql', …]); this action returns that scope for it to use.
//
// The heavy write semantics (F2 idempotency, F3 timestamps, F4 transition, threshold eval, fail
// cascade) live in the tested domain lib (complete-occurrence.ts / occurrences.ts); this file is the
// thin, auth+cache glue Next requires to be a Server Action.
import { z } from "zod";
import { headers } from "next/headers";
import { updateTag } from "next/cache";
import type { Prisma } from "../../generated/prisma/client";
import { EvidenceType } from "../../generated/prisma/enums";
import { withTenant, type TenantClient } from "../../lib/db";
import { resolveMemberForOrg, type MemberContext } from "../../lib/http-auth";
import { completeOccurrence, type CompleteOccurrenceResult } from "../../lib/complete-occurrence";
import { skipOccurrence } from "../../lib/occurrences";
import { assertRoleMayTrigger } from "../../lib/permissions";
import { resolveCompletionActor, type ActorConfirmationMethod } from "../../lib/actor-identity";

/** The active-org tenant scope the client uses to invalidate its cached GraphQL reads (#15). */
interface CacheScope {
  org: string;
  outlet: string;
}

/** Every write action returns a serializable discriminated union the #16 optimistic UI reconciles. */
export type WriteActionResult =
  | { status: "unauthorized" }
  | { status: "forbidden"; message: string }
  | { status: "validation"; issues: unknown[] }
  | ({ scope?: CacheScope } & CompleteOccurrenceResult)
  | { status: "skipped"; occurrenceId: string; scope: CacheScope };

const evidenceSchema = z.object({
  type: z.nativeEnum(EvidenceType),
  valueText: z.string().optional(),
  valueNumeric: z.union([z.number(), z.string()]).optional(),
  valueBool: z.boolean().optional(),
  attachmentId: z.string().uuid().optional(),
});

// Shared-tablet actor identity (D8): `session` = the authenticated user; `pin`/`initials` name a
// picked user the server re-verifies for the tablet's outlet (resolveCompletionActor).
const actorSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("session") }),
  z.object({
    method: z.literal("pin"),
    outletId: z.string().uuid(),
    pickedUserId: z.string().uuid(),
    pin: z.string().min(1),
  }),
  z.object({
    method: z.literal("initials"),
    outletId: z.string().uuid(),
    pickedUserId: z.string().uuid(),
    initials: z.string().min(2).max(4),
  }),
]);

const completeInputSchema = z.object({
  organizationId: z.string().uuid(),
  occurrenceId: z.string().uuid(),
  outletId: z.string().uuid(),
  clientSubmissionId: z.string().uuid(),
  intent: z.enum(["complete", "fail"]),
  measuredNumeric: z.union([z.number(), z.string()]).optional(),
  enteredValues: z.record(z.string(), z.unknown()).optional(),
  // Advisory device time (F3). Accept any string; we only convert it when it parses to a real date.
  clientReportedAt: z.string().optional(),
  evidence: z.array(evidenceSchema).optional(),
  reason: z.string().optional(),
  actor: actorSchema.optional(),
});

const skipInputSchema = z.object({
  organizationId: z.string().uuid(),
  occurrenceId: z.string().uuid(),
  outletId: z.string().uuid(),
  reason: z.string().min(1),
});

type CompleteInput = z.infer<typeof completeInputSchema>;

/** Resolve the concrete completion actor (D8) from the request context + optional shared-tablet input. */
async function resolveActor(
  tx: TenantClient,
  ctx: MemberContext,
  input: CompleteInput,
): Promise<{ actorUserId: string; method: ActorConfirmationMethod }> {
  const actor = input.actor ?? { method: "session" as const };
  if (actor.method === "session") {
    return { actorUserId: ctx.userId, method: "session" };
  }
  if (actor.method === "pin") {
    return resolveCompletionActor(tx, {
      method: "pin",
      organizationId: ctx.organizationId,
      outletId: actor.outletId,
      pickedUserId: actor.pickedUserId,
      pin: actor.pin,
      now: new Date(),
    });
  }
  return resolveCompletionActor(tx, {
    method: "initials",
    outletId: actor.outletId,
    pickedUserId: actor.pickedUserId,
    initials: actor.initials,
  });
}

/**
 * Invalidate only the RSC cache tags affected by a write (scoped, not tree-wide, D10/§12.4). Uses
 * Next 16's updateTag — the Server-Action primitive with read-your-own-writes semantics, so the
 * follow-up RSC render sees this write immediately.
 */
function revalidateWrite(occurrenceId: string, outletId: string): void {
  updateTag(`occurrence:${occurrenceId}`);
  updateTag(`today:${outletId}`);
}

/**
 * Complete or fail an occurrence (§11.8). Zod-validated, idempotent (F2), server-authoritative
 * timestamps (F3), status via the F4 choke point, threshold-forced fail + fail cascade — all in the
 * domain lib. Returns a typed result for the #16 optimistic UI.
 */
export async function completeTaskAction(raw: unknown): Promise<WriteActionResult> {
  const parsed = completeInputSchema.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await resolveMemberForOrg(
    (await headers()) as unknown as Headers,
    input.organizationId,
  );
  if (!ctx) return { status: "unauthorized" };

  let result: CompleteOccurrenceResult;
  try {
    result = await withTenant(ctx.organizationId, async (tx) => {
      const actor = await resolveActor(tx, ctx, input);
      return completeOccurrence(tx, {
        organizationId: ctx.organizationId,
        occurrenceId: input.occurrenceId,
        clientSubmissionId: input.clientSubmissionId,
        actorUserId: actor.actorUserId,
        actorRole: ctx.role,
        intent: input.intent,
        actorConfirmationMethod: actor.method,
        measuredNumeric: input.measuredNumeric,
        enteredValuesJson: input.enteredValues as Prisma.InputJsonValue | undefined,
        clientReportedAt:
          input.clientReportedAt && !Number.isNaN(Date.parse(input.clientReportedAt))
            ? new Date(input.clientReportedAt)
            : undefined,
        evidence: input.evidence,
        reason: input.reason,
      });
    });
  } catch (err) {
    // The role guard (assertRoleMayTrigger) and shared-tablet actor guards throw — surface as 403.
    return { status: "forbidden", message: err instanceof Error ? err.message : "forbidden" };
  }

  if (result.status === "ok") {
    revalidateWrite(input.occurrenceId, input.outletId);
    return { ...result, scope: { org: ctx.organizationId, outlet: input.outletId } };
  }
  return result;
}

/**
 * Skip an occurrence (§7.1) — manager-only, mandatory reason. Routed through skipOccurrence()
 * (occurrences.ts → transition(), F4). Skip records no completion, so it carries no idempotency key.
 */
export async function skipTaskAction(raw: unknown): Promise<WriteActionResult> {
  const parsed = skipInputSchema.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await resolveMemberForOrg(
    (await headers()) as unknown as Headers,
    input.organizationId,
  );
  if (!ctx) return { status: "unauthorized" };

  try {
    await withTenant(ctx.organizationId, async (tx) => {
      // Role gate before the transition (the §7.1 who-may-trigger guard is the action's job, #10).
      assertRoleMayTrigger("occurrence", "skip", ctx.role);
      return skipOccurrence(tx, input.occurrenceId, {
        actorUserId: ctx.userId,
        reason: input.reason,
      });
    });
  } catch (err) {
    return { status: "forbidden", message: err instanceof Error ? err.message : "forbidden" };
  }

  revalidateWrite(input.occurrenceId, input.outletId);
  return {
    status: "skipped",
    occurrenceId: input.occurrenceId,
    scope: { org: ctx.organizationId, outlet: input.outletId },
  };
}
