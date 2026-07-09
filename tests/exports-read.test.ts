import { describe, it, expect, inject, afterAll } from "vitest";
import { withTenant, disconnect } from "../src/lib/db";
import { listExportJobs } from "../src/lib/exports-read";
import { enqueueExport } from "../src/lib/exports";

// #139 — the exports list read: a queued job appears (not yet downloadable), an activity_log row is
// written by enqueue, and jobs are tenant-isolated (D6). The worker + signed download are covered by
// exports.test / evidence-view.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

// requestedBy carries a composite FK to memberships(organization_id, user_id) — it must be an actual
// member of the org, so use the seeded member rather than a bare users row.
async function member(orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => (await tx.membership.findFirstOrThrow()).userId);
}

describe("exports read (#139)", () => {
  it("lists a queued job (not downloadable) and writes an export.queued audit row", async () => {
    const requestedBy = await member(orgAId);
    const job = await withTenant(orgAId, (tx) =>
      enqueueExport(tx, {
        organizationId: orgAId,
        requestedBy,
        filters: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T23:59:59.999Z" },
      }),
    );

    const jobs = await withTenant(orgAId, (tx) => listExportJobs(tx));
    const mine = jobs.find((j) => j.id === job.id);
    expect(mine).toBeDefined();
    expect(mine!.status).toBe("queued");
    expect(mine!.downloadable).toBe(false);
    expect(mine!.filters.from).toBe("2026-01-01T00:00:00.000Z");

    const audit = await withTenant(orgAId, (tx) =>
      tx.activityLog.findFirst({ where: { subjectId: job.id, action: "export.queued" } }),
    );
    expect(audit).not.toBeNull();
  });

  it("does not leak an org A export job into org B (RLS, D6)", async () => {
    const requestedBy = await member(orgAId);
    const job = await withTenant(orgAId, (tx) =>
      enqueueExport(tx, { organizationId: orgAId, requestedBy, filters: {} }),
    );
    const fromB = await withTenant(orgBId, (tx) => listExportJobs(tx));
    expect(fromB.find((j) => j.id === job.id)).toBeUndefined();
  });
});
