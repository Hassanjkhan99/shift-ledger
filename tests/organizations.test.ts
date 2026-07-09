import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { createOrganizationForUser } from "../src/lib/organizations";

// #133 — createOrganizationForUser() is the sole no-tenant -> new-tenant bootstrap: a signed-in user with
// no org creates one and becomes its Owner. It must (a) mint the tenant and pass RLS with the freshly
// minted id, (b) create the domain users row + the Owner membership, (c) write the organization.created
// audit row, and (d) keep everything invisible to other tenants (D6).
afterAll(async () => {
  await disconnect();
});

function uniqueSlug(): string {
  return `org-${randomUUID().slice(0, 8)}`;
}

describe("createOrganizationForUser (#133)", () => {
  it("creates the org, domain user, Owner membership, and an organization.created audit row", async () => {
    const email = `orgowner-${randomUUID()}@example.com`;
    const slug = uniqueSlug();

    const result = await createOrganizationForUser({
      email,
      userName: "Owner One",
      name: "Acme Hotel Group",
      slug,
      defaultTimezone: "Europe/Berlin",
      defaultLocale: "de",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const organizationId = result.organizationId;

    await withTenant(organizationId, async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true, defaultTimezone: true, defaultLocale: true },
      });
      expect(org).not.toBeNull();
      expect(org!.slug).toBe(slug);
      expect(org!.defaultTimezone).toBe("Europe/Berlin");

      const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
      expect(user).not.toBeNull();

      const membership = await tx.membership.findFirst({
        where: { userId: user!.id },
        select: { role: true, status: true, organizationId: true },
      });
      expect(membership).not.toBeNull();
      expect(membership!.role).toBe("Owner");
      expect(membership!.status).toBe("active");
      expect(membership!.organizationId).toBe(organizationId);

      const audit = await tx.activityLog.findFirst({
        where: { action: "organization.created" },
        select: { subjectType: true, subjectId: true, actorUserId: true },
      });
      expect(audit).not.toBeNull();
      expect(audit!.subjectType).toBe("organization");
      expect(audit!.subjectId).toBe(organizationId);
      expect(audit!.actorUserId).toBe(user!.id);
    });
  });

  it("returns a slug conflict when the slug is already taken", async () => {
    const slug = uniqueSlug();
    const first = await createOrganizationForUser({
      email: `first-${randomUUID()}@example.com`,
      name: "First Org",
      slug,
      defaultTimezone: "Europe/Berlin",
      defaultLocale: "de",
    });
    expect(first.status).toBe("ok");

    const second = await createOrganizationForUser({
      email: `second-${randomUUID()}@example.com`,
      name: "Second Org",
      slug, // same slug
      defaultTimezone: "Europe/Amsterdam",
      defaultLocale: "nl",
    });
    expect(second).toEqual({ status: "conflict", field: "slug" });
  });

  it("reuses the existing domain user when they create a second org", async () => {
    const email = `serial-${randomUUID()}@example.com`;
    const a = await createOrganizationForUser({
      email,
      name: "Org A",
      slug: uniqueSlug(),
      defaultTimezone: "Europe/Berlin",
      defaultLocale: "de",
    });
    const b = await createOrganizationForUser({
      email,
      name: "Org B",
      slug: uniqueSlug(),
      defaultTimezone: "Europe/Berlin",
      defaultLocale: "de",
    });
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;

    // Same domain user id owns both orgs (the users row was upserted, not duplicated).
    const idA = await withTenant(a.organizationId, async (tx) => {
      const u = await tx.user.findUnique({ where: { email }, select: { id: true } });
      const m = await tx.membership.findFirst({ where: { userId: u!.id }, select: { role: true } });
      expect(m!.role).toBe("Owner");
      return u!.id;
    });
    const idB = await withTenant(b.organizationId, async (tx) => {
      const u = await tx.user.findUnique({ where: { email }, select: { id: true } });
      return u!.id;
    });
    expect(idA).toBe(idB);
  });

  it("keeps the new org's membership invisible to another tenant (RLS, D6)", async () => {
    const created = await createOrganizationForUser({
      email: `isolated-${randomUUID()}@example.com`,
      name: "Isolated Org",
      slug: uniqueSlug(),
      defaultTimezone: "Europe/Berlin",
      defaultLocale: "de",
    });
    expect(created.status).toBe("ok");
    if (created.status !== "ok") return;

    // A second, unrelated org used as the "other tenant" viewport.
    const other = await createOrganizationForUser({
      email: `other-${randomUUID()}@example.com`,
      name: "Other Org",
      slug: uniqueSlug(),
      defaultTimezone: "Europe/Berlin",
      defaultLocale: "de",
    });
    expect(other.status).toBe("ok");
    if (other.status !== "ok") return;

    // Under the other tenant's scope, the created org's rows are not visible even by explicit id filter.
    const leaked = await withTenant(other.organizationId, (tx) =>
      tx.membership.findFirst({ where: { organizationId: created.organizationId } }),
    );
    expect(leaked).toBeNull();
  });
});
