// HTTP auth seam for the thin REST surface (#105 uploads, #107 view, #14 export download).
//
// Reads (RSC) and writes (Server Actions) get their tenant context from the session elsewhere; the few
// HTTP routes need the same. This is the SINGLE place that resolves a request -> { organizationId,
// userId } and it FAILS CLOSED: with no valid session it returns null and the caller must 401.
//
// NOTE (codebase reality): a session provider (Better Auth per the design) is not wired into this tree
// yet, so resolveMemberContext currently has no session to read and returns null. When the session
// layer lands, its lookup (session -> active_organization_id + user id + active-membership check)
// plugs in HERE, and every HTTP route inherits authenticated, tenant-scoped access with no call-site
// changes. Route handlers are written and tested against this seam via dependency injection.
export interface MemberContext {
  organizationId: string;
  userId: string;
}

/**
 * Resolve the authenticated member context for an HTTP request, or null if there is no valid session /
 * active organization. Fail-closed by construction. Wire the real session lookup in here.
 */
export async function resolveMemberContext(): Promise<MemberContext | null> {
  return null;
}
