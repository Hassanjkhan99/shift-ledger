import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { InMemoryObjectStore } from "../src/lib/storage";
import { buildEvidenceKey } from "../src/lib/uploads";
import { finalizeAttachment } from "../src/lib/finalize";
import { buildCompletionInsert } from "../src/lib/completions";
import { resolveEvidenceViewUrl } from "../src/lib/evidence-view";
import { handleEvidenceView } from "../src/app/api/evidence/[id]/view/route";
import type { MemberContext } from "../src/lib/http-auth";

// #119 — the signed evidence view resolves by the EVIDENCE row id (not a bare attachment id), so an
// object can only be viewed when it is linked to visible evidence. Proves: 302 short-lived signed GET
// for an in-tenant evidence; 404 non-disclosure for cross-tenant / soft-deleted attachment / unknown /
// malformed id; 401 no session.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

const PDF = Uint8Array.from(
  [...["%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"].join("")].map((c) => c.charCodeAt(0)),
);

async function uploadedAttachment(store: InMemoryObjectStore, orgId: string): Promise<string> {
  const id = await withTenant(orgId, async (tx) => {
    const m = await tx.membership.findFirstOrThrow();
    const key = buildEvidenceKey(orgId, randomUUID(), "pdf");
    const a = await tx.attachment.create({
      data: {
        organizationId: orgId,
        r2Bucket: store.bucket,
        r2Key: key,
        contentType: "application/pdf",
        uploadedBy: m.userId,
      },
      select: { id: true },
    });
    await store.putObject(key, PDF, "application/pdf");
    return a.id;
  });
  await withTenant(orgId, (tx) =>
    finalizeAttachment(store, tx, { organizationId: orgId, attachmentId: id }),
  );
  return id;
}

async function makeCompletion(orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const property = await tx.property.findFirstOrThrow();
    const outlet = await tx.outlet.findFirstOrThrow();
    const membership = await tx.membership.findFirstOrThrow();
    const template = await tx.taskTemplate.create({
      data: { organizationId: orgId, checkType: "temperature", title: `Fridge ${randomUUID()}` },
      select: { id: true },
    });
    const scheduled = await tx.scheduledTask.create({
      data: {
        organizationId: orgId,
        propertyId: property.id,
        outletId: outlet.id,
        taskTemplateId: template.id,
        recurrenceJson: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        recurrenceFreq: "daily",
        timeOfDay: new Date("1970-01-01T06:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
        startsOn: new Date("2026-07-01"),
        isActive: true,
      },
      select: { id: true },
    });
    const occ = await tx.taskOccurrence.create({
      data: {
        organizationId: orgId,
        propertyId: property.id,
        outletId: outlet.id,
        scheduledTaskId: scheduled.id,
        taskTemplateId: template.id,
        checkType: "temperature",
        occurrenceLocalDate: new Date(Date.UTC(2026, 6, Math.floor(Math.random() * 27) + 1)),
        dueAt: new Date("2026-07-03T04:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
      },
      select: { id: true },
    });
    const completion = await tx.taskCompletion.create({
      data: buildCompletionInsert({
        organizationId: orgId,
        taskOccurrenceId: occ.id,
        clientSubmissionId: randomUUID(),
        result: "pass",
        completedBy: membership.userId,
      }),
      select: { id: true },
    });
    return completion.id;
  });
}

/** Create a `file` evidence row referencing an uploaded attachment; return { evidenceId, attachmentId }. */
async function makeEvidence(
  store: InMemoryObjectStore,
  orgId: string,
): Promise<{ evidenceId: string; attachmentId: string }> {
  const attachmentId = await uploadedAttachment(store, orgId);
  const completionId = await makeCompletion(orgId);
  const evidenceId = await withTenant(orgId, async (tx) => {
    const ev = await tx.evidence.create({
      data: { organizationId: orgId, taskCompletionId: completionId, type: "file", attachmentId },
      select: { id: true },
    });
    return ev.id;
  });
  return { evidenceId, attachmentId };
}

describe("resolveEvidenceViewUrl — resolves by Evidence.id", () => {
  it("returns a short-lived (<=5 min) signed GET for an in-tenant evidence's attachment", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const { evidenceId } = await makeEvidence(store, orgAId);
    const view = await withTenant(orgAId, (tx) => resolveEvidenceViewUrl(store, tx, evidenceId));
    expect(view).not.toBeNull();
    expect(view!.expiresIn).toBeLessThanOrEqual(300);
    expect(view!.url).toContain("X-Amz-Expires=300");
  });

  it("returns null for cross-tenant evidence (RLS non-disclosure)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const { evidenceId } = await makeEvidence(store, orgBId);
    const view = await withTenant(orgAId, (tx) => resolveEvidenceViewUrl(store, tx, evidenceId));
    expect(view).toBeNull();
  });

  it("returns null when the evidence's attachment has been soft-deleted", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const { evidenceId, attachmentId } = await makeEvidence(store, orgAId);
    await withTenant(orgAId, (tx) =>
      tx.attachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } }),
    );
    const view = await withTenant(orgAId, (tx) => resolveEvidenceViewUrl(store, tx, evidenceId));
    expect(view).toBeNull();
  });

  it("returns null for an unknown evidence id", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const view = await withTenant(orgAId, (tx) => resolveEvidenceViewUrl(store, tx, randomUUID()));
    expect(view).toBeNull();
  });
});

describe("handleEvidenceView — route behaviour", () => {
  const req = new Request("http://localhost/api/evidence/x/view");
  const ctxFor =
    (org: string): (() => Promise<MemberContext>) =>
    async () => ({ organizationId: org, userId: "00000000-0000-0000-0000-000000000000" });

  it("302s to the signed URL for an in-tenant evidence", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const { evidenceId } = await makeEvidence(store, orgAId);
    const res = await handleEvidenceView(req, evidenceId, {
      resolveContext: ctxFor(orgAId),
      store,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("X-Amz-Expires=300");
    expect(await res.text()).toBe(""); // URL lives only in the Location header
  });

  it("404s for cross-tenant evidence (non-disclosure)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const { evidenceId } = await makeEvidence(store, orgBId);
    const res = await handleEvidenceView(req, evidenceId, {
      resolveContext: ctxFor(orgAId),
      store,
    });
    expect(res.status).toBe(404);
  });

  it("404s for a malformed id", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const res = await handleEvidenceView(req, "not-a-uuid", {
      resolveContext: ctxFor(orgAId),
      store,
    });
    expect(res.status).toBe(404);
  });

  it("401s with no session (fail closed)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const res = await handleEvidenceView(req, randomUUID(), {
      resolveContext: async () => null,
      store,
    });
    expect(res.status).toBe(401);
  });
});
