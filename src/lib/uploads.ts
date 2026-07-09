// Upload presign domain (#105; parent epic #12) — the R2 presigned-PUT primitive.
//
// Flow (§10.5, §11.9): the client asks for a presigned PUT via POST /api/uploads with
// { contentType, byteSize, kind }. We validate the MIME allowlist + per-class size limit (Zod, 422 on
// failure), insert a `pending` attachment row under an org-prefixed key, and hand back
// { uploadUrl, attachmentId, expiresIn }. The client then PUTs the bytes DIRECTLY to R2 (never through
// the app). Finalize (#106) later validates the bytes and records the checksum; nothing here trusts the
// object contents yet.
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { ObjectStore } from "./storage";
import type { TenantClient } from "./db";

/** MIME allowlist + per-type limits (§10.5): images <= 10 MB, documents <= 25 MB. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export const UPLOAD_ALLOWLIST = {
  "image/jpeg": { class: "image", ext: "jpg", maxBytes: IMAGE_MAX_BYTES },
  "image/png": { class: "image", ext: "png", maxBytes: IMAGE_MAX_BYTES },
  "image/webp": { class: "image", ext: "webp", maxBytes: IMAGE_MAX_BYTES },
  "application/pdf": { class: "document", ext: "pdf", maxBytes: DOCUMENT_MAX_BYTES },
} as const;

export type AllowedContentType = keyof typeof UPLOAD_ALLOWLIST;
export type UploadKind = "photo" | "file" | "signature";

/**
 * Presign request validation. Rejects (422) a non-allowlisted MIME type, a non-positive/over-limit
 * byte size, or a kind/type mismatch (photo & drawn signature must be images). The size ceiling is
 * per content-type class, so the boundary is checked against the RIGHT limit.
 */
export const presignUploadSchema = z
  .object({
    contentType: z.enum(
      Object.keys(UPLOAD_ALLOWLIST) as [AllowedContentType, ...AllowedContentType[]],
    ),
    byteSize: z.number().int().positive(),
    kind: z.enum(["photo", "file", "signature"]),
  })
  .superRefine((val, ctx) => {
    const spec = UPLOAD_ALLOWLIST[val.contentType];
    if (val.byteSize > spec.maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["byteSize"],
        message: `exceeds the ${spec.maxBytes}-byte limit for ${val.contentType}`,
      });
    }
    // photo / drawn signature are always images; a file may be an image or a PDF.
    if ((val.kind === "photo" || val.kind === "signature") && spec.class !== "image") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentType"],
        message: `kind '${val.kind}' requires an image content type`,
      });
    }
  });

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

/**
 * Org-prefixed R2 key (§8.16 / §10.5). Uses the id-only short form
 * `org/{orgId}/evidence/{objectId}.{ext}`: at presign time the completion/evidence ids and the content
 * hash from the fuller §10.5 layout do not exist yet, and R2 objects are not cheaply renamable
 * afterwards. The security-relevant part — the `org/{orgId}/` tenant prefix (enforced by the
 * attachments_r2_key_org_prefixed CHECK) — is preserved, and the key carries only ids, never PII.
 */
export function buildEvidenceKey(orgId: string, objectId: string, ext: string): string {
  return `org/${orgId}/evidence/${objectId}.${ext}`;
}

/** Org-prefixed key for a generated export pack (§22). Same org/{orgId}/ tenant prefix as evidence. */
export function buildExportKey(orgId: string, exportJobId: string): string {
  return `org/${orgId}/exports/${exportJobId}.pdf`;
}

export interface CreateUploadResult {
  uploadUrl: string;
  attachmentId: string;
  expiresIn: number;
}

/**
 * Core presign + pending-row insert. Pure domain: caller supplies the validated input, the resolved
 * tenant/actor context, and the object store; this never reads a session. Returns the presigned PUT URL
 * and the new attachment id. The row is `pending` until finalize (#106) flips it to `uploaded`.
 */
export async function createUpload(
  store: ObjectStore,
  tx: TenantClient,
  args: { organizationId: string; uploadedBy: string; input: PresignUploadInput },
): Promise<CreateUploadResult> {
  const { organizationId, uploadedBy, input } = args;
  const spec = UPLOAD_ALLOWLIST[input.contentType];
  // The key's object id is independent of the row PK (which is DB-generated), so there is no
  // insert-then-rename: we know the key before the insert.
  const r2Key = buildEvidenceKey(organizationId, randomUUID(), spec.ext);

  // status defaults to 'pending' at the DB (attachments_status_check). We deliberately do NOT set it
  // here: attachments are not an activity_subject_type, so their pending->uploaded lifecycle is upload
  // mechanics, not an audited F4 transition — and omitting the literal keeps it out of the F4 scan.
  const attachment = await tx.attachment.create({
    data: {
      organizationId,
      r2Bucket: store.bucket,
      r2Key,
      contentType: input.contentType,
      uploadedBy,
    },
    select: { id: true },
  });

  const presigned = await store.presignPut(r2Key, { contentType: input.contentType });
  return { uploadUrl: presigned.url, attachmentId: attachment.id, expiresIn: presigned.expiresIn };
}
