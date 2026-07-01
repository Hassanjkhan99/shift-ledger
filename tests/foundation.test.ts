import { describe, it, expect, inject, afterAll } from "vitest";
import { prisma, withTenant, disconnect } from "../src/lib/db";

// Ids provided by tests/global-setup.ts after seeding two orgs.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

// Close the client + pg pool so the test process exits cleanly and the global-setup
// teardown reliably stops the embedded Postgres cluster (no orphaned server processes).
afterAll(async () => {
  await disconnect();
});

describe("RLS cross-tenant isolation (app_user connection)", () => {
  it("Org A context sees only Org A properties", async () => {
    const props = await withTenant(orgAId, (tx) => tx.property.findMany());
    expect(props.length).toBeGreaterThan(0);
    expect(props.every((p) => p.organizationId === orgAId)).toBe(true);
  });

  it("Org B context sees only Org B properties", async () => {
    const props = await withTenant(orgBId, (tx) => tx.property.findMany());
    expect(props.length).toBeGreaterThan(0);
    expect(props.every((p) => p.organizationId === orgBId)).toBe(true);
  });

  it("Org A can read only its own organization row", async () => {
    const orgs = await withTenant(orgAId, (tx) => tx.organization.findMany());
    expect(orgs.map((o) => o.id)).toEqual([orgAId]);
  });

  it("Org A cannot fetch a specific Org B outlet by id (no cross-tenant leak)", async () => {
    const bOutlet = await withTenant(orgBId, (tx) => tx.outlet.findFirst());
    expect(bOutlet).not.toBeNull();

    const leaked = await withTenant(orgAId, (tx) =>
      tx.outlet.findUnique({ where: { id: bOutlet!.id } }),
    );
    expect(leaked).toBeNull();
  });

  it("Org A cannot fetch a specific Org B membership by id", async () => {
    const bMembership = await withTenant(orgBId, (tx) => tx.membership.findFirst());
    expect(bMembership).not.toBeNull();

    const leaked = await withTenant(orgAId, (tx) =>
      tx.membership.findUnique({ where: { id: bMembership!.id } }),
    );
    expect(leaked).toBeNull();
  });

  it("no tenant context => default-deny (zero rows), proving no pooled-connection GUC leak", async () => {
    // No withTenant() wrapper: the GUC is unset/empty -> RLS returns nothing (NULLIF guards
    // against the empty-string reset value a rolled-back transaction-local GUC leaves behind).
    const props = await prisma.property.findMany();
    expect(props).toEqual([]);
  });
});

describe("activity_log is append-only (database-enforced)", () => {
  it("allows INSERT within the tenant", async () => {
    const row = await withTenant(orgAId, (tx) =>
      tx.activityLog.create({
        data: {
          organizationId: orgAId,
          subjectType: "organization",
          subjectId: orgAId,
          action: "test.insert",
          actorLabel: "system:test",
        },
      }),
    );
    expect(row.id).toBeTruthy();
  });

  it("rejects UPDATE at the database level", async () => {
    await expect(
      withTenant(orgAId, async (tx) => {
        const row = await tx.activityLog.findFirst();
        return tx.activityLog.update({ where: { id: row!.id }, data: { action: "tampered" } });
      }),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE at the database level", async () => {
    await expect(
      withTenant(orgAId, async (tx) => {
        const row = await tx.activityLog.findFirst();
        return tx.activityLog.delete({ where: { id: row!.id } });
      }),
    ).rejects.toThrow(/append-only/i);
  });
});
