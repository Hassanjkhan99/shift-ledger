"use server";
// Exports Server Actions (#139). Enqueue an audit-pack export (any active member — read-only Auditor /
// ExternalInspector are explicitly allowed to request + download, D7) and a dev-only "process now" that
// runs the worker until the Inngest runtime (#20) lands. Enqueue is audited via transition()/logActivity
// inside exports.ts; download is the signed /api/exports/[id]/download route.
import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { resolveMemberForOrg, type MemberContext } from "@/lib/http-auth";
import { canExportAuditPacks } from "@/lib/permissions";
import { enqueueExport, processExportJob } from "@/lib/exports";
import { getObjectStore } from "@/lib/storage";

export type ExportActionResult =
  | { status: "ok"; id?: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "validation"; issues: unknown[] }
  | { status: "error"; message: string };

async function ctxFor(organizationId: string): Promise<MemberContext | null> {
  return resolveMemberForOrg((await headers()) as unknown as Headers, organizationId);
}

// The form supplies calendar dates; widen `from` to the start of its day and `to` to the end, then send
// as ISO datetimes (the shape exportFiltersSchema/the pack query consume).
const enqueueInput = z
  .object({
    organizationId: z.string().uuid(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, {
    message: "The start date must be on or before the end date.",
    path: ["to"],
  });

export async function enqueueExportAction(raw: unknown): Promise<ExportActionResult> {
  const parsed = enqueueInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canExportAuditPacks(ctx.role)) return { status: "forbidden" };

  const filters = {
    ...(input.from ? { from: new Date(`${input.from}T00:00:00.000Z`).toISOString() } : {}),
    ...(input.to ? { to: new Date(`${input.to}T23:59:59.999Z`).toISOString() } : {}),
  };

  const job = await withTenant(ctx.organizationId, (tx) =>
    enqueueExport(tx, { organizationId: ctx.organizationId, requestedBy: ctx.userId, filters }),
  );
  revalidatePath(`/${ctx.organizationId}/exports`);
  return { status: "ok", id: job.id };
}

const processInput = z.object({ organizationId: z.string().uuid(), jobId: z.string().uuid() });

/**
 * Dev-only: run the export worker for a queued job now (renders the pack → R2 → completes it). Requires
 * object storage to be configured; in an environment without R2 this returns an error rather than
 * throwing. Superseded by the Inngest runtime (#20).
 */
export async function processExportNowAction(raw: unknown): Promise<ExportActionResult> {
  const parsed = processInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canExportAuditPacks(ctx.role)) return { status: "forbidden" };

  try {
    await processExportJob(getObjectStore(), {
      organizationId: ctx.organizationId,
      jobId: input.jobId,
      actorLabel: "system:export-dev",
    });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "export failed" };
  }
  revalidatePath(`/${ctx.organizationId}/exports`);
  return { status: "ok" };
}
