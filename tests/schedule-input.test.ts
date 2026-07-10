import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createScheduleInput } from "../src/lib/schedule-input";
import { canManageSchedules, canManageScheduleAt } from "../src/lib/permissions";
import { OrgRole } from "../src/generated/prisma/enums";

// #136 — schedule validation contract (assignee XOR, grace 0–60, recurrence, date order) + D7 gate.

const base = {
  organizationId: randomUUID(),
  outletId: randomUUID(),
  taskTemplateId: randomUUID(),
  recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
  timezone: "Europe/Berlin",
  graceMinutes: 15,
  startsOn: "2026-03-10",
};

describe("schedule input validation (#136)", () => {
  it("requires exactly one assignee (role XOR user)", () => {
    expect(
      createScheduleInput.safeParse({ ...base, assigneeRole: OrgRole.KitchenManager }).success,
    ).toBe(true);
    expect(createScheduleInput.safeParse({ ...base, assigneeUserId: randomUUID() }).success).toBe(
      true,
    );
    // neither
    expect(createScheduleInput.safeParse({ ...base }).success).toBe(false);
    // both
    expect(
      createScheduleInput.safeParse({
        ...base,
        assigneeRole: OrgRole.Staff,
        assigneeUserId: randomUUID(),
      }).success,
    ).toBe(false);
  });

  it("enforces grace 0–60", () => {
    expect(
      createScheduleInput.safeParse({ ...base, assigneeRole: OrgRole.Staff, graceMinutes: 0 })
        .success,
    ).toBe(true);
    expect(
      createScheduleInput.safeParse({ ...base, assigneeRole: OrgRole.Staff, graceMinutes: 60 })
        .success,
    ).toBe(true);
    expect(
      createScheduleInput.safeParse({ ...base, assigneeRole: OrgRole.Staff, graceMinutes: 61 })
        .success,
    ).toBe(false);
    expect(
      createScheduleInput.safeParse({ ...base, assigneeRole: OrgRole.Staff, graceMinutes: -1 })
        .success,
    ).toBe(false);
  });

  it("rejects a malformed recurrence (empty byWeekday, or filter/freq mismatch)", () => {
    expect(
      createScheduleInput.safeParse({
        ...base,
        assigneeRole: OrgRole.Staff,
        recurrence: { freq: "weekly", interval: 1, byWeekday: [], timeOfDay: "06:00" },
      }).success,
    ).toBe(false);
    expect(
      createScheduleInput.safeParse({
        ...base,
        assigneeRole: OrgRole.Staff,
        recurrence: { freq: "daily", interval: 1, byWeekday: [1], timeOfDay: "06:00" },
      }).success,
    ).toBe(false);
  });

  it("rejects endsOn before startsOn", () => {
    expect(
      createScheduleInput.safeParse({
        ...base,
        assigneeRole: OrgRole.Staff,
        endsOn: "2026-03-09",
      }).success,
    ).toBe(false);
  });

  it("rejects an impossible calendar date (#161)", () => {
    expect(
      createScheduleInput.safeParse({
        ...base,
        assigneeRole: OrgRole.Staff,
        startsOn: "2026-02-31",
      }).success,
    ).toBe(false);
    expect(
      createScheduleInput.safeParse({
        ...base,
        assigneeRole: OrgRole.Staff,
        startsOn: "2026-02-28",
      }).success,
    ).toBe(true);
  });

  it("gates authorship to Owner/OrgAdmin/PropertyManager/KitchenManager", () => {
    expect(canManageSchedules(OrgRole.PropertyManager)).toBe(true);
    expect(canManageSchedules(OrgRole.KitchenManager)).toBe(true);
    expect(canManageSchedules(OrgRole.ShiftLeader)).toBe(false);
    expect(canManageSchedules(OrgRole.Staff)).toBe(false);
  });

  it("scopes schedule management to the manager's properties (#152)", () => {
    const p1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const p2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    // Org-admins: any property.
    expect(canManageScheduleAt(OrgRole.Owner, [], p1)).toBe(true);
    expect(canManageScheduleAt(OrgRole.OrgAdmin, [p2], p1)).toBe(true);
    // Scoped PM/KM: in-scope only; empty scope = whole org.
    expect(canManageScheduleAt(OrgRole.PropertyManager, [p1], p1)).toBe(true);
    expect(canManageScheduleAt(OrgRole.PropertyManager, [p1], p2)).toBe(false);
    expect(canManageScheduleAt(OrgRole.KitchenManager, [p1], p1)).toBe(true);
    expect(canManageScheduleAt(OrgRole.KitchenManager, [p1], p2)).toBe(false);
    expect(canManageScheduleAt(OrgRole.KitchenManager, [], p1)).toBe(true);
    // Others never.
    expect(canManageScheduleAt(OrgRole.Staff, [], p1)).toBe(false);
  });
});
