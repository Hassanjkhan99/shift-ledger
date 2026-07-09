// Caller's own cross-org membership list (#132 App entry & org routing).
//
// This is the ONE sanctioned cross-tenant read in the app, and it deliberately does NOT go through
// withTenant(): it must answer "which orgs does the authenticated user belong to?" BEFORE any single org
// is selected. `memberships` is RLS-scoped per org and the app runs as the non-BYPASSRLS app_user, so a
// direct read matches zero rows — the SECURITY DEFINER SQL function list_member_organizations()
// (prisma/superuser/0002_member_organizations.sql) does the privileged, user-keyed read. It only ever
// returns the caller's OWN membership list (org id/name/slug/role), never tenant data (D6 guardrail).
import { prisma } from "./db";
import type { OrgRole } from "../generated/prisma/enums";

export interface MemberOrg {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

type MemberOrgRow = { org_id: string; org_name: string; org_slug: string; role: OrgRole };

/**
 * Resolve the domain `users.id` for an authenticated email, or null if there is no domain user yet (a
 * brand-new Better Auth user has an auth_user but no domain users/membership row until onboarding). The
 * `users` table is GLOBAL (no RLS), so this direct read needs no tenant context.
 */
export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  // eslint-disable-next-line no-restricted-syntax -- `users` is a global, non-RLS table; resolving the caller's own id needs no tenant context
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * List the ACTIVE, non-deleted organizations the given user is a member of (with the user's role in
 * each), sorted by name. Empty when the user belongs to no org (⇒ onboarding). Keyed on the caller's own
 * `users.id`; do NOT pass another user's id — this bypasses RLS by design and is only safe for the
 * authenticated caller's own list.
 */
export async function listMemberOrganizations(userId: string): Promise<MemberOrg[]> {
  // eslint-disable-next-line no-restricted-syntax -- caller's OWN membership list via the SECURITY DEFINER fn (not tenant data); a direct app_user read is RLS-blocked to zero rows
  const rows = await prisma.$queryRaw<
    MemberOrgRow[]
  >`SELECT org_id, org_name, org_slug, role FROM list_member_organizations(${userId}::uuid)`;
  return rows.map((r) => ({ id: r.org_id, name: r.org_name, slug: r.org_slug, role: r.role }));
}
