import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { assertRoleMayTrigger, roleMayTrigger } from "../src/lib/permissions";
import { skipOccurrence, cancelOccurrence } from "../src/lib/occurrences";
import {
  evaluateRepeatedDeviation,
  SCHEDULED_TASK_THRESHOLD,
  SCHEDULED_TASK_WINDOW_DAYS,
} from "../src/lib/repeated-deviation";
import { OrgRole, type OccurrenceStatus } from "../src/generated/prisma/enums";

// #10 domain wiring: the role matrix (D7, §7.1/§7.2/§7.3), the skip/cancel occurrence edges with a
// mandatory reason routed through the F4 choke point, and the repeated-deviation review rule.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** A property/outlet/template/scheduled_task chain, returned so occurrences can be seeded on it. */
interface Site {
  propertyId: string;
  outletId: string;
  templateId: string;
  scheduledTaskId: string;
  userId: string;
}

async function makeSite(orgId: string): Promise<Site> {
  return withTenant(orgId, async (tx) => {
    const property = await tx.property.findFirstOrThrow();
    const outlet = await tx.outlet.findFirstOrThrow();
    const membership = await tx.membership.findFirstOrThrow();
    const template = await tx.taskTemplate.create({
      data: { organizationId: orgId, checkType: "temperature", title: `Tpl ${randomUUID()}` },
      select: { id: true },
    });
    const scheduled = await tx.scheduledTask.create({
      data: {
        organizationId: orgId,
        propertyId: property.id,
        outletId: outlet.id,
        taskTemplateId: template.id,
        recurrenceJson: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        recurrenceFreq: "daily",
        timeOfDay: new Date("1970-01-01T06:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
        startsOn: new Date("2026-07-01"),
        isActive: true,
      },
      select: { id: true },
    });
    return {
      propertyId: property.id,
      outletId: outlet.id,
      templateId: template.id,
      scheduledTaskId: scheduled.id,
      userId: membership.userId,
    };
  });
}

/** Seed one occurrence with a given status + local date on the site's scheduled task/template. */
async function seedOccurrence(
  orgId: string,
  site: Site,
  status: OccurrenceStatus,
  localDate: Date,
  opts: { scheduledTaskId?: string; templateId?: string; outletId?: string } = {},
): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const occ = await tx.taskOccurrence.create({
      data: {
        organizationId: orgId,
        propertyId: site.propertyId,
        outletId: opts.outletId ?? site.outletId,
        scheduledTaskId: opts.scheduledTaskId ?? site.scheduledTaskId,
        taskTemplateId: opts.templateId ?? site.templateId,
        checkType: "temperature",
        occurrenceLocalDate: localDate,
        dueAt: new Date("2026-07-03T04:00:00Z"),
        timezone: "Europe/Berlin",
        status,
      },
      select: { id: true },
    });
    return occ.id;
  });
}

// ---- Role matrix (D7, §7.1/§7.2/§7.3) -------------------------------------------
describe("assertRoleMayTrigger — role matrix", () => {
  it("occurrence.skip: managers pass, Staff is rejected", () => {
    expect(() => assertRoleMayTrigger("occurrence", "skip", OrgRole.KitchenManager)).not.toThrow();
    expect(() => assertRoleMayTrigger("occurrence", "skip", OrgRole.PropertyManager)).not.toThrow();
    expect(() => assertRoleMayTrigger("occurrence", "skip", OrgRole.Staff)).toThrow();
    expect(() => assertRoleMayTrigger("occurrence", "skip", OrgRole.Auditor)).toThrow();
  });

  it("occurrence.complete: Staff is permitted (front-line completion)", () => {
    expect(() => assertRoleMayTrigger("occurrence", "complete", OrgRole.Staff)).not.toThrow();
    expect(() => assertRoleMayTrigger("occurrence", "complete", OrgRole.Auditor)).toThrow();
  });

  it("exception.acknowledge: ShiftLeader passes, Staff rejected", () => {
    expect(() =>
      assertRoleMayTrigger("exception", "acknowledge", OrgRole.ShiftLeader),
    ).not.toThrow();
    expect(() => assertRoleMayTrigger("exception", "acknowledge", OrgRole.Staff)).toThrow();
  });

  it("correctiveAction.markDone: Staff (the assignee) passes; verify is managers-only", () => {
    expect(() => assertRoleMayTrigger("correctiveAction", "markDone", OrgRole.Staff)).not.toThrow();
    expect(() => assertRoleMayTrigger("correctiveAction", "verify", OrgRole.Staff)).toThrow();
    expect(() =>
      assertRoleMayTrigger("correctiveAction", "verify", OrgRole.PropertyManager),
    ).not.toThrow();
  });

  it("roleMayTrigger predicate mirrors the assert form", () => {
    expect(roleMayTrigger("occurrence", "skip", OrgRole.KitchenManager)).toBe(true);
    expect(roleMayTrigger("occurrence", "skip", OrgRole.Staff)).toBe(false);
  });
});

// ---- skipOccurrence / cancelOccurrence with mandatory reason --------------------
describe("skipOccurrence / cancelOccurrence", () => {
  it("skip from a legal state succeeds WITH a reason and persists activity_log.reason", async () => {
    const site = await makeSite(orgAId);
    const occId = await seedOccurrence(orgAId, site, "due", new Date(Date.UTC(2026, 6, 10)));

    await withTenant(orgAId, (tx) =>
      skipOccurrence(tx, occId, { actorUserId: site.userId, reason: "outlet closed today" }),
    );

    const { occ, log } = await withTenant(orgAId, async (tx) => ({
      occ: await tx.taskOccurrence.findUniqueOrThrow({ where: { id: occId } }),
      log: await tx.activityLog.findFirstOrThrow({
        where: { subjectId: occId, action: "occurrence.skipped" },
      }),
    }));
    expect(occ.status).toBe("skipped");
    expect(log.reason).toBe("outlet closed today");
    expect(log.actorUserId).toBe(site.userId);
    expect(log.actorLabel).toBeNull();
  });

  it("cancel from a legal state succeeds WITH a reason", async () => {
    const site = await makeSite(orgAId);
    const occId = await seedOccurrence(orgAId, site, "pending", new Date(Date.UTC(2026, 6, 11)));
    await withTenant(orgAId, (tx) =>
      cancelOccurrence(tx, occId, { actorUserId: site.userId, reason: "schedule deleted" }),
    );
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findUniqueOrThrow({ where: { id: occId } }),
    );
    expect(occ.status).toBe("cancelled");
  });

  it("skip WITHOUT a reason is rejected: no status change, no log", async () => {
    const site = await makeSite(orgAId);
    const occId = await seedOccurrence(orgAId, site, "due", new Date(Date.UTC(2026, 6, 12)));

    await expect(
      withTenant(orgAId, (tx) =>
        skipOccurrence(tx, occId, { actorUserId: site.userId, reason: "   " }),
      ),
    ).rejects.toThrow();

    const { occ, logCount } = await withTenant(orgAId, async (tx) => ({
      occ: await tx.taskOccurrence.findUniqueOrThrow({ where: { id: occId } }),
      logCount: await tx.activityLog.count({
        where: { subjectId: occId, action: "occurrence.skipped" },
      }),
    }));
    expect(occ.status).toBe("due"); // unchanged
    expect(logCount).toBe(0); // no orphan log
  });

  it("cancel from an illegal from-state (overdue) is rejected", async () => {
    const site = await makeSite(orgAId);
    const occId = await seedOccurrence(orgAId, site, "overdue", new Date(Date.UTC(2026, 6, 13)));
    await expect(
      withTenant(orgAId, (tx) =>
        cancelOccurrence(tx, occId, { actorUserId: site.userId, reason: "too late" }),
      ),
    ).rejects.toThrow();
    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findUniqueOrThrow({ where: { id: occId } }),
    );
    expect(occ.status).toBe("overdue"); // unchanged
  });
});

// ---- Repeated-deviation review rule ---------------------------------------------
describe("evaluateRepeatedDeviation", () => {
  const now = new Date("2026-07-20T12:00:00Z");
  // Distinct dates inside the 7d window (14..20 July) — each ≤ 6 days before `now` and unique so the
  // (scheduled_task_id, occurrence_local_date) unique constraint is not violated. Fresh site per test,
  // so a per-day cursor is safe.
  const dayInWindow = (i: number) => new Date(Date.UTC(2026, 6, 14 + i));

  async function seedFailures(
    orgId: string,
    site: Site,
    count: number,
    startDay = 0,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(await seedOccurrence(orgId, site, "failed", dayInWindow(startDay + i)));
    }
    return ids;
  }

  it("3rd failure (scheduled_task+outlet, 7d) logs exactly one review request with a non-PII payload", async () => {
    const site = await makeSite(orgAId);
    await seedFailures(orgAId, site, 2, 0); // 2 prior (days 0,1)
    const trigger = (await seedFailures(orgAId, site, 1, 2))[0]; // the 3rd (day 2)

    const res = await withTenant(orgAId, (tx) =>
      evaluateRepeatedDeviation(tx, {
        organizationId: orgAId,
        scheduledTaskId: site.scheduledTaskId,
        taskTemplateId: site.templateId,
        outletId: site.outletId,
        triggeringOccurrenceId: trigger,
        now,
      }),
    );
    const stReq = res.requested.find((r) => r.groupingKey === "scheduledTask+outlet");
    expect(stReq).toBeDefined();
    expect(stReq!.count).toBe(SCHEDULED_TASK_THRESHOLD);
    expect(stReq!.threshold).toBe(SCHEDULED_TASK_THRESHOLD);
    expect(stReq!.window).toBe(`${SCHEDULED_TASK_WINDOW_DAYS}d`);
    expect(stReq!.triggeringOccurrenceId).toBe(trigger);

    const logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({
        where: {
          action: "review.repeated_deviation_requested",
          actorLabel: "system:repeated-deviation",
          subjectId: trigger,
        },
      }),
    );
    expect(logs).toHaveLength(1);
    const payload = logs[0].afterJson as Record<string, unknown>;
    expect(payload.groupingKey).toBe("scheduledTask+outlet");
    expect(payload.scheduledTaskId).toBe(site.scheduledTaskId);
    expect(payload.outletId).toBe(site.outletId);
    // Non-PII: no user / name / free-text fields.
    expect(payload).not.toHaveProperty("reason");
    expect(payload).not.toHaveProperty("assigneeUserId");
    expect(logs[0].subjectType).toBe("taskOccurrence");
  });

  it("is idempotent: a 2nd call in the same window emits NO duplicate", async () => {
    const site = await makeSite(orgAId);
    await seedFailures(orgAId, site, 2, 0);
    const trigger = (await seedFailures(orgAId, site, 1, 2))[0];

    const call = () =>
      withTenant(orgAId, (tx) =>
        evaluateRepeatedDeviation(tx, {
          organizationId: orgAId,
          scheduledTaskId: site.scheduledTaskId,
          taskTemplateId: site.templateId,
          outletId: site.outletId,
          triggeringOccurrenceId: trigger,
          now,
        }),
      );
    await call();
    const second = await call();
    expect(second.requested.find((r) => r.groupingKey === "scheduledTask+outlet")).toBeUndefined();

    const count = await withTenant(orgAId, (tx) =>
      tx.activityLog.count({
        where: {
          action: "review.repeated_deviation_requested",
          subjectId: trigger,
        },
      }),
    );
    expect(count).toBe(1); // still exactly one
  });

  it("does NOT trigger for failures on a DIFFERENT outlet (same scheduled task)", async () => {
    const site = await makeSite(orgAId);
    const otherOutlet = await withTenant(orgAId, async (tx) => {
      const property = await tx.property.findFirstOrThrow();
      const o = await tx.outlet.create({
        data: { organizationId: orgAId, propertyId: property.id, name: `Outlet ${randomUUID()}` },
        select: { id: true },
      });
      return o.id;
    });
    // 3 failures on the same scheduled task, but split across two outlets → neither
    // (task,outlet) group reaches 3. Distinct local dates to satisfy the unique constraint.
    await seedOccurrence(orgAId, site, "failed", dayInWindow(0));
    await seedOccurrence(orgAId, site, "failed", dayInWindow(1));
    const trigger = await seedOccurrence(orgAId, site, "failed", dayInWindow(2), {
      outletId: otherOutlet,
    });

    const res = await withTenant(orgAId, (tx) =>
      evaluateRepeatedDeviation(tx, {
        organizationId: orgAId,
        scheduledTaskId: site.scheduledTaskId,
        taskTemplateId: site.templateId,
        outletId: otherOutlet,
        triggeringOccurrenceId: trigger,
        now,
      }),
    );
    expect(res.requested.find((r) => r.groupingKey === "scheduledTask+outlet")).toBeUndefined();
  });

  it("does NOT trigger for failures OUTSIDE the 7-day window", async () => {
    const site = await makeSite(orgAId);
    // 3 failures on distinct dates in early June — all >7 days before `now` (2026-07-20).
    await seedOccurrence(orgAId, site, "failed", new Date(Date.UTC(2026, 6, 1)));
    await seedOccurrence(orgAId, site, "failed", new Date(Date.UTC(2026, 6, 2)));
    const trigger = await seedOccurrence(orgAId, site, "failed", new Date(Date.UTC(2026, 6, 3)));

    const res = await withTenant(orgAId, (tx) =>
      evaluateRepeatedDeviation(tx, {
        organizationId: orgAId,
        scheduledTaskId: site.scheduledTaskId,
        taskTemplateId: site.templateId,
        outletId: site.outletId,
        triggeringOccurrenceId: trigger,
        now,
      }),
    );
    expect(res.requested.find((r) => r.groupingKey === "scheduledTask+outlet")).toBeUndefined();
  });

  it("does NOT count another org's failures (RLS-scoped)", async () => {
    const siteA = await makeSite(orgAId);
    const siteB = await makeSite(orgBId);
    // Two failures in org A on the group.
    await seedFailures(orgAId, siteA, 2, 0);
    // A failure in org B does not count toward org A's window.
    await seedOccurrence(orgBId, siteB, "failed", dayInWindow(0));
    const triggerA = (await seedFailures(orgAId, siteA, 1, 2))[0];

    // Org A now has exactly 3 → should trigger (proves B's row was NOT counted, else it'd be 3 at
    // the 2nd A failure; the key assertion is that only A's rows are visible under withTenant(A)).
    const res = await withTenant(orgAId, (tx) =>
      evaluateRepeatedDeviation(tx, {
        organizationId: orgAId,
        scheduledTaskId: siteA.scheduledTaskId,
        taskTemplateId: siteA.templateId,
        outletId: siteA.outletId,
        triggeringOccurrenceId: triggerA,
        now,
      }),
    );
    const req = res.requested.find((r) => r.groupingKey === "scheduledTask+outlet");
    expect(req).toBeDefined();
    expect(req!.count).toBe(3); // exactly A's three, B's is invisible
  });
});
