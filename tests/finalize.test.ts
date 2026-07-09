import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { InMemoryObjectStore } from "../src/lib/storage";
import { buildEvidenceKey } from "../src/lib/uploads";
import { finalizeAttachment } from "../src/lib/finalize";
import { detectContentType, sanitizeImage } from "../src/lib/image-sanitize";

// #106 — finalize: MIME magic-byte validation, EXIF/GPS strip (capture ts preserved), SHA-256 over the
// sanitized durable bytes, atomic pending->uploaded CAS, fail-closed + idempotent.
const orgAId = inject("orgAId");

afterAll(async () => {
  await disconnect();
});

const s = (str: string): number[] => [...str].map((c) => c.charCodeAt(0));
const u16be = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number): number[] => [
  (n >> 24) & 0xff,
  (n >> 16) & 0xff,
  (n >> 8) & 0xff,
  n & 0xff,
];

/** Build a minimal JPEG carrying an EXIF APP1 with a DateTime (0x0132) tag + a recognizable
 *  "GPSFAKE…" payload standing in for a GPS sub-IFD, so we can assert both are stripped. */
function buildExifJpeg(dateStr: string): Uint8Array {
  const dt = s(dateStr + "\0");
  const gpsFake = s("GPSFAKE-53.1-6.5");
  // TIFF (big-endian): header(8) + IFD0(count=1, one 12-byte entry, next=0) => IFD0 ends at 26.
  const strOff = 26;
  const tiff: number[] = [
    ...s("MM"),
    ...u16be(0x002a),
    ...u32be(8), // IFD0 at offset 8
    ...u16be(1), // 1 entry
    ...u16be(0x0132), // DateTime
    ...u16be(2), // ASCII
    ...u32be(dt.length),
    ...u32be(strOff), // value offset (TIFF-relative)
    ...u32be(0), // next IFD
    ...dt, // string at offset 26
    ...gpsFake, // stand-in EXIF payload to prove stripping
  ];
  const app1Payload = [...s("Exif"), 0, 0, ...tiff];
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe1,
    ...u16be(app1Payload.length + 2),
    ...app1Payload, // APP1 (EXIF)
    0xff,
    0xda,
    0x00,
    0x02, // SOS (no scan data)
    0xff,
    0xd9, // EOI
  ]);
}

const PDF_BYTES = Uint8Array.from(s("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"));

async function stagePending(
  store: InMemoryObjectStore,
  orgId: string,
  contentType: string,
  ext: string,
  bytes: Uint8Array,
): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const member = await tx.membership.findFirstOrThrow();
    const r2Key = buildEvidenceKey(orgId, randomUUID(), ext);
    const a = await tx.attachment.create({
      data: {
        organizationId: orgId,
        r2Bucket: store.bucket,
        r2Key,
        contentType,
        uploadedBy: member.userId,
      },
      select: { id: true },
    });
    await store.putObject(r2Key, bytes, contentType);
    return a.id;
  });
}

describe("detectContentType + sanitizeImage (unit)", () => {
  it("detects the allowlisted types by magic bytes and rejects unknown", () => {
    expect(detectContentType(buildExifJpeg("2024:01:01 00:00:00"))).toBe("image/jpeg");
    expect(detectContentType(PDF_BYTES)).toBe("application/pdf");
    expect(detectContentType(Uint8Array.from(s("<html></html>")))).toBeNull();
  });

  it("strips EXIF/GPS from a JPEG while recovering the capture timestamp", () => {
    const { sanitized, capturedAt } = sanitizeImage(
      "image/jpeg",
      buildExifJpeg("2024:03:15 09:30:00"),
    );
    expect(capturedAt?.toISOString()).toBe("2024-03-15T09:30:00.000Z");
    const asText = String.fromCharCode(...sanitized);
    expect(asText.includes("Exif")).toBe(false); // APP1 EXIF removed
    expect(asText.includes("GPSFAKE")).toBe(false); // GPS payload (in that APP1) removed
    expect(sanitized[0]).toBe(0xff); // still a JPEG
    expect(sanitized[1]).toBe(0xd8);
  });
});

describe("finalizeAttachment", () => {
  it("validates, sanitizes, checksums, and flips pending->uploaded", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const id = await stagePending(
      store,
      orgAId,
      "image/jpeg",
      "jpg",
      buildExifJpeg("2024:03:15 09:30:00"),
    );

    const result = await withTenant(orgAId, (tx) =>
      finalizeAttachment(store, tx, { organizationId: orgAId, attachmentId: id }),
    );
    expect(result.status).toBe("uploaded");
    expect(result.alreadyFinalized).toBe(false);
    expect(result.capturedAt?.toISOString()).toBe("2024-03-15T09:30:00.000Z");

    // Checksum equals SHA-256 of the sanitized durable bytes now in the store.
    const stored = await store.getObject(
      await withTenant(orgAId, (tx) =>
        tx.attachment
          .findUniqueOrThrow({ where: { id }, select: { r2Key: true } })
          .then((r) => r.r2Key),
      ),
    );
    const expected = createHash("sha256").update(stored!).digest("hex");
    expect(result.checksumSha256).toBe(expected);
    expect(result.byteSize).toBe(stored!.byteLength);

    const row = await withTenant(orgAId, (tx) =>
      tx.attachment.findUniqueOrThrow({
        where: { id },
        select: { status: true, checksumSha256: true, byteSize: true },
      }),
    );
    expect(row.status).toBe("uploaded");
    expect(row.checksumSha256).toBe(expected);
    expect(Number(row.byteSize)).toBe(stored!.byteLength);
  });

  it("rejects MIME spoofing and leaves the row pending (fail closed)", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    // Claims image/jpeg, but the object bytes are actually a PDF.
    const id = await stagePending(store, orgAId, "image/jpeg", "jpg", PDF_BYTES);
    await expect(
      withTenant(orgAId, (tx) =>
        finalizeAttachment(store, tx, { organizationId: orgAId, attachmentId: id }),
      ),
    ).rejects.toThrow();
    const row = await withTenant(orgAId, (tx) =>
      tx.attachment.findUniqueOrThrow({
        where: { id },
        select: { status: true, checksumSha256: true },
      }),
    );
    expect(row.status).toBe("pending");
    expect(row.checksumSha256).toBeNull();
  });

  it("fails closed when the object is missing from the store", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const id = await withTenant(orgAId, async (tx) => {
      const member = await tx.membership.findFirstOrThrow();
      const a = await tx.attachment.create({
        data: {
          organizationId: orgAId,
          r2Bucket: store.bucket,
          r2Key: buildEvidenceKey(orgAId, randomUUID(), "jpg"),
          contentType: "image/jpeg",
          uploadedBy: member.userId,
        },
        select: { id: true },
      });
      return a.id;
    });
    await expect(
      withTenant(orgAId, (tx) =>
        finalizeAttachment(store, tx, { organizationId: orgAId, attachmentId: id }),
      ),
    ).rejects.toThrow();
  });

  it("is idempotent: re-finalize returns the recorded result", async () => {
    const store = new InMemoryObjectStore("shift-ledger-eu");
    const id = await stagePending(store, orgAId, "application/pdf", "pdf", PDF_BYTES);
    const first = await withTenant(orgAId, (tx) =>
      finalizeAttachment(store, tx, { organizationId: orgAId, attachmentId: id }),
    );
    const second = await withTenant(orgAId, (tx) =>
      finalizeAttachment(store, tx, { organizationId: orgAId, attachmentId: id }),
    );
    expect(first.alreadyFinalized).toBe(false);
    expect(second.alreadyFinalized).toBe(true);
    expect(second.checksumSha256).toBe(first.checksumSha256);
    expect(second.capturedAt).toBeNull(); // PDF has no capture time
  });
});
