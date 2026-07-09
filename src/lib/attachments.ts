// Attachment domain rules (#104; parent epic #12). This module owns the D4 decision: WHEN a piece of
// evidence must carry a binary R2 attachment at all. The R2 client + presign (#105), finalize (#106),
// and signed GET view (#107) build on top of it.
//
// D4 (§10.1, §11.9) - the rule keys off DRAWN-vs-TYPED, not the evidence type name:
//   requires_attachment = (type IN ('photo','file')) OR (type = 'signature' AND signature_mode = 'drawn')
// A typed initials / PIN sign-off needs NO binary; a drawn (canvas) signature does. Getting this
// wrong either rejects valid typed sign-offs or lets a "drawn signature" through with no image.
//
// The DB half of this rule lives in the 20260707120000_attachments migration: photo/file ALWAYS
// require an attachment and note/temperature/checkbox/initials NEVER do (CHECK constraints). 'signature'
// is deliberately exempt from those CHECKs in BOTH directions because the drawn-vs-typed distinction is
// not stored on the evidence row - so THIS helper is the single authority for signatures, enforced by
// the write layer (POST /evidence, #105; the completion Server Action, #17).

import type { EvidenceType } from "../generated/prisma/enums";

/** How a `signature` evidence item was captured. `drawn` = canvas stroke image (needs an attachment);
 *  `typed` = keyed initials/name (no attachment). Irrelevant for non-signature evidence types. */
export type SignatureMode = "drawn" | "typed";

/**
 * D4 - does this evidence item require a binary R2 attachment?
 *
 * - `photo`, `file` -> always true (the proof IS the file).
 * - `signature` -> true only when captured as `drawn` (canvas image); a `typed` signature is false.
 * - `note`, `temperature`, `checkbox`, `initials` -> always false (their proof is a typed value).
 *
 * `signatureMode` is only consulted for `type === 'signature'`; it is ignored otherwise.
 */
export function requiresAttachment(
  type: EvidenceType,
  signatureMode?: SignatureMode | null,
): boolean {
  if (type === "photo" || type === "file") return true;
  if (type === "signature") return signatureMode === "drawn";
  return false;
}
