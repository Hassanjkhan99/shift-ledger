import { describe, it, expect, inject, afterAll } from "vitest";
import { withTenant, disconnect } from "../src/lib/db";
import { InMemoryObjectStore } from "../src/lib/storage";
import { enqueueExport, processExportJob, type ExportFilters } from "../src/lib/exports";
import { handleExportDownload } from "../src/app/api/exports/[id]/download/route";
import type { MemberContext } from "../src/lib/http-auth";

// #14 — export jobs -> audit packs. Covers: enqueue (queued + audited); processExportJob renders a PDF,
// stores it as a finalized attachment, creates the audit_pack (record_count + chain_head_hash), and
// drives the state machine queued->processing->completed (each audited); idempotency; fail-closed
// (->failed on error); and the signed download route (302 / cross-tenant 404 / not-complete 404 / 401).
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

async function member(org: string): Promise<string> {
  return withTenant(org, async (tx) => (await tx.membership.findFirstOrThrow()).userId);
}
async function enqueue(org: string, filters: ExportFilters = {}): Promise<string> {
  const uid = await member(org);
  const job = await withTenant(org, (tx) =>
    enqueueExport(tx, { organizationId: org, requestedBy: uid, filters }),
  );
  return job.id;
}

describe("enqueueExport + processExportJob", () => {
  it("enqueues a queued job and audits it", async () => {
    const jobId = await enqueue(orgAId);
    const job = await withTenant(orgAId, (tx) =>
      tx.exportJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } }),
    );
    expect(job.status).toBe("queued");
    const logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({ where: { subjectId: jobId }, select: { action: true } }),
    );
    expect(logs.map((l) => l.action)).toContain("export.queued");
  });

  it("processes a job to completed: renders a PDF, finalizes the attachment, writes the pack", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const jobId = await enqueue(orgAId);
    const res = await processExportJob(store, { organizationId: orgAId, jobId });
    expect(res.status).toBe("completed");
    expect(res.auditPackId).toBeTruthy();

    const job = await withTenant(orgAId, (tx) =>
      tx.exportJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, auditPackId: true },
      }),
    );
    expect(job.status).toBe("completed");
    expect(job.auditPackId).toBe(res.auditPackId);

    const pack = await withTenant(orgAId, (tx) =>
      tx.auditPack.findUniqueOrThrow({
        where: { id: res.auditPackId! },
        select: { attachmentId: true, recordCount: true, chainHeadHash: true, exportJobId: true },
      }),
    );
    expect(pack.exportJobId).toBe(jobId);
    expect(pack.recordCount).toBeGreaterThanOrEqual(0);
    // The chain head at export time (set by the export.processing log) is a SHA-256 hex digest.
    expect(pack.chainHeadHash).toMatch(/^[0-9a-f]{64}$/);

    const att = await withTenant(orgAId, (tx) =>
      tx.attachment.findUniqueOrThrow({
        where: { id: pack.attachmentId },
        select: { status: true, contentType: true, checksumSha256: true, r2Key: true },
      }),
    );
    expect(att.status).toBe("uploaded"); // finalized (F6 checksum recorded)
    expect(att.contentType).toBe("application/pdf");
    expect(att.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(att.r2Key.startsWith(`org/${orgAId}/exports/`)).toBe(true);

    // The stored object really is a PDF.
    const bytes = await store.getObject(att.r2Key);
    expect(bytes).not.toBeNull();
    expect(String.fromCharCode(...bytes!.subarray(0, 5))).toBe("%PDF-");

    // State machine was audited end to end.
    const actions = await withTenant(orgAId, (tx) =>
      tx.activityLog
        .findMany({ where: { subjectId: jobId }, select: { action: true } })
        .then((rows) => rows.map((r) => r.action)),
    );
    expect(actions).toContain("export.queued");
    expect(actions).toContain("export.processing");
    expect(actions).toContain("export.completed");
  });

  it("is idempotent: re-processing a completed job is a skipped no-op", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const jobId = await enqueue(orgAId);
    await processExportJob(store, { organizationId: orgAId, jobId });
    const again = await processExportJob(store, { organizationId: orgAId, jobId });
    expect(again.status).toBe("skipped");
  });

  it("fails closed: a storage error moves the job to failed (audited) and rethrows", async () => {
    class FailingStore extends InMemoryObjectStore {
      async putObject(): Promise<void> {
        throw new Error("r2 unavailable");
      }
    }
    const jobId = await enqueue(orgAId);
    await expect(
      processExportJob(new FailingStore("shift-ledger-eu"), { organizationId: orgAId, jobId }),
    ).rejects.toThrow();
    const job = await withTenant(orgAId, (tx) =>
      tx.exportJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { status: true, error: true },
      }),
    );
    expect(job.status).toBe("failed");
    expect(job.error).toBeTruthy();
    const actions = await withTenant(orgAId, (tx) =>
      tx.activityLog
        .findMany({ where: { subjectId: jobId }, select: { action: true } })
        .then((rows) => rows.map((r) => r.action)),
    );
    expect(actions).toContain("export.failed");
  });
});

describe("handleExportDownload", () => {
  const req = new Request("http://localhost/api/exports/x/download");
  const ctx =
    (org: string, userId: string): (() => Promise<MemberContext>) =>
    async () => ({
      organizationId: org,
      userId,
    });

  it("302s to a signed URL for a completed job in the caller's org", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const uid = await member(orgAId);
    const jobId = await enqueue(orgAId);
    await processExportJob(store, { organizationId: orgAId, jobId });
    const res = await handleExportDownload(req, jobId, { resolveContext: ctx(orgAId, uid), store });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("X-Amz-Expires=300");
  });

  it("404s for a cross-tenant caller (non-disclosure)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const jobId = await enqueue(orgAId);
    await processExportJob(store, { organizationId: orgAId, jobId });
    const bUid = await member(orgBId);
    const res = await handleExportDownload(req, jobId, {
      resolveContext: ctx(orgBId, bUid),
      store,
    });
    expect(res.status).toBe(404);
  });

  it("404s for a job that is not yet completed", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const uid = await member(orgAId);
    const jobId = await enqueue(orgAId); // still queued
    const res = await handleExportDownload(req, jobId, { resolveContext: ctx(orgAId, uid), store });
    expect(res.status).toBe(404);
  });

  it("401s with no session", async () => {
    const res = await handleExportDownload(req, "00000000-0000-0000-0000-000000000000", {
      resolveContext: async () => null,
      store: new InMemoryObjectStore(),
    });
    expect(res.status).toBe(401);
  });

  it("404s when the pack's attachment has been soft-deleted (retention tombstone)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const uid = await member(orgAId);
    const jobId = await enqueue(orgAId);
    const res0 = await processExportJob(store, { organizationId: orgAId, jobId });
    const pack = await withTenant(orgAId, (tx) =>
      tx.auditPack.findUniqueOrThrow({
        where: { id: res0.auditPackId! },
        select: { attachmentId: true },
      }),
    );
    // Tombstone the pack's attachment (allowed by the write-once guard — deletedAt is not frozen).
    await withTenant(orgAId, (tx) =>
      tx.attachment.update({ where: { id: pack.attachmentId }, data: { deletedAt: new Date() } }),
    );
    const res = await handleExportDownload(req, jobId, { resolveContext: ctx(orgAId, uid), store });
    expect(res.status).toBe(404);
  });
});

describe("#120 audit-pack immutability + verify-before-export", () => {
  it("rejects UPDATE on an audit_pack (immutable inspection evidence)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const jobId = await enqueue(orgAId);
    const res = await processExportJob(store, { organizationId: orgAId, jobId });
    await expect(
      withTenant(orgAId, (tx) =>
        tx.auditPack.update({ where: { id: res.auditPackId! }, data: { recordCount: 9999 } }),
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it("fails the export when the activity chain does not verify (no head certified on a broken chain)", async () => {
    // Commit a tamper to orgB's chain, run an export, expect it to fail (verify_activity_chain -> false),
    // then reverse the tamper so the chain is intact for other tests. Reversible interval math.
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const jobId = await enqueue(orgBId);
    const rowId = await withTenant(orgBId, async (tx) => {
      const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM activity_log
         WHERE organization_id = ${orgBId}::uuid AND chain_seq IS NOT NULL
         ORDER BY chain_seq ASC LIMIT 1`;
      await tx.$executeRawUnsafe(`ALTER TABLE "activity_log" DISABLE TRIGGER USER`);
      await tx.$executeRaw`UPDATE activity_log SET created_at = created_at + interval '1 second' WHERE id = ${id}::uuid`;
      await tx.$executeRawUnsafe(`ALTER TABLE "activity_log" ENABLE TRIGGER USER`);
      return id;
    });

    await expect(processExportJob(store, { organizationId: orgBId, jobId })).rejects.toThrow();
    const job = await withTenant(orgBId, (tx) =>
      tx.exportJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } }),
    );
    expect(job.status).toBe("failed");

    // Reverse the tamper so orgB's chain verifies again for any later test.
    await withTenant(orgBId, async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE "activity_log" DISABLE TRIGGER USER`);
      await tx.$executeRaw`UPDATE activity_log SET created_at = created_at - interval '1 second' WHERE id = ${rowId}::uuid`;
      await tx.$executeRawUnsafe(`ALTER TABLE "activity_log" ENABLE TRIGGER USER`);
    });
  });
});
