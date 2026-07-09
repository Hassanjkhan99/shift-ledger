// Attachment finalize (#106; parent epic #12) — the step that makes an uploaded object USABLE evidence.
//
// After the client PUTs bytes directly to R2 (#105), finalize is the trust boundary: it fetches the
// object, rejects MIME spoofing (actual bytes must match the claimed type), strips EXIF/GPS from photos
// (preserving the capture timestamp), computes the REQUIRED SHA-256 (F6 - folded into the #13 hash
// chain), and flips status pending -> uploaded. It FAILS CLOSED: any problem leaves the row pending and
// unusable. It is IDEMPOTENT: re-finalizing an already-uploaded object returns the recorded result.
import { createHash } from "node:crypto";
import type { ObjectStore } from "./storage";
import type { TenantClient } from "./db";
import { detectContentType, sanitizeImage } from "./image-sanitize";

export interface FinalizeResult {
  attachmentId: string;
  status: "uploaded";
  byteSize: number;
  checksumSha256: string;
  capturedAt: Date | null;
  /** True when the row was already uploaded (idempotent no-op / concurrent-finalize race). */
  alreadyFinalized: boolean;
}

export async function finalizeAttachment(
  store: ObjectStore,
  tx: TenantClient,
  args: { organizationId: string; attachmentId: string },
): Promise<FinalizeResult> {
  const row = await tx.attachment.findUnique({
    where: { id: args.attachmentId },
    select: {
      id: true,
      r2Key: true,
      contentType: true,
      status: true,
      byteSize: true,
      checksumSha256: true,
      capturedAt: true,
    },
  });
  if (!row) throw new Error("finalize: attachment not found");

  // Idempotent: an already-finalized row is returned as-is (safe retry).
  if (row.status === "uploaded") {
    if (!row.checksumSha256 || row.byteSize === null) {
      // Unreachable given the attachments_uploaded_requires_checksum CHECK, but fail closed if seen.
      throw new Error("finalize: uploaded row missing checksum/size");
    }
    return {
      attachmentId: row.id,
      status: "uploaded",
      byteSize: Number(row.byteSize),
      checksumSha256: row.checksumSha256,
      capturedAt: row.capturedAt,
      alreadyFinalized: true,
    };
  }

  const bytes = await store.getObject(row.r2Key);
  if (!bytes) throw new Error("finalize: object missing in store"); // fail closed

  // MIME anti-spoof: the actual leading bytes must match the claimed content type.
  const detected = detectContentType(bytes);
  if (detected !== row.contentType) {
    throw new Error(
      `finalize: content mismatch (claimed ${row.contentType}, detected ${detected ?? "unknown"})`,
    );
  }

  // Strip EXIF/GPS (photos) + recover capture time; re-put the sanitized object so R2 holds clean bytes.
  const { sanitized, capturedAt } = sanitizeImage(row.contentType, bytes);
  if (sanitized !== bytes) {
    await store.putObject(row.r2Key, sanitized, row.contentType);
  }

  const checksumSha256 = createHash("sha256").update(sanitized).digest("hex");
  const byteSize = sanitized.byteLength;

  // Atomic compare-and-set: only a still-pending row flips to uploaded. Raw SQL (not a Prisma .update)
  // because (a) this is a conditional pending->uploaded CAS for idempotency + concurrency, and (b)
  // attachments are NOT an activity_subject_type, so this lifecycle write is deliberately outside the F4
  // transition() choke point (RLS still scopes it to the tenant; the AND on organization_id is explicit
  // belt-and-braces). The write-once guard trigger permits exactly this transition.
  const changed = await tx.$executeRaw`
    UPDATE "attachments"
       SET "status" = 'uploaded',
           "byte_size" = ${byteSize},
           "checksum_sha256" = ${checksumSha256},
           "captured_at" = ${capturedAt},
           "updated_at" = now()
     WHERE "id" = ${args.attachmentId}::uuid
       AND "organization_id" = ${args.organizationId}::uuid
       AND "status" = 'pending'`;

  if (changed === 0) {
    // Lost the race to a concurrent finalize; return the recorded result (idempotent).
    const now = await tx.attachment.findUniqueOrThrow({
      where: { id: args.attachmentId },
      select: { byteSize: true, checksumSha256: true, capturedAt: true },
    });
    if (!now.checksumSha256 || now.byteSize === null) {
      throw new Error("finalize: concurrent finalize left row unverifiable");
    }
    return {
      attachmentId: args.attachmentId,
      status: "uploaded",
      byteSize: Number(now.byteSize),
      checksumSha256: now.checksumSha256,
      capturedAt: now.capturedAt,
      alreadyFinalized: true,
    };
  }

  return {
    attachmentId: args.attachmentId,
    status: "uploaded",
    byteSize,
    checksumSha256,
    capturedAt,
    alreadyFinalized: false,
  };
}
