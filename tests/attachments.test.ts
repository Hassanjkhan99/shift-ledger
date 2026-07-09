import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { buildCompletionInsert } from "../src/lib/completions";
import { requiresAttachment } from "../src/lib/attachments";

// #104 — attachments (§8.16) + evidence.attachment_id FK + the D4 requiresAttachment() rule.
// Proves: (1) the D4 truth table; (2) attachments RLS isolation + UNIQUE(r2_bucket, r2_key);
// (3) the evidence binary-requires / non-binary-forbids / value-shape CHECKs; (4) the tenant-qualified
// composite FK (evidence org A cannot reference an org-B attachment); (5) the uploaded_by
// tenant-membership composite FK.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Build a template→scheduled_task→occurrence→completion chain in `orgId` and return the completion id
 *  (to hang evidence off) plus a seeded in-org user id. Fresh occurrence per call avoids UNIQUE clashes. */
async function makeCompletion(orgId: string): Promise<{ completionId: string; userId: string }> {
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
    return { completionId: completion.id, userId: membership.userId };
  });
}

/** Create a `pending` attachment in `orgId` and return its id. */
async function makeAttachment(orgId: string, uploadedBy?: string | null): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const a = await tx.attachment.create({
      data: {
        organizationId: orgId,
        r2Bucket: "shift-ledger-eu",
        r2Key: `org/${orgId}/evidence/${randomUUID()}`,
        contentType: "image/jpeg",
        uploadedBy: uploadedBy ?? null,
      },
      select: { id: true },
    });
    return a.id;
  });
}

/** Create an attachment already flipped to `uploaded` (so binary evidence may reference it, #115). */
async function makeUploadedAttachment(orgId: string): Promise<string> {
  const id = await makeAttachment(orgId);
  await withTenant(
    orgId,
    (tx) =>
      tx.$executeRaw`UPDATE attachments SET status='uploaded', byte_size=1, checksum_sha256=${"a".repeat(64)} WHERE id=${id}::uuid`,
  );
  return id;
}

describe("D4 requiresAttachment() — truth table", () => {
  it("photo and file always require an attachment", () => {
    expect(requiresAttachment("photo")).toBe(true);
    expect(requiresAttachment("file")).toBe(true);
  });

  it("signature requires an attachment only when drawn", () => {
    expect(requiresAttachment("signature", "drawn")).toBe(true);
    expect(requiresAttachment("signature", "typed")).toBe(false);
    expect(requiresAttachment("signature")).toBe(false);
    expect(requiresAttachment("signature", null)).toBe(false);
  });

  it("note/temperature/checkbox/initials never require an attachment (signatureMode ignored)", () => {
    for (const t of ["note", "temperature", "checkbox", "initials"] as const) {
      expect(requiresAttachment(t)).toBe(false);
      expect(requiresAttachment(t, "drawn")).toBe(false);
    }
  });
});

describe("attachments — RLS isolation + UNIQUE(r2_bucket, r2_key)", () => {
  it("org A cannot see org B attachments, and cannot insert one tagged for org B", async () => {
    const bId = await makeAttachment(orgBId);
    const leaked = await withTenant(orgAId, (tx) => tx.attachment.findMany());
    expect(leaked.some((a) => a.id === bId)).toBe(false);
    expect(leaked.every((a) => a.organizationId === orgAId)).toBe(true);

    // Writing a row tagged for org B while in org A context is rejected by RLS WITH CHECK.
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.create({
          data: {
            organizationId: orgBId, // mismatched tenant
            r2Bucket: "shift-ledger-eu",
            r2Key: `org/${orgBId}/evidence/${randomUUID()}`,
            contentType: "image/jpeg",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a duplicate (r2_bucket, r2_key)", async () => {
    const key = `org/${orgAId}/evidence/${randomUUID()}`;
    await withTenant(orgAId, (tx) =>
      tx.attachment.create({
        data: {
          organizationId: orgAId,
          r2Bucket: "shift-ledger-eu",
          r2Key: key,
          contentType: "image/jpeg",
        },
      }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.create({
          data: {
            organizationId: orgAId,
            r2Bucket: "shift-ledger-eu",
            r2Key: key,
            contentType: "image/png",
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("attachments — uploaded_by tenant-membership composite FK", () => {
  it("rejects an uploader who is not a member of the attachment's org", async () => {
    // Org B's seeded member is not a member of org A → the (orgA, uploaded_by) composite FK to
    // memberships(organization_id, user_id) has no matching target.
    const b = await makeCompletion(orgBId); // gives us an org-B member user id
    await expect(makeAttachment(orgAId, b.userId)).rejects.toThrow();
  });

  it("accepts an uploader who is a member of the org", async () => {
    const a = await makeCompletion(orgAId);
    await expect(makeAttachment(orgAId, a.userId)).resolves.toBeTruthy();
  });
});

describe("evidence CHECKs — D4 attachment rule + value shape", () => {
  it("photo/file without an attachment is rejected", async () => {
    const { completionId } = await makeCompletion(orgAId);
    for (const type of ["photo", "file"] as const) {
      await expect(
        withTenant(orgAId, (tx) =>
          tx.evidence.create({
            data: { organizationId: orgAId, taskCompletionId: completionId, type },
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it("photo WITH an attachment succeeds", async () => {
    const { completionId } = await makeCompletion(orgAId);
    const attachmentId = await makeUploadedAttachment(orgAId);
    const ev = await withTenant(orgAId, (tx) =>
      tx.evidence.create({
        data: {
          organizationId: orgAId,
          taskCompletionId: completionId,
          type: "photo",
          attachmentId,
        },
        select: { id: true },
      }),
    );
    expect(ev.id).toBeTruthy();
  });

  it("non-binary evidence (note) carrying an attachment is rejected", async () => {
    const { completionId } = await makeCompletion(orgAId);
    const attachmentId = await makeUploadedAttachment(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.evidence.create({
          data: {
            organizationId: orgAId,
            taskCompletionId: completionId,
            type: "note",
            valueText: "has a stray attachment",
            attachmentId,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("value-shape: temperature needs value_numeric, checkbox needs value_bool, note/initials need value_text", async () => {
    const { completionId } = await makeCompletion(orgAId);
    const bad = (data: Record<string, unknown>) =>
      withTenant(orgAId, (tx) =>
        tx.evidence.create({
          data: { organizationId: orgAId, taskCompletionId: completionId, ...data } as never,
        }),
      );
    await expect(bad({ type: "temperature" })).rejects.toThrow(); // no value_numeric
    await expect(bad({ type: "checkbox" })).rejects.toThrow(); // no value_bool
    await expect(bad({ type: "note" })).rejects.toThrow(); // no value_text
    await expect(bad({ type: "initials" })).rejects.toThrow(); // no value_text
  });

  it("a signature with neither an attachment nor value_text is rejected (fail-closed proof)", async () => {
    const { completionId } = await makeCompletion(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.evidence.create({
          data: { organizationId: orgAId, taskCompletionId: completionId, type: "signature" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("a drawn signature (attachment, no value_text) is accepted", async () => {
    const { completionId } = await makeCompletion(orgAId);
    const attachmentId = await makeUploadedAttachment(orgAId);
    const ev = await withTenant(orgAId, (tx) =>
      tx.evidence.create({
        data: {
          organizationId: orgAId,
          taskCompletionId: completionId,
          type: "signature",
          attachmentId,
        },
        select: { id: true },
      }),
    );
    expect(ev.id).toBeTruthy();
  });

  it("valid typed evidence rows are accepted (temperature, checkbox, initials, typed signature)", async () => {
    const { completionId } = await makeCompletion(orgAId);
    const ok = (data: Record<string, unknown>) =>
      withTenant(orgAId, (tx) =>
        tx.evidence.create({
          data: { organizationId: orgAId, taskCompletionId: completionId, ...data } as never,
          select: { id: true },
        }),
      );
    await expect(ok({ type: "temperature", valueNumeric: "3.4" })).resolves.toBeTruthy();
    await expect(ok({ type: "checkbox", valueBool: true })).resolves.toBeTruthy();
    await expect(ok({ type: "initials", valueText: "AJ" })).resolves.toBeTruthy();
    // A typed signature carries no attachment (D4) — exempt from the binary CHECK in both directions.
    await expect(ok({ type: "signature", valueText: "Alex Jones" })).resolves.toBeTruthy();
  });
});

describe("evidence → attachment tenant-qualified composite FK", () => {
  it("evidence in org A cannot reference an org-B attachment", async () => {
    const { completionId } = await makeCompletion(orgAId);
    const bAttachment = await makeAttachment(orgBId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.evidence.create({
          data: {
            organizationId: orgAId,
            taskCompletionId: completionId,
            type: "photo",
            attachmentId: bAttachment, // cross-tenant attachment
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("attachments — r2_key must live under the row's org prefix", () => {
  it("rejects an r2_key that is not org-prefixed for this row's organization", async () => {
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.create({
          data: {
            organizationId: orgAId,
            r2Bucket: "shift-ledger-eu",
            r2Key: `org/${orgBId}/evidence/${randomUUID()}`, // another tenant's prefix
            contentType: "image/jpeg",
          },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("attachments — finalize write-once guard (F6)", () => {
  it("allows the pending→uploaded finalize (checksum + byte_size set once)", async () => {
    const id = await makeAttachment(orgAId);
    const finalized = await withTenant(orgAId, (tx) =>
      tx.attachment.update({
        where: { id },
        data: { status: "uploaded", byteSize: BigInt(1024), checksumSha256: "a".repeat(64) },
        select: { status: true, checksumSha256: true },
      }),
    );
    expect(finalized.status).toBe("uploaded");
    expect(finalized.checksumSha256).toBe("a".repeat(64));
  });

  it("rejects reverting status from uploaded back to pending", async () => {
    const id = await makeAttachment(orgAId);
    await withTenant(orgAId, (tx) =>
      tx.attachment.update({
        where: { id },
        data: { status: "uploaded", byteSize: BigInt(1024), checksumSha256: "b".repeat(64) },
      }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.update({ where: { id }, data: { status: "pending" } }),
      ),
    ).rejects.toThrow();
  });

  it("rejects rewriting a checksum once set, and rejects moving the r2_key", async () => {
    const id = await makeAttachment(orgAId);
    await withTenant(orgAId, (tx) =>
      tx.attachment.update({
        where: { id },
        data: { status: "uploaded", byteSize: BigInt(1024), checksumSha256: "c".repeat(64) },
      }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.update({ where: { id }, data: { checksumSha256: "d".repeat(64) } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.update({
          where: { id },
          data: { r2Key: `org/${orgAId}/evidence/${randomUUID()}` },
        }),
      ),
    ).rejects.toThrow();
  });

  it("still allows the soft-delete tombstone (deleted_at)", async () => {
    const id = await makeAttachment(orgAId);
    const tombstoned = await withTenant(orgAId, (tx) =>
      tx.attachment.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: { deletedAt: true },
      }),
    );
    expect(tombstoned.deletedAt).not.toBeNull();
  });
});

describe("#115 attachment/evidence integrity hardening", () => {
  it("freezes content_type after upload", async () => {
    const id = await makeUploadedAttachment(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.update({ where: { id }, data: { contentType: "application/pdf" } }),
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects a pending attachment that already carries integrity metadata", async () => {
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.create({
          data: {
            organizationId: orgAId,
            r2Bucket: "shift-ledger-eu",
            r2Key: `org/${orgAId}/evidence/${randomUUID()}`,
            contentType: "image/jpeg",
            checksumSha256: "a".repeat(64), // status defaults to pending -> forbidden
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a malformed checksum and a non-positive byte_size", async () => {
    const id = await makeAttachment(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.update({
          where: { id },
          data: { status: "uploaded", byteSize: BigInt(10), checksumSha256: "NOTHEX" },
        }),
      ),
    ).rejects.toThrow();
    const id2 = await makeAttachment(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.attachment.update({
          where: { id: id2 },
          data: { status: "uploaded", byteSize: BigInt(0), checksumSha256: "a".repeat(64) },
        }),
      ),
    ).rejects.toThrow();
  });

  it("forbids stray value columns on typed evidence (temperature with value_text)", async () => {
    const { completionId } = await makeCompletion(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.evidence.create({
          data: {
            organizationId: orgAId,
            taskCompletionId: completionId,
            type: "temperature",
            valueNumeric: "3.4",
            valueText: "stray", // exclusive CHECK rejects
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects binary evidence referencing a pending (not-yet-uploaded) attachment", async () => {
    const { completionId } = await makeCompletion(orgAId);
    const pending = await makeAttachment(orgAId); // still pending
    await expect(
      withTenant(orgAId, (tx) =>
        tx.evidence.create({
          data: {
            organizationId: orgAId,
            taskCompletionId: completionId,
            type: "photo",
            attachmentId: pending,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects binary evidence referencing a soft-deleted attachment", async () => {
    const { completionId } = await makeCompletion(orgAId);
    const id = await makeUploadedAttachment(orgAId);
    await withTenant(orgAId, (tx) =>
      tx.attachment.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        tx.evidence.create({
          data: {
            organizationId: orgAId,
            taskCompletionId: completionId,
            type: "file",
            attachmentId: id,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
