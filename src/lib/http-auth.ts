// HTTP auth seam for the thin REST surface (#105 uploads, #106 finalize, #107 view, #14 export download).
//
// As of #114 this is backed by Better Auth: resolveMemberContext() reads the authenticated session
// (cookie or `Authorization: Bearer`), then maps the user's email to an ACTIVE membership to produce the
// tenant/authorization context { organizationId, userId, role }. It FAILS CLOSED: no session, no
// selected org, or no active membership -> null, and the caller 401s.
//
// Active-organization selection: the caller names the org via the `x-organization-id` header. This only
// SELECTS among orgs; it grants nothing on its own — the membership lookup runs under withTenant(orgId)
// RLS, so a caller can only obtain context for an org they are actually an active member of. (Persisting
// the active org on the session is a UX refinement; the header is the mechanism.)
import { getAuth } from "./auth";
import { withTenant } from "./db";
import type { OrgRole } from "../generated/prisma/enums";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface MemberContext {
  organizationId: string;
  userId: string;
  role: OrgRole;
  // Property IDs this membership is limited to (empty = whole org). Used by read-scope filtering in the
  // GraphQL layer (#15). Additive: existing REST callers destructure { organizationId, userId, role }.
  propertyScope: string[];
}

/**
 * Resolve the authenticated member context for a set of request `headers` and an EXPLICIT organization
 * id, or null if there is no valid session, the org id is malformed, or the user is not an active
 * member of it. Fail-closed by construction. This is the shared core: the REST seam
 * (resolveMemberContext) reads the org from the `x-organization-id` header; Server Actions (#17) pass
 * the active org directly (they have no such header), calling this with `await headers()`.
 */
export async function resolveMemberForOrg(
  headers: Headers,
  orgId: string,
): Promise<MemberContext | null> {
  const session = await getAuth().api.getSession({ headers });
  const email = session?.user?.email;
  if (!email) return null;
  return resolveMemberForEmail(email, orgId);
}

/**
 * Resolve the member context for an already-authenticated `email` and an EXPLICIT organization id, or
 * null if the org id is malformed or the user is not an active member of it. This is the membership half
 * of {@link resolveMemberForOrg}, split out so a caller that has already fetched the session (the
 * `(app)/[org]` layout, #131) can distinguish "no session" from "session but not a member" — the former
 * redirects to sign-in, the latter is a 404 — without a second session lookup.
 */
export async function resolveMemberForEmail(
  email: string,
  orgId: string,
): Promise<MemberContext | null> {
  if (!UUID_RE.test(orgId)) return null;

  return withTenant(orgId, async (tx) => {
    // `users` is global (no RLS); memberships is RLS-scoped to orgId, so this only finds a membership
    // when the authenticated user genuinely belongs to the named org.
    const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return null;
    const membership = await tx.membership.findFirst({
      where: { userId: user.id, status: "active", deletedAt: null },
      select: { role: true, propertyScope: true },
    });
    if (!membership) return null;
    return {
      organizationId: orgId,
      userId: user.id,
      role: membership.role,
      propertyScope: membership.propertyScope,
    };
  });
}

/**
 * Resolve the authenticated member context for an HTTP request, or null if there is no valid session,
 * no selected organization, or the user is not an active member of it. Fail-closed by construction.
 */
export async function resolveMemberContext(req: Request): Promise<MemberContext | null> {
  const orgId = req.headers.get("x-organization-id");
  if (!orgId) return null;
  return resolveMemberForOrg(req.headers, orgId);
}
