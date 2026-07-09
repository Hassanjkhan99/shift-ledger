// Export jobs -> audit packs (#14; §7.4, §8.22/§8.23, §22).
//
// SANCTIONED F4 service: every export_job status change (queued -> processing -> completed | failed)
// routes through transition(), so the ExportJob state machine cannot move without an activity_log row.
// The status writes are marked `f4-guard-allow` (the codebase-wide F4 assertion honours the marker only
// inside this sanctioned file).
//
// Inngest runtime (crons, the queue worker, the API trigger) is #20; processExportJob() is written as a
// plain async worker entry point so #20 wires it to Inngest with no changes here. enqueueExport() just
// records a `queued` job; processExportJob() renders + stores + completes it.
import { z } from "zod";
import { withTenant, type TenantClient } from "./db";
import type { ObjectStore } from "./storage";
import type { Prisma } from "../generated/prisma/client";
import { transition, logActivity } from "./transition";
import { finalizeAttachment } from "./finalize";
import { renderAuditPackPdf } from "./audit-pack-pdf";
import { buildExportKey } from "./uploads";

/** Export scope filter — shared by the enqueue action and the worker (typed, Zod-validated, §22). */
export const exportFiltersSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();
export type ExportFilters = z.infer<typeof exportFiltersSchema>;

/**
 * Enqueue an export: create a `queued` export_job (status via DB default, so no direct status write)
 * and audit the creation. Runs inside the caller's tenant transaction.
 */
export async function enqueueExport(
  tx: TenantClient,
  args: { organizationId: string; requestedBy: string; filters: ExportFilters },
): Promise<{ id: string }> {
  const job = await tx.exportJob.create({
    data: {
      organizationId: args.organizationId,
      requestedBy: args.requestedBy,
      filtersJson: args.filters as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  await logActivity(tx, {
    organizationId: args.organizationId,
    subjectType: "exportJob",
    subjectId: job.id,
    action: "export.queued",
    actorUserId: args.requestedBy,
  });
  return job;
}

function recordedAtRange(filters: ExportFilters): Prisma.TaskCompletionWhereInput {
  if (!filters.from && !filters.to) return {};
  return {
    recordedAt: {
      ...(filters.from ? { gte: new Date(filters.from) } : {}),
      ...(filters.to ? { lte: new Date(filters.to) } : {}),
    },
  };
}

export interface ProcessExportResult {
  status: "completed" | "skipped";
  auditPackId?: string;
  recordCount?: number;
}

/**
 * Render + store + complete a queued export job. Owns its own tenant transactions (worker entry point,
 * #20 wires it to Inngest). Fail-closed: any error moves the job to `failed` (audited) and rethrows.
 * Idempotent: a job not in `queued` is left untouched (returns 'skipped').
 */
export async function processExportJob(
  store: ObjectStore,
  args: { organizationId: string; jobId: string; actorLabel?: string },
): Promise<ProcessExportResult> {
  const { organizationId, jobId } = args;
  const actorLabel = args.actorLabel ?? "system:export-worker";

  // 1. queued -> processing (compare-and-set; a job already past queued is a no-op / idempotent retry).
  const claimed = await withTenant(organizationId, (tx) =>
    transition(tx, {
      organizationId,
      subjectType: "exportJob",
      subjectId: jobId,
      action: "export.processing",
      actorLabel,
      mutate: (t) =>
        t.exportJob.updateMany({
          where: { id: jobId, status: "queued" },
          data: { status: "processing" }, // f4-guard-allow
        }),
      didMutate: (r) => r.count === 1,
    }),
  );
  if (claimed.count !== 1) return { status: "skipped" };

  try {
    // 2. Gather the scope: record count + chain head + org name (own read tx).
    const gathered = await withTenant(organizationId, async (tx) => {
      const job = await tx.exportJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { filtersJson: true },
      });
      const filters = exportFiltersSchema.parse(job.filtersJson ?? {});
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true },
      });
      const recordCount = await tx.taskCompletion.count({
        where: { organizationId, ...recordedAtRange(filters) },
      });
      // #120: certify the chain head ONLY if the chain actually verifies. Otherwise the pack would
      // stamp a "tamper-evident" head onto a chain that fails verification — refuse and fail the job.
      const [{ ok }] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT verify_activity_chain() AS ok`;
      if (!ok) {
        throw new Error(
          "export: activity chain verification failed; refusing to certify a broken head",
        );
      }
      const headRows = await tx.$queryRaw<
        { h: string | null }[]
      >`SELECT activity_chain_head() AS h`;
      return { filters, orgName: org.name, recordCount, chainHead: headRows[0].h };
    });

    // 3. Render the PDF (outside any transaction).
    const pdf = await renderAuditPackPdf({
      organizationName: gathered.orgName,
      generatedAtIso: new Date().toISOString(),
      filters: gathered.filters,
      recordCount: gathered.recordCount,
      chainHeadHash: gathered.chainHead,
    });

    // 4. Store the pack object + create the audit_pack + complete the job (own write tx).
    const result = await withTenant(organizationId, async (tx) => {
      const r2Key = buildExportKey(organizationId, jobId);
      const attachment = await tx.attachment.create({
        data: { organizationId, r2Bucket: store.bucket, r2Key, contentType: "application/pdf" },
        select: { id: true },
      });
      await store.putObject(r2Key, pdf, "application/pdf");
      // Reuse the #106 finalize path: validates the PDF bytes + records the F6 checksum, flips uploaded.
      await finalizeAttachment(store, tx, { organizationId, attachmentId: attachment.id });

      const pack = await tx.auditPack.create({
        data: {
          organizationId,
          exportJobId: jobId,
          attachmentId: attachment.id,
          recordCount: gathered.recordCount,
          filtersSnapshotJson: gathered.filters as Prisma.InputJsonValue,
          chainHeadHash: gathered.chainHead,
        },
        select: { id: true },
      });

      await transition(tx, {
        organizationId,
        subjectType: "exportJob",
        subjectId: jobId,
        action: "export.completed",
        actorLabel,
        mutate: (t) =>
          t.exportJob.updateMany({
            where: { id: jobId, status: "processing" },
            data: { status: "completed", auditPackId: pack.id }, // f4-guard-allow
          }),
        didMutate: (r) => r.count === 1,
      });
      return { auditPackId: pack.id, recordCount: gathered.recordCount };
    });

    return { status: "completed", ...result };
  } catch (err) {
    // Fail closed: record the failure (audited) and rethrow.
    const message = err instanceof Error ? err.message : String(err);
    await withTenant(organizationId, (tx) =>
      transition(tx, {
        organizationId,
        subjectType: "exportJob",
        subjectId: jobId,
        action: "export.failed",
        actorLabel,
        reason: message,
        mutate: (t) =>
          t.exportJob.updateMany({
            where: { id: jobId },
            data: { status: "failed", error: message }, // f4-guard-allow
          }),
        didMutate: (r) => r.count === 1,
      }),
    );
    throw err;
  }
}
