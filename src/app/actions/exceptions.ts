"use server";
// Exceptions + corrective-action Server Actions (#138). Each wraps a tested exceptions.ts edge, gated by
// the §7.2/§7.3 role matrix (assertRoleMayTrigger, F4) with the authenticated session's role, inside
// withTenant() (D6). The edges themselves run every write through transition() so each status change
// writes an activity_log row and the couple-cascades (last CA done → parent resolved; reject → parent
// reopened) happen atomically. Illegal transitions throw and surface as { status: "error" }.
//
// Deferral: §7.3 also lets the ASSIGNED frontline actor mark THEIR OWN corrective action done. That
// row-context exception needs the CA's assignee identity; here markDone is gated to managers by role
// (CORRECTIVE_ROLE_MATRIX) — the assignee-own path is a follow-up.
import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { resolveMemberForOrg, type MemberContext } from "@/lib/http-auth";
import { assertRoleMayTrigger } from "@/lib/permissions";
import {
  acknowledgeException,
  startExceptionProgress,
  resolveException,
  verifyException,
  reopenException,
  createCorrectiveAction,
  assignCorrectiveAction,
  markCorrectiveActionDone,
  verifyCorrectiveAction,
  rejectCorrectiveAction,
} from "@/lib/exceptions";

export type ExceptionActionResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "validation"; issues: unknown[] }
  | { status: "error"; message: string };

class ForbiddenError extends Error {}

async function ctxFor(organizationId: string): Promise<MemberContext | null> {
  return resolveMemberForOrg((await headers()) as unknown as Headers, organizationId);
}

function revalidate(org: string, exceptionId?: string): void {
  revalidatePath(`/${org}/exceptions`);
  if (exceptionId) revalidatePath(`/${org}/exceptions/${exceptionId}`);
}

const orgId = z.string().uuid();
const idField = z.string().uuid();

/** Shared runner: resolve ctx, gate, run the edge in a tx, map throws to typed results. */
async function run(
  organizationId: string,
  gate: (role: MemberContext["role"]) => void,
  work: (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    ctx: MemberContext,
  ) => Promise<unknown>,
  exceptionIdForRevalidate?: string,
): Promise<ExceptionActionResult> {
  const ctx = await ctxFor(organizationId);
  if (!ctx) return { status: "unauthorized" };
  try {
    await withTenant(ctx.organizationId, async (tx) => {
      try {
        gate(ctx.role);
      } catch {
        throw new ForbiddenError();
      }
      // Property-scope gate (#152): a scoped member may only act on exceptions for their properties.
      if (ctx.propertyScope.length > 0 && exceptionIdForRevalidate) {
        const exc = await tx.exception.findFirst({
          where: { id: exceptionIdForRevalidate, deletedAt: null },
          select: { propertyId: true },
        });
        if (!exc || !ctx.propertyScope.includes(exc.propertyId)) throw new ForbiddenError();
      }
      return work(tx, ctx);
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return { status: "forbidden" };
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
  revalidate(ctx.organizationId, exceptionIdForRevalidate);
  return { status: "ok" };
}

// ---- Exception triage edges (§7.2) ----------------------------------------------

const exceptionEdgeInput = z.object({
  organizationId: orgId,
  exceptionId: idField,
  reason: z.string().trim().min(1).optional(),
});

export async function acknowledgeExceptionAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = exceptionEdgeInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  return run(
    p.data.organizationId,
    (role) => assertRoleMayTrigger("exception", "acknowledge", role),
    (tx, ctx) =>
      acknowledgeException(tx, p.data.exceptionId, {
        actorUserId: ctx.userId,
        reason: p.data.reason,
      }),
    p.data.exceptionId,
  );
}

export async function startExceptionProgressAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = exceptionEdgeInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  return run(
    p.data.organizationId,
    (role) => assertRoleMayTrigger("exception", "startProgress", role),
    (tx, ctx) =>
      startExceptionProgress(tx, p.data.exceptionId, {
        actorUserId: ctx.userId,
        reason: p.data.reason,
      }),
    p.data.exceptionId,
  );
}

export async function resolveExceptionAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = exceptionEdgeInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  return run(
    p.data.organizationId,
    (role) => assertRoleMayTrigger("exception", "resolve", role),
    (tx, ctx) =>
      resolveException(tx, p.data.exceptionId, { actorUserId: ctx.userId, reason: p.data.reason }),
    p.data.exceptionId,
  );
}

export async function verifyExceptionAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = exceptionEdgeInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  return run(
    p.data.organizationId,
    (role) => assertRoleMayTrigger("exception", "verify", role),
    (tx, ctx) =>
      verifyException(tx, p.data.exceptionId, { actorUserId: ctx.userId, reason: p.data.reason }),
    p.data.exceptionId,
  );
}

export async function reopenExceptionAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = exceptionEdgeInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  return run(
    p.data.organizationId,
    (role) => assertRoleMayTrigger("exception", "reopen", role),
    (tx, ctx) =>
      reopenException(tx, p.data.exceptionId, { actorUserId: ctx.userId, reason: p.data.reason }),
    p.data.exceptionId,
  );
}

// ---- Corrective actions (§7.3) --------------------------------------------------

const createCaInput = z.object({
  organizationId: orgId,
  exceptionId: idField,
  description: z.string().trim().min(1).max(1000),
});

export async function createCorrectiveActionAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = createCaInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  return run(
    p.data.organizationId,
    (role) => assertRoleMayTrigger("correctiveAction", "create", role),
    (tx, ctx) =>
      createCorrectiveAction(
        tx,
        { exceptionId: p.data.exceptionId, description: p.data.description },
        { actorUserId: ctx.userId },
      ),
    p.data.exceptionId,
  );
}

const assignCaInput = z
  .object({
    organizationId: orgId,
    exceptionId: idField,
    correctiveActionId: idField,
    assigneeUserId: z.string().uuid().nullish(),
    assigneeRole: z.string().nullish(),
    dueAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid due date"),
  })
  .refine((d) => (d.assigneeUserId != null) !== (d.assigneeRole != null), {
    message: "Set exactly one assignee (user or role).",
    path: ["assigneeUserId"],
  });

export async function assignCorrectiveActionAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = assignCaInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  const d = p.data;
  return run(
    d.organizationId,
    (role) => assertRoleMayTrigger("correctiveAction", "assign", role),
    (tx, ctx) =>
      assignCorrectiveAction(
        tx,
        d.correctiveActionId,
        {
          assigneeUserId: d.assigneeUserId ?? undefined,
          assigneeRole: (d.assigneeRole ?? undefined) as never,
          dueAt: new Date(d.dueAt),
        },
        { actorUserId: ctx.userId },
      ),
    d.exceptionId,
  );
}

const caEdgeInput = z.object({
  organizationId: orgId,
  exceptionId: idField,
  correctiveActionId: idField,
  clientSubmissionId: z.string().uuid().optional(),
  reason: z.string().trim().min(1).optional(),
});

export async function markCorrectiveActionDoneAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = caEdgeInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  const d = p.data;
  return run(
    d.organizationId,
    (role) => assertRoleMayTrigger("correctiveAction", "markDone", role),
    (tx, ctx) =>
      markCorrectiveActionDone(
        tx,
        d.correctiveActionId,
        { actorUserId: ctx.userId },
        { clientSubmissionId: d.clientSubmissionId },
      ),
    d.exceptionId,
  );
}

export async function verifyCorrectiveActionAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = caEdgeInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  const d = p.data;
  return run(
    d.organizationId,
    (role) => assertRoleMayTrigger("correctiveAction", "verify", role),
    (tx, ctx) => verifyCorrectiveAction(tx, d.correctiveActionId, { actorUserId: ctx.userId }),
    d.exceptionId,
  );
}

export async function rejectCorrectiveActionAction(raw: unknown): Promise<ExceptionActionResult> {
  const p = caEdgeInput.safeParse(raw);
  if (!p.success) return { status: "validation", issues: p.error.issues };
  const d = p.data;
  return run(
    d.organizationId,
    (role) => assertRoleMayTrigger("correctiveAction", "reject", role),
    (tx, ctx) =>
      rejectCorrectiveAction(tx, d.correctiveActionId, {
        actorUserId: ctx.userId,
        reason: d.reason,
      }),
    d.exceptionId,
  );
}
