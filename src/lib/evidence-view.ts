// Signed evidence view (#107; parent epic #12) — the ONLY read path to a binary evidence object.
//
// Files are never public and never proxied through the app (spine item 7, §22): the sole way to see
// one is a short-lived presigned GET (<= 5 min TTL), issued only after the tenant policy confirms the
// caller may see it. Tenant scoping is enforced by RLS: a findUnique under withTenant(orgA) simply
// returns null for an org-B (or nonexistent) attachment, so the caller cannot even learn it exists.
import type { ObjectStore } from "./storage";
import type { TenantClient } from "./db";

export interface EvidenceViewUrl {
  url: string;
  expiresIn: number;
}

/**
 * Resolve a short-lived signed GET URL for an uploaded attachment the current tenant may view, or null
 * when it is not visible (cross-tenant / not found by RLS), not yet uploaded, or soft-deleted. Null ->
 * the route returns a 404-style non-disclosure (never confirms the object exists).
 */
export async function resolveAttachmentViewUrl(
  store: ObjectStore,
  tx: TenantClient,
  attachmentId: string,
): Promise<EvidenceViewUrl | null> {
  const row = await tx.attachment.findUnique({
    where: { id: attachmentId },
    select: { r2Key: true, status: true, deletedAt: true },
  });
  // Only a live, uploaded object is viewable. Anything else is indistinguishable from "does not exist".
  if (!row || row.status !== "uploaded" || row.deletedAt) return null;
  const signed = await store.presignGet(row.r2Key); // default TTL <= 5 min (§10.5/§22)
  return { url: signed.url, expiresIn: signed.expiresIn };
}
