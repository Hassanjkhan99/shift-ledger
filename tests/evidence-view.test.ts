import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { InMemoryObjectStore } from "../src/lib/storage";
import { buildEvidenceKey } from "../src/lib/uploads";
import { finalizeAttachment } from "../src/lib/finalize";
import { resolveAttachmentViewUrl } from "../src/lib/evidence-view";
import { handleEvidenceView } from "../src/app/api/evidence/[id]/view/route";
import type { MemberContext } from "../src/lib/http-auth";

// #107 — signed evidence view + privacy posture. Proves: a short-lived (<=5 min) signed GET for an
// uploaded object the tenant owns; 404-style non-disclosure for cross-tenant / pending / bad id; 401
// with no session; and that the route never emits the signed URL anywhere but the Location header.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

const PDF = Uint8Array.from(
  [...["%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"].join("")].map((c) => c.charCodeAt(0)),
);

/** Create + finalize an attachment (status 'uploaded') in `orgId`, returning its id. */
async function makeUploaded(store: InMemoryObjectStore, orgId: string): Promise<string> {
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

async function makePending(store: InMemoryObjectStore, orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const m = await tx.membership.findFirstOrThrow();
    const a = await tx.attachment.create({
      data: {
        organizationId: orgId,
        r2Bucket: store.bucket,
        r2Key: buildEvidenceKey(orgId, randomUUID(), "pdf"),
        contentType: "application/pdf",
        uploadedBy: m.userId,
      },
      select: { id: true },
    });
    return a.id;
  });
}

describe("resolveAttachmentViewUrl", () => {
  it("returns a short-lived (<=5 min) signed GET for an uploaded in-tenant object", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const id = await makeUploaded(store, orgAId);
    const view = await withTenant(orgAId, (tx) => resolveAttachmentViewUrl(store, tx, id));
    expect(view).not.toBeNull();
    expect(view!.expiresIn).toBeLessThanOrEqual(300);
    expect(view!.url).toContain("X-Amz-Expires=300");
  });

  it("returns null for a cross-tenant object (RLS non-disclosure)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const bId = await makeUploaded(store, orgBId);
    const view = await withTenant(orgAId, (tx) => resolveAttachmentViewUrl(store, tx, bId));
    expect(view).toBeNull();
  });

  it("returns null for a pending (not-yet-uploaded) object", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const id = await makePending(store, orgAId);
    const view = await withTenant(orgAId, (tx) => resolveAttachmentViewUrl(store, tx, id));
    expect(view).toBeNull();
  });
});

describe("handleEvidenceView — route behaviour", () => {
  const req = new Request("http://localhost/api/evidence/x/view");
  const ctxFor =
    (org: string): (() => Promise<MemberContext>) =>
    async () => ({
      organizationId: org,
      userId: "00000000-0000-0000-0000-000000000000",
    });

  it("302s to the signed URL for an uploaded in-tenant object", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const id = await makeUploaded(store, orgAId);
    const res = await handleEvidenceView(req, id, { resolveContext: ctxFor(orgAId), store });
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location");
    expect(loc).toContain("X-Amz-Expires=300");
    // Body carries nothing; the URL lives only in the Location header.
    expect(await res.text()).toBe("");
  });

  it("404s for a cross-tenant object (non-disclosure)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const bId = await makeUploaded(store, orgBId);
    const res = await handleEvidenceView(req, bId, { resolveContext: ctxFor(orgAId), store });
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
