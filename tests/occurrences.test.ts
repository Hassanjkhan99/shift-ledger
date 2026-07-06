import { describe, it, expect, inject, afterAll } from "vitest";
import { DateTime } from "luxon";
import { withTenant, disconnect } from "../src/lib/db";
import {
  computeDueAt,
  generateOccurrences,
  sweepOccurrences,
  parseRecurrence,
  type Recurrence,
} from "../src/lib/occurrences";

// Seed gives two orgs; org A = Europe/Berlin (DE), org B = Europe/Amsterdam (NL). Each has one
// property (org tz) and one "Main Kitchen" outlet. We build templates/scheduled_tasks per test
// inside withTenant(orgAId, …). Unique titles keep rows from bleeding across tests.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

interface Fixture {
  propertyId: string;
  outletId: string;
  templateId: string;
}

/** Load the seeded property + outlet for an org. */
async function siteFor(orgId: string): Promise<{ propertyId: string; outletId: string }> {
  return withTenant(orgId, async (tx) => {
    const property = await tx.property.findFirstOrThrow();
    const outlet = await tx.outlet.findFirstOrThrow();
    return { propertyId: property.id, outletId: outlet.id };
  });
}

/** Create a fresh template in the org (unique title per call). */
async function makeTemplate(orgId: string, title: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const tpl = await tx.taskTemplate.create({
      data: { organizationId: orgId, checkType: "temperature", title },
      select: { id: true },
    });
    return tpl.id;
  });
}

async function makeSchedule(
  orgId: string,
  fx: Fixture,
  rec: Recurrence,
  opts: {
    timezone: string;
    startsOn: Date;
    endsOn?: Date;
    graceMinutes?: number;
    // Override the time_of_day column (HH:mm) independently of recurrence_json.timeOfDay.
    timeOfDayColumn?: string;
  },
): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const st = await tx.scheduledTask.create({
      data: {
        organizationId: orgId,
        propertyId: fx.propertyId,
        outletId: fx.outletId,
        taskTemplateId: fx.templateId,
        recurrenceJson: rec,
        recurrenceFreq: rec.freq,
        // time_of_day is a @db.Time — a Date whose UTC time-of-day carries HH:mm:ss.
        timeOfDay: new Date(`1970-01-01T${opts.timeOfDayColumn ?? rec.timeOfDay}:00Z`),
        timezone: opts.timezone,
        assigneeRole: "KitchenManager",
        graceMinutes: opts.graceMinutes ?? 15,
        startsOn: opts.startsOn,
        endsOn: opts.endsOn ?? null,
        isActive: true,
      },
      select: { id: true },
    });
    return st.id;
  });
}

// ---- RLS isolation --------------------------------------------------------------
describe("occurrence domain — RLS cross-tenant isolation", () => {
  it("task_templates / scheduled_tasks / task_occurrences are org-scoped; cross-tenant write denied", async () => {
    const siteA = await siteFor(orgAId);
    const tplA = await makeTemplate(orgAId, "RLS probe template A");
    const stA = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tplA },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)) },
    );
    // Materialize at least one occurrence for org A.
    await withTenant(orgAId, (tx) =>
      generateOccurrences(tx, { organizationId: orgAId, now: new Date("2026-02-02T05:00:00Z") }),
    );

    // Org B cannot see org A's template / schedule / occurrences.
    const seenFromB = await withTenant(orgBId, async (tx) => ({
      tpl: await tx.taskTemplate.findUnique({ where: { id: tplA } }),
      st: await tx.scheduledTask.findUnique({ where: { id: stA } }),
      occCount: await tx.taskOccurrence.count(),
      aOccCount: await tx.taskOccurrence.count({ where: { organizationId: orgAId } }),
    }));
    expect(seenFromB.tpl).toBeNull();
    expect(seenFromB.st).toBeNull();
    expect(seenFromB.aOccCount).toBe(0);

    // Cross-tenant WRITE denied (WITH CHECK): org A context cannot insert a template tagged for org B.
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskTemplate.create({
          data: { organizationId: orgBId, checkType: "cleaning", title: "sneaky" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("no tenant context => zero rows across the 3 new tables (default-deny)", async () => {
    const { prisma } = await import("../src/lib/db");
    const counts = await Promise.all([
      prisma.taskTemplate.count(),
      prisma.scheduledTask.count(),
      prisma.taskOccurrence.count(),
    ]);
    expect(counts).toEqual([0, 0, 0]);
  });
});

// ---- Generation -----------------------------------------------------------------
describe("generateOccurrences", () => {
  it("materializes today+2 for a daily 06:00 Europe/Berlin schedule with correct due_at + one log each", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Daily fridge check gen");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)) },
    );

    // now = 2026-07-10 03:00Z → 05:00 local Berlin (CEST). today_local = 2026-07-10.
    // NOTE: `res.created` is an org-wide total and other tests share this org's DB, so we assert
    // on rows for THIS scheduled_task rather than the aggregate count.
    const now = new Date("2026-07-10T03:00:00Z");
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));

    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({
        where: { scheduledTaskId: st },
        orderBy: { occurrenceLocalDate: "asc" },
      }),
    );
    expect(occ).toHaveLength(3);
    expect(occ.every((o) => o.status === "pending")).toBe(true);
    // Berlin summer = UTC+2, so 06:00 local == 04:00Z.
    expect(occ[0].dueAt.toISOString()).toBe("2026-07-10T04:00:00.000Z");
    expect(occ[1].dueAt.toISOString()).toBe("2026-07-11T04:00:00.000Z");
    expect(occ[2].dueAt.toISOString()).toBe("2026-07-12T04:00:00.000Z");
    // Denormalized snapshots present.
    expect(occ[0].timezone).toBe("Europe/Berlin");
    expect(occ[0].checkType).toBe("temperature");
    expect(occ[0].assigneeRole).toBe("KitchenManager");

    const logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({
        where: {
          action: "occurrence.generated",
          actorLabel: "system:generator",
          subjectId: { in: occ.map((o) => o.id) },
        },
      }),
    );
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.subjectType === "taskOccurrence")).toBe(true);
  });
});

// ---- Idempotency ----------------------------------------------------------------
describe("generateOccurrences — idempotency", () => {
  it("re-run creates no new rows or logs; a completed occurrence is never reset", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Idempotent daily check");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "08:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)) },
    );
    const now = new Date("2026-07-15T03:00:00Z");

    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const firstRows = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.count({ where: { scheduledTaskId: st } }),
    );
    expect(firstRows).toBe(3); // 3 for THIS schedule

    // Flip one to completed BEFORE the re-run.
    const target = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findFirstOrThrow({
        where: { scheduledTaskId: st },
        orderBy: { occurrenceLocalDate: "asc" },
      }),
    );
    await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.update({
        where: { id: target.id },
        data: { status: "completed", completedAt: new Date("2026-07-15T06:30:00Z") },
      }),
    );

    const second = await withTenant(orgAId, (tx) =>
      generateOccurrences(tx, { organizationId: orgAId, now }),
    );
    expect(second.created).toBe(0);

    const after = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({ where: { scheduledTaskId: st } }),
    );
    expect(after).toHaveLength(3); // no dupes
    const stillCompleted = after.find((o) => o.id === target.id)!;
    expect(stillCompleted.status).toBe("completed"); // never reset

    const logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({
        where: { action: "occurrence.generated", subjectId: { in: after.map((o) => o.id) } },
      }),
    );
    expect(logs).toHaveLength(3); // still exactly one per occurrence, none added on re-run
  });
});

// ---- Recurrence filtering -------------------------------------------------------
describe("generateOccurrences — recurrence filtering", () => {
  it("weekly byWeekday only materializes matching weekdays and respects starts_on/ends_on", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Weekly Mon/Wed check");
    // Mondays (1) and Wednesdays (3) only.
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "weekly", interval: 1, byWeekday: [1, 3], timeOfDay: "07:00" },
      {
        timezone: "Europe/Berlin",
        startsOn: new Date(Date.UTC(2026, 0, 1)),
        // Window 2026-08-10 (Mon) .. 2026-08-12 (Wed). Cap ends_on at Aug 11 (Tue) so Wed is excluded.
        endsOn: new Date(Date.UTC(2026, 7, 11)),
      },
    );
    // now → today_local = Mon 2026-08-10; window = Mon 10, Tue 11, Wed 12.
    const now = new Date("2026-08-10T04:00:00Z");
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    // Mon(10) matches + within ends_on; Tue(11) is not Mon/Wed; Wed(12) matches weekday but is past
    // ends_on. Assert per-schedule (res.created is an org-wide total shared with other tests).
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({ where: { scheduledTaskId: st } }),
    );
    expect(occ).toHaveLength(1);
    // 2026-08-10 is a Monday.
    expect(DateTime.fromJSDate(occ[0].occurrenceLocalDate, { zone: "utc" }).weekday).toBe(1);
  });
});

// ---- DST ------------------------------------------------------------------------
describe("computeDueAt — DST edge cases (Europe/Berlin, 2026)", () => {
  it("spring-forward: 02:30 on 2026-03-29 rolls forward to the first valid instant (03:00 local = 01:00Z)", () => {
    // 2026-03-29 is the last Sunday of March: clocks jump 02:00 → 03:00; 02:30 does not exist.
    const localDate = new Date(Date.UTC(2026, 2, 29));
    const due = computeDueAt(localDate, "02:30", "Europe/Berlin");
    expect(due.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("fall-back: 02:30 on 2026-10-25 resolves to the EARLIER (first) UTC instant (00:30Z)", () => {
    // 2026-10-25 is the last Sunday of October: clocks fall 03:00 → 02:00; 02:30 occurs twice.
    const localDate = new Date(Date.UTC(2026, 9, 25));
    const due = computeDueAt(localDate, "02:30", "Europe/Berlin");
    // Earlier instant is under CEST (UTC+2) → 00:30Z; the later (CET, UTC+1) would be 01:30Z.
    expect(due.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("normal day: 06:00 winter (CET) = 05:00Z; 06:00 summer (CEST) = 04:00Z", () => {
    expect(
      computeDueAt(new Date(Date.UTC(2026, 0, 15)), "06:00", "Europe/Berlin").toISOString(),
    ).toBe("2026-01-15T05:00:00.000Z");
    expect(
      computeDueAt(new Date(Date.UTC(2026, 6, 15)), "06:00", "Europe/Berlin").toISOString(),
    ).toBe("2026-07-15T04:00:00.000Z");
  });
});

describe("generateOccurrences — DST due_at through the pipeline", () => {
  it("a 02:30 Berlin daily schedule lands the spring-forward day at 01:00Z", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "DST spring 02:30 check");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "02:30" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)) },
    );
    // today_local = 2026-03-29 (the spring-forward date); window is 29,30,31.
    const now = new Date("2026-03-29T00:10:00Z"); // 01:10 local, before the jump
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const springOcc = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findUniqueOrThrow({
        where: {
          scheduledTaskId_occurrenceLocalDate: {
            scheduledTaskId: st,
            occurrenceLocalDate: new Date(Date.UTC(2026, 2, 29)),
          },
        },
      }),
    );
    expect(springOcc.dueAt.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });
});

// ---- Sweep ----------------------------------------------------------------------
describe("sweepOccurrences", () => {
  it("flips pending→due at due_at, due→overdue past grace, leaves not-yet-due untouched, logs each", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Sweep check");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)), graceMinutes: 15 },
    );

    // Hand-create three occurrences with controlled due_at (bypass generator to isolate the sweep).
    const base = {
      organizationId: orgAId,
      propertyId: siteA.propertyId,
      outletId: siteA.outletId,
      scheduledTaskId: st,
      taskTemplateId: tpl,
      checkType: "temperature" as const,
      timezone: "Europe/Berlin",
    };
    const ids = await withTenant(orgAId, async (tx) => {
      const future = await tx.taskOccurrence.create({
        data: {
          ...base,
          occurrenceLocalDate: new Date(Date.UTC(2026, 8, 5)),
          dueAt: new Date("2026-09-05T10:00:00Z"), // strictly AFTER `now` below → untouched
          status: "pending",
        },
        select: { id: true },
      });
      const dueNow = await tx.taskOccurrence.create({
        data: {
          ...base,
          occurrenceLocalDate: new Date(Date.UTC(2026, 8, 2)),
          // 10 min before `now` → past due_at (pending→due) but still inside the 15-min grace.
          dueAt: new Date("2026-09-03T08:50:00Z"),
          status: "pending",
        },
        select: { id: true },
      });
      const staleDue = await tx.taskOccurrence.create({
        data: {
          ...base,
          occurrenceLocalDate: new Date(Date.UTC(2026, 8, 3)),
          dueAt: new Date("2026-09-03T08:00:00Z"),
          status: "due",
        },
        select: { id: true },
      });
      return { future: future.id, dueNow: dueNow.id, staleDue: staleDue.id };
    });

    // now: after dueNow's due_at (so pending→due) and > staleDue.due_at + 15min (so due→overdue),
    // but before the future occurrence's due_at.
    // The sweep is org-wide (other tests leave pending/due rows in this shared org), so we assert
    // on the exact status of OUR three occurrences and their audit rows, not the aggregate totals.
    const now = new Date("2026-09-03T09:00:00Z");
    const res = await withTenant(orgAId, (tx) => sweepOccurrences(tx, { now }));
    expect(res.becameDue).toBeGreaterThanOrEqual(1);
    expect(res.becameOverdue).toBeGreaterThanOrEqual(1);

    const after = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({ where: { id: { in: Object.values(ids) } } }),
    );
    const byId = new Map(after.map((o) => [o.id, o.status]));
    expect(byId.get(ids.future)).toBe("pending"); // untouched
    expect(byId.get(ids.dueNow)).toBe("due"); // pending→due
    expect(byId.get(ids.staleDue)).toBe("overdue"); // due→overdue

    const logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({
        where: {
          actorLabel: "system:overdue-sweep",
          subjectId: { in: [ids.dueNow, ids.staleDue] },
        },
      }),
    );
    expect(logs).toHaveLength(2);
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual(["occurrence.due", "occurrence.overdue"]);
  });
});

// ---- Monthly byMonthDay clamping (reviewer fix #1) ------------------------------
describe("generateOccurrences — monthly byMonthDay clamps to last day of short months", () => {
  it("byMonthDay:[31] fires on Feb 28 (2026 is not a leap year)", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Monthly day-31 clamp");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "monthly", interval: 1, byMonthDay: [31], timeOfDay: "06:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)) },
    );
    // Window Feb 26/27/28 2026. Day 31 clamps to Feb 28 (last day) → exactly one occurrence.
    const now = new Date("2026-02-26T08:00:00Z");
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({ where: { scheduledTaskId: st } }),
    );
    expect(occ).toHaveLength(1);
    // occurrence_local_date is the 28th (UTC-anchored @db.Date).
    expect(DateTime.fromJSDate(occ[0].occurrenceLocalDate, { zone: "utc" }).day).toBe(28);
    expect(DateTime.fromJSDate(occ[0].occurrenceLocalDate, { zone: "utc" }).month).toBe(2);
  });
});

// ---- Date-only starts_on/ends_on across time zones (reviewer fix #2) ------------
describe("generateOccurrences — date-only starts_on/ends_on preserved west of UTC", () => {
  it("starts_on is honored as the intended calendar day in America/New_York (no day-early shift)", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "NY starts_on boundary");
    // starts_on = 2026-05-11. In America/New_York (UTC-4 in May) a naive fromJSDate of UTC
    // midnight would land on 2026-05-10, incorrectly letting the 10th fire. It must not.
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "09:00" },
      { timezone: "America/New_York", startsOn: new Date(Date.UTC(2026, 4, 11)) },
    );
    // Window = May 10, 11, 12 (today_local = 2026-05-10). Only 11 and 12 are on/after starts_on.
    const now = new Date("2026-05-10T14:00:00Z"); // 10:00 local NY on the 10th
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({
        where: { scheduledTaskId: st },
        orderBy: { occurrenceLocalDate: "asc" },
      }),
    );
    // The 10th must be excluded (before starts_on); only the 11th and 12th generate.
    const days = occ.map((o) => DateTime.fromJSDate(o.occurrenceLocalDate, { zone: "utc" }).day);
    expect(days).toEqual([11, 12]);
    // 09:00 local NY (EDT, UTC-4) on the 11th == 13:00Z.
    expect(occ[0].dueAt.toISOString()).toBe("2026-05-11T13:00:00.000Z");
  });

  it("ends_on is honored as the intended calendar day in America/New_York (no day-late shift)", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "NY ends_on boundary");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "09:00" },
      {
        timezone: "America/New_York",
        startsOn: new Date(Date.UTC(2026, 0, 1)),
        endsOn: new Date(Date.UTC(2026, 4, 11)), // last valid day = May 11
      },
    );
    // Window = May 11, 12, 13. Only the 11th is <= ends_on; 12 & 13 excluded.
    const now = new Date("2026-05-11T14:00:00Z");
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({ where: { scheduledTaskId: st } }),
    );
    expect(occ).toHaveLength(1);
    expect(DateTime.fromJSDate(occ[0].occurrenceLocalDate, { zone: "utc" }).day).toBe(11);
  });
});

// ---- due_at follows the time_of_day column (reviewer fix #3) --------------------
describe("generateOccurrences — due_at reads the editable time_of_day column, not recurrence_json", () => {
  it("a time_of_day edit diverging from recurrence_json.timeOfDay drives due_at", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "time_of_day column wins");
    // recurrence_json says 06:00 but the column says 14:30 — the column must win.
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      {
        timezone: "Europe/Berlin",
        startsOn: new Date(Date.UTC(2026, 0, 1)),
        timeOfDayColumn: "14:30",
      },
    );
    const now = new Date("2026-07-20T03:00:00Z");
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({
        where: { scheduledTaskId: st },
        orderBy: { occurrenceLocalDate: "asc" },
      }),
    );
    expect(occ).toHaveLength(3);
    // 14:30 local Berlin summer (CEST, UTC+2) == 12:30Z — NOT 04:00Z (which 06:00 would give).
    expect(occ[0].dueAt.toISOString()).toBe("2026-07-20T12:30:00.000Z");
  });
});

// ---- Soft-archived sites stop generation (reviewer fix #4) ----------------------
describe("generateOccurrences — skips schedules whose parent site is soft-archived", () => {
  it("archiving the outlet stops new occurrence generation", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Archived-outlet skip");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)) },
    );
    const now = new Date("2026-07-25T03:00:00Z");

    // Soft-archive the outlet BEFORE the first generation run.
    await withTenant(orgAId, (tx) =>
      tx.outlet.update({ where: { id: siteA.outletId }, data: { deletedAt: new Date() } }),
    );
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.count({ where: { scheduledTaskId: st } }),
    );
    expect(occ).toBe(0); // outlet archived → nothing generated

    // Un-archive to avoid leaking a soft-deleted seeded outlet into later shared-org tests.
    await withTenant(orgAId, (tx) =>
      tx.outlet.update({ where: { id: siteA.outletId }, data: { deletedAt: null } }),
    );
  });
});

// ---- Sweep concurrency safety (reviewer fix #5) ---------------------------------
describe("sweepOccurrences — compare-and-set + tombstone safety", () => {
  it("does not clobber an occurrence that was completed between the sweep read and write", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Sweep CAS check");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)), graceMinutes: 15 },
    );
    const base = {
      organizationId: orgAId,
      propertyId: siteA.propertyId,
      outletId: siteA.outletId,
      scheduledTaskId: st,
      taskTemplateId: tpl,
      checkType: "temperature" as const,
      timezone: "Europe/Berlin",
    };

    // A pending row that is already completed in the DB but whose STATUS the sweep will try to
    // flip via CAS. We simulate the race by pre-setting it to `completed` while its due_at is in
    // the past — the sweep's WHERE {status:'pending'} must match 0 rows and leave it completed.
    const raced = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.create({
        data: {
          ...base,
          occurrenceLocalDate: new Date(Date.UTC(2026, 10, 2)),
          dueAt: new Date("2026-11-02T08:00:00Z"),
          status: "completed",
          completedAt: new Date("2026-11-02T07:30:00Z"),
        },
        select: { id: true },
      }),
    );

    // A tombstoned (soft-deleted) pending row past due_at — must NOT be swept to due.
    const tombstoned = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.create({
        data: {
          ...base,
          occurrenceLocalDate: new Date(Date.UTC(2026, 10, 3)),
          dueAt: new Date("2026-11-02T08:00:00Z"),
          status: "pending",
          deletedAt: new Date("2026-11-02T07:00:00Z"),
        },
        select: { id: true },
      }),
    );

    const now = new Date("2026-11-02T09:00:00Z"); // past due_at + grace
    await withTenant(orgAId, (tx) => sweepOccurrences(tx, { now }));

    const after = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({
        where: { id: { in: [raced.id, tombstoned.id] } },
      }),
    );
    const byId = new Map(after.map((o) => [o.id, o.status]));
    expect(byId.get(raced.id)).toBe("completed"); // CAS no-op → not clobbered
    expect(byId.get(tombstoned.id)).toBe("pending"); // deleted_at → excluded from sweep

    // No sweep transition log was emitted for the raced/tombstoned rows.
    const logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({
        where: {
          actorLabel: "system:overdue-sweep",
          subjectId: { in: [raced.id, tombstoned.id] },
        },
      }),
    );
    expect(logs).toHaveLength(0);
  });
});

// ---- Recurrence Zod validation --------------------------------------------------
describe("parseRecurrence", () => {
  it("accepts a valid daily recurrence and rejects a bad timeOfDay", () => {
    expect(parseRecurrence({ freq: "daily", interval: 1, timeOfDay: "06:00" }).freq).toBe("daily");
    expect(() => parseRecurrence({ freq: "daily", interval: 1, timeOfDay: "6am" })).toThrow();
    expect(() => parseRecurrence({ freq: "hourly", interval: 1, timeOfDay: "06:00" })).toThrow();
  });

  // Fix #1: an empty day-filter array is a malformed schedule (silently generates nothing), not a
  // valid "matches nothing" filter — reject it loudly so it never reaches generation.
  it("rejects an empty byWeekday / byMonthDay array", () => {
    expect(() =>
      parseRecurrence({ freq: "weekly", interval: 1, byWeekday: [], timeOfDay: "06:00" }),
    ).toThrow();
    expect(() =>
      parseRecurrence({ freq: "monthly", interval: 1, byMonthDay: [], timeOfDay: "06:00" }),
    ).toThrow();
    // A populated array still parses.
    expect(
      parseRecurrence({ freq: "weekly", interval: 1, byWeekday: [1], timeOfDay: "06:00" })
        .byWeekday,
    ).toEqual([1]);
  });
});

// ---- grace_minutes range CHECK (fix #2) -----------------------------------------
describe("scheduled_tasks — grace_minutes 0..60 CHECK (D3)", () => {
  it("rejects grace_minutes outside 0..60 (61 and -1)", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Grace range check");
    await expect(
      makeSchedule(
        orgAId,
        { ...siteA, templateId: tpl },
        { freq: "daily", interval: 1, timeOfDay: "06:00" },
        { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)), graceMinutes: 61 },
      ),
    ).rejects.toThrow();
    await expect(
      makeSchedule(
        orgAId,
        { ...siteA, templateId: tpl },
        { freq: "daily", interval: 1, timeOfDay: "06:00" },
        { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)), graceMinutes: -1 },
      ),
    ).rejects.toThrow();
    // A boundary value (60) is accepted.
    const ok = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)), graceMinutes: 60 },
    );
    expect(ok).toBeTruthy();
  });
});

// ---- Ended schedules filtered out of the scan (fix #4) --------------------------
describe("generateOccurrences — ended schedules are not fetched/materialized", () => {
  it("a schedule whose ends_on is well in the past generates nothing", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Ended schedule skip");
    // ends_on = 2020-01-31, active-for-history but far before any window `now` below could touch.
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      {
        timezone: "Europe/Berlin",
        startsOn: new Date(Date.UTC(2020, 0, 1)),
        endsOn: new Date(Date.UTC(2020, 0, 31)),
      },
    );
    const now = new Date("2026-07-10T03:00:00Z");
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.count({ where: { scheduledTaskId: st } }),
    );
    expect(occ).toBe(0); // ended long ago → excluded from the scan, nothing materialized
  });
});

// ---- Occurrence property_id derives from the outlet (fix #5) --------------------
describe("generateOccurrences — property_id is sourced from the outlet", () => {
  it("materialized occurrences carry the outlet's property_id", async () => {
    const siteA = await siteFor(orgAId);
    const tpl = await makeTemplate(orgAId, "Outlet-derived property");
    const st = await makeSchedule(
      orgAId,
      { ...siteA, templateId: tpl },
      { freq: "daily", interval: 1, timeOfDay: "06:00" },
      { timezone: "Europe/Berlin", startsOn: new Date(Date.UTC(2026, 0, 1)) },
    );
    // The authoritative property is the outlet's own property, regardless of the schedule row.
    const outletProperty = await withTenant(orgAId, (tx) =>
      tx.outlet.findUniqueOrThrow({
        where: { id: siteA.outletId },
        select: { propertyId: true },
      }),
    );
    const now = new Date("2026-07-14T03:00:00Z");
    await withTenant(orgAId, (tx) => generateOccurrences(tx, { organizationId: orgAId, now }));
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findMany({ where: { scheduledTaskId: st } }),
    );
    expect(occ.length).toBeGreaterThan(0);
    expect(occ.every((o) => o.propertyId === outletProperty.propertyId)).toBe(true);
  });
});
