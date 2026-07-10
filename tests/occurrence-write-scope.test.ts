import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { loadScopedOccurrence, resolveActor } from "../src/app/actions/occurrences";
import type { MemberContext } from "../src/lib/http-auth";

// #152 — the occurrence completion write path enforces the member's property scope and binds the
// shared-tablet actor to the TARGET occurrence's outlet (never the client-supplied one).
const orgAId = inject("orgAId");

afterAll(async () => {
  await disconnect();
});

function ctx(propertyScope: string[]): MemberContext {
  return { organizationId: orgAId, userId: randomUUID(), role: "Staff", propertyScope };
}

/** Insert a minimal occurrence (template + scheduled task + occurrence) and return its ids. */
async function seedOccurrence(): Promise<{ id: string; outletId: string; propertyId: string }> {
  return withTenant(orgAId, async (tx) => {
    const outlet = await tx.outlet.findFirstOrThrow({
      where: { deletedAt: null, property: { deletedAt: null } },
      select: { id: true, propertyId: true },
    });
    const template = await tx.taskTemplate.create({
      data: {
        organizationId: orgAId,
        checkType: "generic",
        title: `WS ${randomUUID().slice(0, 6)}`,
      },
      select: { id: true },
    });
    const schedule = await tx.scheduledTask.create({
      data: {
        organizationId: orgAId,
        propertyId: outlet.propertyId,
        outletId: outlet.id,
        taskTemplateId: template.id,
        recurrenceJson: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        recurrenceFreq: "daily",
        timeOfDay: new Date("1970-01-01T06:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
        startsOn: new Date(Date.UTC(2026, 0, 1)),
      },
      select: { id: true },
    });
    const occ = await tx.taskOccurrence.create({
      data: {
        organizationId: orgAId,
        propertyId: outlet.propertyId,
        outletId: outlet.id,
        scheduledTaskId: schedule.id,
        taskTemplateId: template.id,
        checkType: "generic",
        occurrenceLocalDate: new Date(Date.UTC(2026, 0, 2)),
        dueAt: new Date("2026-01-02T06:00:00Z"),
        timezone: "Europe/Berlin",
        status: "due",
        assigneeRole: "KitchenManager",
      },
      select: { id: true },
    });
    return { id: occ.id, outletId: outlet.id, propertyId: outlet.propertyId };
  });
}

describe("occurrence write scope (#152)", () => {
  it("returns the occurrence for an in-scope (or org-wide) member", async () => {
    const occ = await seedOccurrence();
    const inScope = await withTenant(orgAId, (tx) =>
      loadScopedOccurrence(tx, ctx([occ.propertyId]), occ.id),
    );
    expect(inScope).toEqual({ outletId: occ.outletId, propertyId: occ.propertyId });

    const orgWide = await withTenant(orgAId, (tx) => loadScopedOccurrence(tx, ctx([]), occ.id));
    expect(orgWide).not.toBeNull();
  });

  it("throws for an occurrence outside the member's property scope", async () => {
    const occ = await seedOccurrence();
    await expect(
      withTenant(orgAId, (tx) => loadScopedOccurrence(tx, ctx([randomUUID()]), occ.id)),
    ).rejects.toThrow(/scope/);
  });

  it("returns null for a missing/tombstoned occurrence", async () => {
    const gone = await withTenant(orgAId, (tx) => loadScopedOccurrence(tx, ctx([]), randomUUID()));
    expect(gone).toBeNull();
  });

  it("resolveActor uses the session user without any outlet dependency", async () => {
    const c = ctx([]);
    const actor = await withTenant(orgAId, (tx) =>
      resolveActor(tx, c, { actor: { method: "session" } } as never, randomUUID()),
    );
    expect(actor).toEqual({ actorUserId: c.userId, method: "session" });
  });

  it("resolveActor rejects a PIN actor whose outlet != the occurrence's outlet", async () => {
    const input = {
      actor: { method: "pin", outletId: randomUUID(), pickedUserId: randomUUID(), pin: "1234" },
    };
    await expect(
      withTenant(orgAId, (tx) => resolveActor(tx, ctx([]), input as never, randomUUID())),
    ).rejects.toThrow(/outlet/);
  });
});
