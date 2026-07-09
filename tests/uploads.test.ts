import { describe, it, expect, inject, afterAll } from "vitest";
import { withTenant, disconnect } from "../src/lib/db";
import { InMemoryObjectStore } from "../src/lib/storage";
import {
  presignUploadSchema,
  createUpload,
  buildEvidenceKey,
  IMAGE_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
} from "../src/lib/uploads";
import { handlePresignUpload } from "../src/app/api/uploads/route";
import type { MemberContext } from "../src/lib/http-auth";

// #105 — R2 presign upload primitive. Covers: Zod validation (allowlist + per-class size + kind
// match), the createUpload domain core (pending row under an org-prefixed id-only key + presigned PUT),
// and the route handler's fail-closed auth + 422 + 201 behaviour with an in-memory store.
const orgAId = inject("orgAId");

afterAll(async () => {
  await disconnect();
});

async function orgMember(orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const m = await tx.membership.findFirstOrThrow();
    return m.userId;
  });
}

describe("presignUploadSchema — allowlist + size + kind", () => {
  it("accepts an allowlisted image within the class limit", () => {
    const r = presignUploadSchema.safeParse({
      contentType: "image/jpeg",
      byteSize: IMAGE_MAX_BYTES,
      kind: "photo",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-allowlisted MIME type", () => {
    const r = presignUploadSchema.safeParse({
      contentType: "image/gif",
      byteSize: 1024,
      kind: "photo",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an image over 10 MB and a document over 25 MB", () => {
    expect(
      presignUploadSchema.safeParse({
        contentType: "image/png",
        byteSize: IMAGE_MAX_BYTES + 1,
        kind: "photo",
      }).success,
    ).toBe(false);
    expect(
      presignUploadSchema.safeParse({
        contentType: "application/pdf",
        byteSize: DOCUMENT_MAX_BYTES + 1,
        kind: "file",
      }).success,
    ).toBe(false);
  });

  it("accepts a 25 MB PDF as a file (document class limit)", () => {
    expect(
      presignUploadSchema.safeParse({
        contentType: "application/pdf",
        byteSize: DOCUMENT_MAX_BYTES,
        kind: "file",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-positive byte size", () => {
    expect(
      presignUploadSchema.safeParse({ contentType: "image/jpeg", byteSize: 0, kind: "photo" })
        .success,
    ).toBe(false);
  });

  it("rejects a photo/signature that is not an image content type", () => {
    expect(
      presignUploadSchema.safeParse({
        contentType: "application/pdf",
        byteSize: 1024,
        kind: "photo",
      }).success,
    ).toBe(false);
  });
});

describe("buildEvidenceKey — org-prefixed, id-only", () => {
  it("prefixes with org/{orgId}/ and contains only ids", () => {
    const key = buildEvidenceKey(orgAId, "11111111-1111-1111-1111-111111111111", "jpg");
    expect(key.startsWith(`org/${orgAId}/`)).toBe(true);
    expect(key).toBe(`org/${orgAId}/evidence/11111111-1111-1111-1111-111111111111.jpg`);
  });
});

describe("createUpload — pending row + presigned PUT", () => {
  it("inserts a pending attachment under an org-prefixed key and returns a presigned PUT", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const uploadedBy = await orgMember(orgAId);
    const result = await withTenant(orgAId, (tx) =>
      createUpload(store, tx, {
        organizationId: orgAId,
        uploadedBy,
        input: { contentType: "image/jpeg", byteSize: 2048, kind: "photo" },
      }),
    );
    expect(result.uploadUrl).toContain("X-Amz-Signature");
    expect(result.expiresIn).toBeGreaterThan(0);

    const row = await withTenant(orgAId, (tx) =>
      tx.attachment.findUniqueOrThrow({
        where: { id: result.attachmentId },
        select: {
          status: true,
          r2Key: true,
          r2Bucket: true,
          contentType: true,
          checksumSha256: true,
        },
      }),
    );
    expect(row.status).toBe("pending");
    expect(row.checksumSha256).toBeNull();
    expect(row.r2Bucket).toBe("shift-ledger-eu");
    expect(row.r2Key.startsWith(`org/${orgAId}/`)).toBe(true);
    // Key carries ids only — no email/name/filename leakage.
    expect(row.r2Key).toMatch(/^org\/[0-9a-f-]+\/evidence\/[0-9a-f-]+\.jpg$/);
  });
});

describe("handlePresignUpload — route behaviour", () => {
  const jsonReq = (body: unknown) =>
    new Request("http://localhost/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const noAuth = async (): Promise<MemberContext | null> => null;

  it("401s with no session (fail closed)", async () => {
    const res = await handlePresignUpload(
      jsonReq({ contentType: "image/jpeg", byteSize: 10, kind: "photo" }),
      {
        resolveContext: noAuth,
        store: new InMemoryObjectStore(),
      },
    );
    expect(res.status).toBe(401);
  });

  it("422s on an invalid body (bad MIME)", async () => {
    const ctx: MemberContext = {
      organizationId: orgAId,
      userId: await orgMember(orgAId),
      role: "Staff",
      propertyScope: [],
    };
    const res = await handlePresignUpload(
      jsonReq({ contentType: "text/html", byteSize: 10, kind: "file" }),
      {
        resolveContext: async () => ctx,
        store: new InMemoryObjectStore(),
      },
    );
    expect(res.status).toBe(422);
  });

  it("403s for a read-only Auditor (write-gate)", async () => {
    const ctx: MemberContext = {
      organizationId: orgAId,
      userId: await orgMember(orgAId),
      role: "Auditor",
      propertyScope: [],
    };
    const res = await handlePresignUpload(
      jsonReq({ contentType: "image/jpeg", byteSize: 10, kind: "photo" }),
      {
        resolveContext: async () => ctx,
        store: new InMemoryObjectStore(),
      },
    );
    expect(res.status).toBe(403);
  });

  it("201s and returns a presign for a valid authenticated request", async () => {
    const ctx: MemberContext = {
      organizationId: orgAId,
      userId: await orgMember(orgAId),
      role: "Staff",
      propertyScope: [],
    };
    const res = await handlePresignUpload(
      jsonReq({ contentType: "application/pdf", byteSize: 5000, kind: "file" }),
      { resolveContext: async () => ctx, store: new InMemoryObjectStore("shift-ledger-eu") },
    );
    expect(res.status).toBe(201);
    const payload = (await res.json()) as {
      uploadUrl: string;
      attachmentId: string;
      expiresIn: number;
    };
    expect(payload.attachmentId).toBeTruthy();
    expect(payload.uploadUrl).toContain("shift-ledger-eu");
    // The response is the only place the signed URL appears; nothing asserts it was logged/persisted.
  });
});
