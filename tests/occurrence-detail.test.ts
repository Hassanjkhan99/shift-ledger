import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { readOccurrenceDetail, isActionable } from "../src/lib/occurrence-detail";
import { createTemplate } from "../src/lib/templates";
import { createSchedule, generateNow } from "../src/lib/schedules";

// #137 — the task-detail read: template/threshold/required-evidence from the frozen config_snapshot,
// status, and completion history; cross-tenant isolation. The completion WRITE path is covered by #17.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

async function seedOccurrence(): Promise<{ occurrenceId: string }> {
  const actorUserId = await withTenant(orgAId, async (tx) => {
    const u = await tx.user.create({
      data: { email: `det-${randomUUID()}@example.com`, name: "Det" },
      select: { id: true },
    });
    return u.id;
  });
  // Create our own active property + outlet so other tests' archive/tombstone fixtures can't leave us
  // pointing at an outlet under an archived property (createSchedule rejects those, #157).
  const outletId = await withTenant(orgAId, async (tx) => {
    const p = await tx.property.create({
      data: {
        organizationId: orgAId,
        name: `Det Prop ${randomUUID().slice(0, 8)}`,
        timezone: "Europe/Berlin",
        countryCode: "DE",
      },
      select: { id: true },
    });
    const o = await tx.outlet.create({
      data: { organizationId: orgAId, propertyId: p.id, name: "Det Kitchen" },
      select: { id: true },
    });
    return o.id;
  });
  const templateId = await withTenant(orgAId, (tx) =>
    createTemplate(tx, {
      organizationId: orgAId,
      actorUserId,
      title: `Det Tpl ${randomUUID().slice(0, 6)}`,
      checkType: "temperature",
      requiredEvidence: ["temperature", "photo"],
      targetConfig: { minC: 0, maxC: 5 },
    }).then((r) => r.templateId),
  );
  const today = new Date().toISOString().slice(0, 10);
  const scheduleId = await withTenant(orgAId, (tx) =>
    createSchedule(tx, {
      organizationId: orgAId,
      actorUserId,
      outletId,
      taskTemplateId: templateId,
      recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
      timezone: "Europe/Berlin",
      graceMinutes: 15,
      assigneeRole: "KitchenManager",
      startsOn: today,
    }).then((r) => (r.status === "ok" ? r.scheduleId : "")),
  );
  await withTenant(orgAId, (tx) => generateNow(tx, { organizationId: orgAId, now: new Date() }));
  const occ = await withTenant(orgAId, (tx) =>
    tx.taskOccurrence.findFirst({
      where: { scheduledTaskId: scheduleId },
      select: { id: true },
    }),
  );
  return { occurrenceId: occ!.id };
}

describe("readOccurrenceDetail (#137)", () => {
  it("returns the frozen template config (threshold + required evidence) and status", async () => {
    const { occurrenceId } = await seedOccurrence();
    const detail = await withTenant(orgAId, (tx) => readOccurrenceDetail(tx, occurrenceId));
    expect(detail).not.toBeNull();
    expect(detail!.targetConfig).toEqual({ minC: 0, maxC: 5 });
    expect(detail!.requiredEvidence).toEqual(expect.arrayContaining(["temperature", "photo"]));
    expect(detail!.checkType).toBe("temperature");
    expect(isActionable(detail!.status)).toBe(true); // freshly generated → pending/due
    expect(detail!.completions).toEqual([]);
  });

  it("does not leak an org A occurrence into org B (RLS, D6)", async () => {
    const { occurrenceId } = await seedOccurrence();
    const fromB = await withTenant(orgBId, (tx) => readOccurrenceDetail(tx, occurrenceId));
    expect(fromB).toBeNull();
  });

  it("hides an occurrence outside the member's property scope (#152)", async () => {
    const { occurrenceId } = await seedOccurrence();
    // A scope that does not include the occurrence's property → not found.
    const outOfScope = await withTenant(orgAId, (tx) =>
      readOccurrenceDetail(tx, occurrenceId, [randomUUID()]),
    );
    expect(outOfScope).toBeNull();
    // Empty scope (org-admin) still sees it.
    const admin = await withTenant(orgAId, (tx) => readOccurrenceDetail(tx, occurrenceId, []));
    expect(admin).not.toBeNull();
  });

  it("isActionable is false for terminal states", () => {
    expect(isActionable("completed")).toBe(false);
    expect(isActionable("failed")).toBe(false);
    expect(isActionable("skipped")).toBe(false);
    expect(isActionable("pending")).toBe(true);
    expect(isActionable("due")).toBe(true);
    expect(isActionable("overdue")).toBe(true);
  });
});
