import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { listMemberOrganizations, resolveUserIdByEmail } from "../src/lib/member-orgs";
import type { OrgRole } from "../src/generated/prisma/enums";

// #132 — listMemberOrganizations() is the caller's OWN cross-org membership list. `memberships` is
// RLS-scoped per org and the app runs as the non-BYPASSRLS app_user, so a direct read would see zero
// rows; the SECURITY DEFINER fn (prisma/superuser/0002_member_organizations.sql) does the privileged,
// user-keyed read. These tests prove it returns ONLY the user's active, non-deleted memberships — the
// scope guarantee the D6 RLS gate depends on.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Create a fresh domain user (global `users` table, no RLS — any tenant context works). */
async function createUser(): Promise<string> {
  const email = `memorgs-${randomUUID()}@example.com`;
  return withTenant(orgAId, async (tx) => {
    const u = await tx.user.create({
      data: { email, name: "Mem Orgs Test" },
      select: { id: true },
    });
    return u.id;
  });
}

async function addMembership(
  orgId: string,
  userId: string,
  opts: { role?: OrgRole; status?: string; deleted?: boolean } = {},
): Promise<void> {
  await withTenant(orgId, async (tx) => {
    await tx.membership.create({
      data: {
        organizationId: orgId,
        userId,
        role: opts.role ?? "KitchenManager",
        status: opts.status ?? "active",
        propertyScope: [],
        deletedAt: opts.deleted ? new Date() : null,
      },
    });
  });
}

describe("listMemberOrganizations (#132)", () => {
  it("returns only the caller's active, non-deleted memberships (excludes soft-deleted + other users)", async () => {
    const userX = await createUser();
    const userY = await createUser(); // a DIFFERENT user, also in org A — must not leak into userX's list
    await addMembership(orgAId, userX, { role: "ShiftLeader" });
    await addMembership(orgBId, userX, { deleted: true }); // soft-deleted -> excluded
    await addMembership(orgAId, userY, { role: "Owner" });

    const orgs = await listMemberOrganizations(userX);
    expect(orgs).toHaveLength(1);
    expect(orgs[0].id).toBe(orgAId);
    expect(orgs[0].role).toBe("ShiftLeader");
    expect(orgs[0].name).toBeTruthy();
    expect(orgs[0].slug).toBeTruthy();
  });

  it("excludes inactive memberships", async () => {
    const userZ = await createUser();
    await addMembership(orgAId, userZ, { status: "inactive" });
    expect(await listMemberOrganizations(userZ)).toEqual([]);
  });

  it("returns [] for a user with no memberships", async () => {
    expect(await listMemberOrganizations(randomUUID())).toEqual([]);
  });

  it("lists multiple active orgs, sorted by name", async () => {
    const userM = await createUser();
    await addMembership(orgAId, userM, { role: "Owner" });
    await addMembership(orgBId, userM, { role: "Auditor" });

    const orgs = await listMemberOrganizations(userM);
    expect(orgs).toHaveLength(2);
    // Seed names: "Demo Hotel Group A" < "Demo Hotel Group B" -> A first.
    expect(orgs[0].id).toBe(orgAId);
    expect(orgs[1].id).toBe(orgBId);
  });

  it("resolveUserIdByEmail resolves a domain user and returns null for an unknown email", async () => {
    const userId = await createUser();
    const email = await withTenant(orgAId, async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      return u!.email;
    });
    expect(await resolveUserIdByEmail(email)).toBe(userId);
    expect(await resolveUserIdByEmail(`missing-${randomUUID()}@example.com`)).toBeNull();
  });
});
