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
 * Resolve a short-lived signed GET URL for the attachment behind an EVIDENCE row the current tenant may
 * view (the documented `GET /evidence/:id/view` uses the Evidence id, §11.9 — #119), or null when the
 * evidence is not visible (cross-tenant / not found by RLS), carries no attachment, or that attachment
 * is not a live uploaded object. Resolving via the evidence row (not a bare attachment id) means an
 * attachment can only be viewed when it is actually linked to visible evidence. Null -> the route
 * returns a 404-style non-disclosure (never confirms the object exists).
 */
export async function resolveEvidenceViewUrl(
  store: ObjectStore,
  tx: TenantClient,
  evidenceId: string,
): Promise<EvidenceViewUrl | null> {
  const ev = await tx.evidence.findUnique({
    where: { id: evidenceId },
    select: { attachment: { select: { r2Key: true, status: true, deletedAt: true } } },
  });
  const att = ev?.attachment;
  // Only a live, uploaded object linked to this evidence is viewable; anything else reads as "absent".
  if (!att || att.status !== "uploaded" || att.deletedAt) return null;
  const signed = await store.presignGet(att.r2Key); // default TTL <= 5 min (§10.5/§22)
  return { url: signed.url, expiresIn: signed.expiresIn };
}
