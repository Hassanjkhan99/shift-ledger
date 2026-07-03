import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import {
  openException,
  acknowledgeException,
  startExceptionProgress,
  resolveException,
  verifyException,
  reopenException,
  createCorrectiveAction,
  assignCorrectiveAction,
  markCorrectiveActionDone,
  verifyCorrectiveAction,
  rejectCorrectiveAction,
} from "../src/lib/exceptions";

// #9 — exceptions + corrective_actions: RLS isolation, the FULL D2 state machines (§7.2/§7.3) with
// per-edge audit rows through the F4 choke point, illegal-edge rejection, and the acknowledged→
// in_progress / in_progress→resolved auto-cascades. Role/reason/repeated-deviation policy is #10.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Build a property→outlet→template→scheduled_task→occurrence chain to satisfy the exception FKs. */
async function makeOccurrence(orgId: string): Promise<{
  occurrenceId: string;
  propertyId: string;
  outletId: string;
  userId: string;
}> {
  return withTenant(orgId, async (tx) => {
    const property = await tx.property.findFirstOrThrow();
    const outlet = await tx.outlet.findFirstOrThrow();
    const membership = await tx.membership.findFirstOrThrow();
    const template = await tx.taskTemplate.create({
      data: { organizationId: orgId, checkType: "temperature", title: `Fridge ${randomUUID()}` },
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
    const occ = await tx.taskOccurrence.create({
      data: {
        organizationId: orgId,
        propertyId: property.id,
        outletId: outlet.id,
        scheduledTaskId: scheduled.id,
        taskTemplateId: template.id,
        checkType: "temperature",
        occurrenceLocalDate: new Date(Date.UTC(2026, 6, Math.floor(Math.random() * 27) + 1)),
        dueAt: new Date("2026-07-03T04:00:00Z"),
        timezone: "Europe/Berlin",
      },
      select: { id: true },
    });
    return {
      occurrenceId: occ.id,
      propertyId: property.id,
      outletId: outlet.id,
      userId: membership.userId,
    };
  });
}

/** Open a fresh exception in `open` and return its id + the actor user. */
async function makeException(orgId: string): Promise<{ exceptionId: string; userId: string }> {
  const fx = await makeOccurrence(orgId);
  const ex = await withTenant(orgId, (tx) =>
    openException(
      tx,
      {
        organizationId: orgId,
        propertyId: fx.propertyId,
        outletId: fx.outletId,
        taskOccurrenceId: fx.occurrenceId,
        title: "Fridge over 4C",
      },
      { actorUserId: fx.userId },
    ),
  );
  return { exceptionId: ex.id, userId: fx.userId };
}

/** Count activity_log rows for a subject with an optional action/actor filter. */
async function logsFor(
  orgId: string,
  subjectId: string,
  where: { action?: string; actorLabel?: string; actorUserId?: string } = {},
) {
  return withTenant(orgId, (tx) =>
    tx.activityLog.findMany({ where: { subjectId, ...where }, orderBy: { seq: "asc" } }),
  );
}

// ---- RLS isolation --------------------------------------------------------------
describe("exceptions + corrective_actions — RLS cross-tenant isolation", () => {
  it("org B cannot see org A's exception / corrective action; cross-tenant write denied", async () => {
    const { exceptionId } = await makeException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "Move to spare fridge" },
        {
          actorLabel: "system:test",
        },
      ),
    );

    const seenFromB = await withTenant(orgBId, async (tx) => ({
      ex: await tx.exception.findUnique({ where: { id: exceptionId } }),
      ca: await tx.correctiveAction.findUnique({ where: { id: ca.id } }),
      aExCount: await tx.exception.count({ where: { organizationId: orgAId } }),
    }));
    expect(seenFromB.ex).toBeNull();
    expect(seenFromB.ca).toBeNull();
    expect(seenFromB.aExCount).toBe(0);

    // WITH CHECK: org A context cannot insert an exception tagged for org B.
    const fxA = await makeOccurrence(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.exception.create({
          data: {
            organizationId: orgBId,
            propertyId: fxA.propertyId,
            outletId: fxA.outletId,
            taskOccurrenceId: fxA.occurrenceId,
            title: "sneaky",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("no tenant context => zero rows across the 2 new tables (default-deny)", async () => {
    const { prisma } = await import("../src/lib/db");
    const counts = await Promise.all([prisma.exception.count(), prisma.correctiveAction.count()]);
    expect(counts).toEqual([0, 0]);
  });
});

// ---- Exception machine ----------------------------------------------------------
describe("Exception machine (§7.2)", () => {
  it("open→acknowledged→in_progress→resolved→verified each succeeds and writes one audit row", async () => {
    const { exceptionId, userId } = await makeException(orgAId);

    const openLog = await logsFor(orgAId, exceptionId, { action: "exception.opened" });
    expect(openLog).toHaveLength(1);
    expect(openLog[0].subjectType).toBe("exception");
    expect(openLog[0].actorUserId).toBe(userId);

    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      startExceptionProgress(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) => resolveException(tx, exceptionId, { actorUserId: userId }));
    const verified = await withTenant(orgAId, (tx) =>
      verifyException(tx, exceptionId, { actorUserId: userId }),
    );
    expect(verified.status).toBe("verified");

    const row = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(row.status).toBe("verified");
    expect(row.resolvedAt).not.toBeNull(); // set on resolve

    const actions = (await logsFor(orgAId, exceptionId)).map((l) => l.action);
    expect(actions).toEqual([
      "exception.opened",
      "exception.acknowledged",
      "exception.started",
      "exception.resolved",
      "exception.verified",
    ]);
  });

  it("rejects illegal edges: open→verify(direct) and verified→acknowledge(direct)", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    // open → verify is illegal (verify only from resolved).
    await expect(
      withTenant(orgAId, (tx) => verifyException(tx, exceptionId, { actorUserId: userId })),
    ).rejects.toThrow(/illegal transition/i);

    // Drive to verified, then acknowledge directly (illegal — acknowledge only from open/reopened).
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      startExceptionProgress(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) => resolveException(tx, exceptionId, { actorUserId: userId }));
    await withTenant(orgAId, (tx) => verifyException(tx, exceptionId, { actorUserId: userId }));
    await expect(
      withTenant(orgAId, (tx) => acknowledgeException(tx, exceptionId, { actorUserId: userId })),
    ).rejects.toThrow(/illegal transition/i);
  });

  it("reopen loop: verified→reopened→acknowledged works", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      startExceptionProgress(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) => resolveException(tx, exceptionId, { actorUserId: userId }));
    await withTenant(orgAId, (tx) => verifyException(tx, exceptionId, { actorUserId: userId }));

    await withTenant(orgAId, (tx) => reopenException(tx, exceptionId, { actorUserId: userId }));
    const reAck = await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );
    expect(reAck.status).toBe("acknowledged");

    const actions = (await logsFor(orgAId, exceptionId)).map((l) => l.action);
    expect(actions).toContain("exception.reopened");
    // acknowledged appears twice: initial open→ack and reopened→ack.
    expect(actions.filter((a) => a === "exception.acknowledged")).toHaveLength(2);
  });
});

// ---- CorrectiveAction machine ---------------------------------------------------
describe("CorrectiveAction machine (§7.3)", () => {
  it("open→assigned→done→verified each succeeds and is audited", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    // Acknowledge first so the assign cascade has a defined effect (tested separately below).
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );

    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "Recalibrate thermostat" },
        {
          actorUserId: userId,
        },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: new Date() },
        {
          actorUserId: userId,
        },
      ),
    );
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    const verified = await withTenant(orgAId, (tx) =>
      verifyCorrectiveAction(tx, ca.id, { actorUserId: userId }),
    );
    expect(verified.status).toBe("verified");

    const row = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(row.assigneeUserId).toBe(userId);
    expect(row.completedBy).toBe(userId);
    expect(row.completedAt).not.toBeNull();
    expect(row.verifiedBy).toBe(userId);
    expect(row.verifiedAt).not.toBeNull();

    const actions = (await logsFor(orgAId, ca.id)).map((l) => l.action);
    expect(actions).toEqual([
      "corrective.created",
      "corrective.assigned",
      "corrective.done",
      "corrective.verified",
    ]);
  });

  it("rejected→assigned rework path works and is audited", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "Fix seal" }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    await withTenant(orgAId, (tx) => rejectCorrectiveAction(tx, ca.id, { actorUserId: userId }));
    const reAssigned = await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );
    expect(reAssigned.status).toBe("assigned");
  });

  it("rejects illegal edges: open→done and done→assign(direct)", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "x" }, { actorUserId: userId }),
    );
    // open → done is illegal (markDone only from assigned).
    await expect(
      withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId })),
    ).rejects.toThrow(/illegal transition/i);

    // Drive to done, then assign directly (illegal — assign only from open/rejected).
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
      ),
    ).rejects.toThrow(/illegal transition/i);
  });
});

// ---- Cascades -------------------------------------------------------------------
describe("cascades (§7.2)", () => {
  it("assigning the first CA on an acknowledged exception auto-moves it to in_progress", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );

    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "Swap unit" },
        { actorUserId: userId },
      ),
    );
    const assigned = await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );
    expect(assigned.status).toBe("assigned");

    const ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("in_progress");

    // The cascade wrote a system:cascade exception.started audit row.
    const cascadeLog = await logsFor(orgAId, exceptionId, {
      action: "exception.started",
      actorLabel: "system:cascade",
    });
    expect(cascadeLog).toHaveLength(1);
  });

  it("marking the LAST CA done auto-resolves the exception; ONE of TWO done does not", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );

    const ca1 = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "CA1" }, { actorUserId: userId }),
    );
    const ca2 = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "CA2" }, { actorUserId: userId }),
    );
    // Assigning ca1 cascades the exception acknowledged→in_progress.
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca1.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca2.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );

    // Mark only ca1 done → exception stays in_progress (ca2 still outstanding).
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca1.id, { actorUserId: userId }));
    let ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("in_progress");

    // Mark ca2 done → all CAs done → exception auto-resolves.
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca2.id, { actorUserId: userId }));
    ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("resolved");
    expect(ex.resolvedAt).not.toBeNull();

    const cascadeResolve = await logsFor(orgAId, exceptionId, {
      action: "exception.resolved",
      actorLabel: "system:cascade",
    });
    expect(cascadeResolve).toHaveLength(1);
  });
});
