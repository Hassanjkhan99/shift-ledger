import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import {
  createProperty,
  updateProperty,
  archiveProperty,
  createOutlet,
  updateOutlet,
  archiveOutlet,
} from "../src/lib/sites";

// #133 — Property/Outlet domain CRUD: unique-per-parent names, soft-delete (archive), audit rows, and
// tenant isolation. Runs the domain functions directly inside withTenant() (the action layer adds the
// auth + D7 role/scope guard, tested separately in site-input.test.ts).
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

async function makeUser(orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const u = await tx.user.create({
      data: { email: `sites-${randomUUID()}@example.com`, name: "Sites Test" },
      select: { id: true },
    });
    return u.id;
  });
}

function name(prefix: string): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

describe("property CRUD (#133)", () => {
  it("creates a property and writes a property.created audit row", async () => {
    const actorUserId = await makeUser(orgAId);
    const propName = name("Site");

    const result = await withTenant(orgAId, (tx) =>
      createProperty(tx, {
        organizationId: orgAId,
        actorUserId,
        name: propName,
        timezone: "Europe/Berlin",
        countryCode: "de",
        address: "1 Main St",
      }),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    await withTenant(orgAId, async (tx) => {
      const prop = await tx.property.findUnique({
        where: { id: result.propertyId },
        select: { name: true, countryCode: true, addressJson: true, deletedAt: true },
      });
      expect(prop!.name).toBe(propName);
      expect(prop!.countryCode).toBe("DE"); // normalized to upper-case
      expect(prop!.addressJson).toEqual({ text: "1 Main St" });
      expect(prop!.deletedAt).toBeNull();

      const audit = await tx.activityLog.findFirst({
        where: {
          subjectType: "property",
          subjectId: result.propertyId,
          action: "property.created",
        },
        select: { actorUserId: true },
      });
      expect(audit!.actorUserId).toBe(actorUserId);
    });
  });

  it("rejects a duplicate property name within the org (conflict)", async () => {
    const actorUserId = await makeUser(orgAId);
    const propName = name("Dup Site");
    const args = {
      organizationId: orgAId,
      actorUserId,
      name: propName,
      timezone: "Europe/Berlin",
      countryCode: "DE",
    };
    const first = await withTenant(orgAId, (tx) => createProperty(tx, args));
    expect(first.status).toBe("ok");
    const second = await withTenant(orgAId, (tx) => createProperty(tx, args));
    expect(second).toEqual({ status: "conflict", field: "name" });
  });

  it("updates a property and returns not-found for an unknown id", async () => {
    const actorUserId = await makeUser(orgAId);
    const created = await withTenant(orgAId, (tx) =>
      createProperty(tx, {
        organizationId: orgAId,
        actorUserId,
        name: name("Edit Site"),
        timezone: "Europe/Berlin",
        countryCode: "DE",
      }),
    );
    if (created.status !== "ok") throw new Error("setup failed");

    const renamed = name("Renamed Site");
    const upd = await withTenant(orgAId, (tx) =>
      updateProperty(tx, {
        organizationId: orgAId,
        actorUserId,
        propertyId: created.propertyId,
        name: renamed,
        timezone: "Europe/Amsterdam",
        countryCode: "NL",
      }),
    );
    expect(upd.status).toBe("ok");

    const after = await withTenant(orgAId, (tx) =>
      tx.property.findUnique({
        where: { id: created.propertyId },
        select: { name: true, timezone: true, countryCode: true },
      }),
    );
    expect(after).toEqual({ name: renamed, timezone: "Europe/Amsterdam", countryCode: "NL" });

    const missing = await withTenant(orgAId, (tx) =>
      updateProperty(tx, {
        organizationId: orgAId,
        actorUserId,
        propertyId: randomUUID(),
        name: name("X"),
        timezone: "Europe/Berlin",
        countryCode: "DE",
      }),
    );
    expect(missing.status).toBe("not-found");
  });

  it("archives a property (soft-delete) so it drops from the active list", async () => {
    const actorUserId = await makeUser(orgAId);
    const created = await withTenant(orgAId, (tx) =>
      createProperty(tx, {
        organizationId: orgAId,
        actorUserId,
        name: name("Archive Site"),
        timezone: "Europe/Berlin",
        countryCode: "DE",
      }),
    );
    if (created.status !== "ok") throw new Error("setup failed");

    const res = await withTenant(orgAId, (tx) =>
      archiveProperty(tx, { organizationId: orgAId, actorUserId, propertyId: created.propertyId }),
    );
    expect(res.status).toBe("ok");

    await withTenant(orgAId, async (tx) => {
      const row = await tx.property.findUnique({
        where: { id: created.propertyId },
        select: { deletedAt: true },
      });
      expect(row!.deletedAt).not.toBeNull();

      const active = await tx.property.findMany({
        where: { deletedAt: null, id: created.propertyId },
      });
      expect(active).toHaveLength(0);

      const audit = await tx.activityLog.findFirst({
        where: { subjectId: created.propertyId, action: "property.archived" },
      });
      expect(audit).not.toBeNull();
    });

    // Archiving again is a no-op not-found (already soft-deleted -> not in the active set).
    const again = await withTenant(orgAId, (tx) =>
      archiveProperty(tx, { organizationId: orgAId, actorUserId, propertyId: created.propertyId }),
    );
    expect(again.status).toBe("not-found");
  });

  it("does not leak an org A property into org B (RLS, D6)", async () => {
    const actorUserId = await makeUser(orgAId);
    const created = await withTenant(orgAId, (tx) =>
      createProperty(tx, {
        organizationId: orgAId,
        actorUserId,
        name: name("Tenant Site"),
        timezone: "Europe/Berlin",
        countryCode: "DE",
      }),
    );
    if (created.status !== "ok") throw new Error("setup failed");

    const seenFromB = await withTenant(orgBId, (tx) =>
      tx.property.findUnique({ where: { id: created.propertyId } }),
    );
    expect(seenFromB).toBeNull();
  });
});

describe("outlet CRUD (#133)", () => {
  async function makeProperty(orgId: string, actorUserId: string): Promise<string> {
    const r = await withTenant(orgId, (tx) =>
      createProperty(tx, {
        organizationId: orgId,
        actorUserId,
        name: name("Outlet Parent"),
        timezone: "Europe/Berlin",
        countryCode: "DE",
      }),
    );
    if (r.status !== "ok") throw new Error("setup failed");
    return r.propertyId;
  }

  it("creates an outlet and rejects a duplicate name within the same property", async () => {
    const actorUserId = await makeUser(orgAId);
    const propertyId = await makeProperty(orgAId, actorUserId);

    const first = await withTenant(orgAId, (tx) =>
      createOutlet(tx, { organizationId: orgAId, actorUserId, propertyId, name: "Main Kitchen" }),
    );
    expect(first.status).toBe("ok");

    const dup = await withTenant(orgAId, (tx) =>
      createOutlet(tx, { organizationId: orgAId, actorUserId, propertyId, name: "Main Kitchen" }),
    );
    expect(dup).toEqual({ status: "conflict", field: "name" });
  });

  it("allows the same outlet name under a different property", async () => {
    const actorUserId = await makeUser(orgAId);
    const p1 = await makeProperty(orgAId, actorUserId);
    const p2 = await makeProperty(orgAId, actorUserId);

    const a = await withTenant(orgAId, (tx) =>
      createOutlet(tx, { organizationId: orgAId, actorUserId, propertyId: p1, name: "Bar" }),
    );
    const b = await withTenant(orgAId, (tx) =>
      createOutlet(tx, { organizationId: orgAId, actorUserId, propertyId: p2, name: "Bar" }),
    );
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
  });

  it("refuses to create an outlet under an archived/missing property", async () => {
    const actorUserId = await makeUser(orgAId);
    const propertyId = await makeProperty(orgAId, actorUserId);
    await withTenant(orgAId, (tx) =>
      archiveProperty(tx, { organizationId: orgAId, actorUserId, propertyId }),
    );

    const res = await withTenant(orgAId, (tx) =>
      createOutlet(tx, { organizationId: orgAId, actorUserId, propertyId, name: "Ghost" }),
    );
    expect(res.status).toBe("not-found");
  });

  it("renames and archives an outlet (soft-delete)", async () => {
    const actorUserId = await makeUser(orgAId);
    const propertyId = await makeProperty(orgAId, actorUserId);
    const created = await withTenant(orgAId, (tx) =>
      createOutlet(tx, { organizationId: orgAId, actorUserId, propertyId, name: "Prep" }),
    );
    if (created.status !== "ok") throw new Error("setup failed");

    const upd = await withTenant(orgAId, (tx) =>
      updateOutlet(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId: created.outletId,
        name: "Prep Station",
      }),
    );
    expect(upd.status).toBe("ok");

    const arch = await withTenant(orgAId, (tx) =>
      archiveOutlet(tx, { organizationId: orgAId, actorUserId, outletId: created.outletId }),
    );
    expect(arch.status).toBe("ok");

    await withTenant(orgAId, async (tx) => {
      const row = await tx.outlet.findUnique({
        where: { id: created.outletId },
        select: { name: true, deletedAt: true },
      });
      expect(row!.name).toBe("Prep Station");
      expect(row!.deletedAt).not.toBeNull();
    });
  });
});
