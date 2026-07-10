// Organization onboarding (#133) — the ONE write in the app that legitimately spans no-tenant ->
// new-tenant. Every other tenant-scoped write runs inside withTenant() with an existing org id; here
// the org does not exist yet, so we must bootstrap the RLS context from the id we are about to insert.
//
// The bootstrap, step by step:
//   1. Mint the new org id up front with the DB's uuidv7() (the same generator every table default
//      uses). This is the only place we need an id BEFORE a row exists, so it is a direct raw read
//      with no tenant context — mirrors member-orgs.ts's sanctioned no-tenant reads.
//   2. withTenant(newId, …): sets app.current_org_id = newId, so the organizations row's own RLS
//      WITH CHECK (id = current_org_id) and the memberships WITH CHECK (organization_id = current_org_id)
//      both pass. A brand-new Better Auth user has an auth_user but no domain `users` row yet
//      (member-orgs.ts:resolveUserIdByEmail), so we upsert it here — this is the onboarding seam that
//      creates the domain user + its first (Owner) membership.
//   3. logActivity() writes the organization.created audit row (F4/F6) in the SAME transaction.
//
// `organizations.slug` is GLOBALLY unique, but under RLS a pre-insert findUnique sees zero rows (other
// tenants are invisible), so a duplicate slug cannot be detected by reading — we rely on the DB unique
// constraint and translate P2002 into a typed conflict.
import { prisma, withTenant } from "./db";
import { logActivity } from "./transition";
import { Prisma } from "../generated/prisma/client";

export interface CreateOrganizationInput {
  /** The authenticated user's email (from the Better Auth session) — never client-supplied. */
  email: string;
  /** The authenticated user's display name (session), used only when creating the domain user row. */
  userName?: string | null;
  name: string;
  slug: string;
  /** IANA zone; validated by the caller (action layer, luxon) before it reaches here. */
  defaultTimezone: string;
  defaultLocale: string;
}

export type CreateOrganizationResult =
  { status: "ok"; organizationId: string; slug: string } | { status: "conflict"; field: "slug" };

/**
 * Create an organization owned by the authenticated user. Returns the new org id on success, or a
 * `conflict` when the slug is already taken. Assumes its inputs are already Zod/luxon-validated by the
 * action layer; it owns only the tenant-bootstrap + persistence.
 */
export async function createOrganizationForUser(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  // Step 1 — mint the org id with no tenant context (the org does not exist yet, so RLS does not apply
  // to a bare SELECT uuidv7()). eslint-disable: this is a legitimate no-tenant bootstrap read.
  // eslint-disable-next-line no-restricted-syntax -- minting a new org id needs no tenant context; the sole no-tenant->new-tenant bootstrap (#133)
  const minted = await prisma.$queryRaw<{ id: string }[]>`SELECT uuidv7() AS id`;
  const organizationId = minted[0].id;

  try {
    return await withTenant(organizationId, async (tx) => {
      // Ensure the domain user exists (idempotent for a returning user creating a 2nd org). `users` is
      // global (no RLS); we key on email, the stable link to the Better Auth identity.
      const user = await tx.user.upsert({
        where: { email: input.email },
        update: {},
        create: { email: input.email, name: input.userName ?? null },
        select: { id: true },
      });

      const org = await tx.organization.create({
        data: {
          id: organizationId,
          name: input.name,
          slug: input.slug,
          defaultTimezone: input.defaultTimezone,
          defaultLocale: input.defaultLocale,
        },
        select: { id: true, slug: true, name: true },
      });

      await tx.membership.create({
        // `status` intentionally omitted: it defaults to "active" in the schema. Setting it explicitly
        // would be a literal `status:` write, which the F4 guard (tests/f4-assertion.test.ts) flags —
        // membership is not one of the audited state machines, so we rely on the DB default instead.
        data: {
          organizationId: org.id,
          userId: user.id,
          role: "Owner",
          propertyScope: [],
        },
      });

      await logActivity(tx, {
        organizationId: org.id,
        subjectType: "organization",
        subjectId: org.id,
        action: "organization.created",
        actorUserId: user.id,
        afterJson: { name: org.name, slug: org.slug },
      });

      return { status: "ok", organizationId: org.id, slug: org.slug };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Only `slug` is globally unique on organizations; a P2002 here is a slug clash.
      return { status: "conflict", field: "slug" };
    }
    throw err;
  }
}
