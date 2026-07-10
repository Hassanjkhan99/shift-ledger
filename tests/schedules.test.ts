import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { createSchedule, getSchedule, setScheduleActive, generateNow } from "../src/lib/schedules";
import { createTemplate, setTemplateActive } from "../src/lib/templates";
import { createProperty, createOutlet, archiveProperty } from "../src/lib/sites";
import { setMembershipStatus } from "../src/lib/members";
import { upcomingOccurrenceDates } from "../src/lib/recurrence";

// #136 — schedule CRUD + the generator integration: creating a schedule and running generateNow
// materializes occurrences whose local dates match the shared preview engine (no divergence, §9).
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

async function actor(orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const u = await tx.user.create({
      data: { email: `sched-${randomUUID()}@example.com`, name: "Sched" },
      select: { id: true },
    });
    return u.id;
  });
}

async function seededOutletId(orgId: string): Promise<string> {
  const o = await withTenant(orgId, (tx) =>
    tx.outlet.findFirst({
      where: { deletedAt: null, property: { deletedAt: null } },
      select: { id: true },
    }),
  );
  if (!o) throw new Error("no seeded outlet");
  return o.id;
}

async function makeTemplate(orgId: string, actorUserId: string): Promise<string> {
  const r = await withTenant(orgId, (tx) =>
    createTemplate(tx, {
      organizationId: orgId,
      actorUserId,
      title: `Sched Tpl ${randomUUID().slice(0, 6)}`,
      checkType: "generic",
      requiredEvidence: [],
    }),
  );
  return r.templateId;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("schedules (#136)", () => {
  it("creates a schedule and round-trips it", async () => {
    const actorUserId = await actor(orgAId);
    const outletId = await seededOutletId(orgAId);
    const taskTemplateId = await makeTemplate(orgAId, actorUserId);

    const res = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId,
        taskTemplateId,
        recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeRole: "KitchenManager",
        startsOn: "2026-03-10",
      }),
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;

    const s = await withTenant(orgAId, (tx) => getSchedule(tx, res.scheduleId));
    expect(s!.recurrence.freq).toBe("daily");
    expect(s!.assigneeRole).toBe("KitchenManager");
    expect(s!.assigneeUserId).toBeNull();
    expect(s!.graceMinutes).toBe(15);
    expect(s!.startsOn).toBe("2026-03-10");
  });

  it("generateNow materializes occurrences whose dates match the preview engine", async () => {
    const actorUserId = await actor(orgAId);
    const outletId = await seededOutletId(orgAId);
    const taskTemplateId = await makeTemplate(orgAId, actorUserId);
    const recurrence = { freq: "daily" as const, interval: 1, timeOfDay: "06:00" };
    const startsOn = todayIso();

    const created = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId,
        taskTemplateId,
        recurrence,
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeRole: "KitchenManager",
        startsOn,
      }),
    );
    if (created.status !== "ok") throw new Error("setup failed");

    const now = new Date();
    const gen = await withTenant(orgAId, (tx) => generateNow(tx, { organizationId: orgAId, now }));
    expect(gen.created).toBeGreaterThan(0);

    // The occurrences generated for THIS schedule…
    const occurrences = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({
        where: { scheduledTaskId: created.scheduleId },
        select: { occurrenceLocalDate: true },
      }),
    );
    expect(occurrences.length).toBeGreaterThan(0);

    // …must all be dates the shared preview engine lists (generator ⊆ preview).
    const preview = new Set(
      upcomingOccurrenceDates(recurrence, {
        startsOn: new Date(`${startsOn}T00:00:00Z`),
        from: now,
        timezone: "Europe/Berlin",
        count: 10,
      }),
    );
    for (const occ of occurrences) {
      expect(preview.has(occ.occurrenceLocalDate.toISOString().slice(0, 10))).toBe(true);
    }
  });

  it("rejects a non-member assignee user (composite FK → invalid-assignee)", async () => {
    const actorUserId = await actor(orgAId);
    const outletId = await seededOutletId(orgAId);
    const taskTemplateId = await makeTemplate(orgAId, actorUserId);

    const res = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId,
        taskTemplateId,
        recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeUserId: randomUUID(), // not a member
        startsOn: "2026-03-10",
      }),
    );
    expect(res.status).toBe("invalid-assignee");
  });

  it("returns not-found for a missing outlet", async () => {
    const actorUserId = await actor(orgAId);
    const taskTemplateId = await makeTemplate(orgAId, actorUserId);
    const res = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId: randomUUID(),
        taskTemplateId,
        recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeRole: "Staff",
        startsOn: "2026-03-10",
      }),
    );
    expect(res.status).toBe("not-found");
  });

  it("deactivation stops generation for that schedule", async () => {
    const actorUserId = await actor(orgAId);
    const outletId = await seededOutletId(orgAId);
    const taskTemplateId = await makeTemplate(orgAId, actorUserId);
    const startsOn = todayIso();

    const created = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId,
        taskTemplateId,
        recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeRole: "Staff",
        startsOn,
      }),
    );
    if (created.status !== "ok") throw new Error("setup failed");

    await withTenant(orgAId, (tx) =>
      setScheduleActive(tx, {
        organizationId: orgAId,
        actorUserId,
        scheduleId: created.scheduleId,
        active: false,
      }),
    );
    await withTenant(orgAId, (tx) => generateNow(tx, { organizationId: orgAId, now: new Date() }));

    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({ where: { scheduledTaskId: created.scheduleId } }),
    );
    expect(occ).toHaveLength(0);
  });

  it("does not leak an org A schedule into org B (RLS, D6)", async () => {
    const actorUserId = await actor(orgAId);
    const outletId = await seededOutletId(orgAId);
    const taskTemplateId = await makeTemplate(orgAId, actorUserId);
    const created = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId,
        taskTemplateId,
        recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeRole: "Staff",
        startsOn: "2026-03-10",
      }),
    );
    if (created.status !== "ok") throw new Error("setup failed");
    const fromB = await withTenant(orgBId, (tx) => getSchedule(tx, created.scheduleId));
    expect(fromB).toBeNull();
  });
});

// #157 review fixes — reject archived-property outlets, inactive templates, inactive assignees.
describe("scheduling guardrails (#157)", () => {
  it("rejects an inactive template on create", async () => {
    const actorUserId = await actor(orgAId);
    const outletId = await seededOutletId(orgAId);
    const templateId = await makeTemplate(orgAId, actorUserId);
    await withTenant(orgAId, (tx) =>
      setTemplateActive(tx, { organizationId: orgAId, actorUserId, templateId, active: false }),
    );

    const res = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId,
        taskTemplateId: templateId,
        recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeRole: "Staff",
        startsOn: "2026-03-10",
      }),
    );
    expect(res.status).toBe("inactive-template");
  });

  it("rejects an outlet whose parent property is archived", async () => {
    const actorUserId = await actor(orgAId);
    const templateId = await makeTemplate(orgAId, actorUserId);
    const p = await withTenant(orgAId, (tx) =>
      createProperty(tx, {
        organizationId: orgAId,
        actorUserId,
        name: `Arch Sched ${randomUUID().slice(0, 6)}`,
        timezone: "Europe/Berlin",
        countryCode: "DE",
      }),
    );
    if (p.status !== "ok") throw new Error("setup failed");
    const o = await withTenant(orgAId, (tx) =>
      createOutlet(tx, {
        organizationId: orgAId,
        actorUserId,
        propertyId: p.propertyId,
        name: "K",
      }),
    );
    if (o.status !== "ok") throw new Error("setup failed");
    await withTenant(orgAId, (tx) =>
      archiveProperty(tx, { organizationId: orgAId, actorUserId, propertyId: p.propertyId }),
    );

    const res = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId: o.outletId,
        taskTemplateId: templateId,
        recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeRole: "Staff",
        startsOn: "2026-03-10",
      }),
    );
    expect(res.status).toBe("not-found");
  });

  it("rejects an inactive user assignee (composite FK alone is insufficient)", async () => {
    const actorUserId = await actor(orgAId);
    const outletId = await seededOutletId(orgAId);
    const templateId = await makeTemplate(orgAId, actorUserId);
    // A user with an INACTIVE membership: the composite FK row exists, but they're not active.
    const inactiveUserId = await withTenant(orgAId, async (tx) => {
      const u = await tx.user.create({
        data: { email: `inactive-${randomUUID()}@example.com`, name: "Inactive" },
        select: { id: true },
      });
      const m = await tx.membership.create({
        data: { organizationId: orgAId, userId: u.id, role: "Staff", propertyScope: [] },
        select: { id: true },
      });
      await setMembershipStatus(tx, {
        organizationId: orgAId,
        actorUserId,
        membershipId: m.id,
        active: false,
      });
      return u.id;
    });

    const res = await withTenant(orgAId, (tx) =>
      createSchedule(tx, {
        organizationId: orgAId,
        actorUserId,
        outletId,
        taskTemplateId: templateId,
        recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        timezone: "Europe/Berlin",
        graceMinutes: 15,
        assigneeUserId: inactiveUserId,
        startsOn: "2026-03-10",
      }),
    );
    expect(res.status).toBe("invalid-assignee");
  });
});
