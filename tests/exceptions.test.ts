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
        assigneeRole: "KitchenManager",
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

/** A fixed due date used for assignments (assignCorrectiveAction now requires a dueAt). */
const DUE = new Date("2026-07-10T12:00:00Z");

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

/** Open a fresh exception and advance it to `acknowledged` (the parent state assign requires). */
async function makeAcknowledgedException(
  orgId: string,
): Promise<{ exceptionId: string; userId: string }> {
  const { exceptionId, userId } = await makeException(orgId);
  await withTenant(orgId, (tx) => acknowledgeException(tx, exceptionId, { actorUserId: userId }));
  return { exceptionId, userId };
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

  it("reopen clears resolved_at; the prior value survives in the audit log", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      startExceptionProgress(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) => resolveException(tx, exceptionId, { actorUserId: userId }));

    const resolved = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(resolved.resolvedAt).not.toBeNull();
    const priorResolvedAt = resolved.resolvedAt!.toISOString();

    await withTenant(orgAId, (tx) => reopenException(tx, exceptionId, { actorUserId: userId }));
    const reopened = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(reopened.status).toBe("reopened");
    expect(reopened.resolvedAt).toBeNull(); // cleared on reopen

    // The prior resolved status AND the resolved_at it cleared are captured in the reopen edge's
    // before_json audit row; after_json records the cleared (null) resolved_at.
    const reopenLog = await logsFor(orgAId, exceptionId, { action: "exception.reopened" });
    expect(reopenLog).toHaveLength(1);
    expect(reopenLog[0].beforeJson).toMatchObject({
      status: "resolved",
      resolvedAt: priorResolvedAt,
    });
    expect(reopenLog[0].afterJson).toMatchObject({ status: "reopened", resolvedAt: null });
  });

  it("stale-status CAS: an edge whose expected `from` row was changed underneath it rejects, no extra audit row", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      startExceptionProgress(tx, exceptionId, { actorUserId: userId }),
    );
    // Row is now `in_progress`. resolve's legal `from` is in_progress.

    const auditBefore = await logsFor(orgAId, exceptionId);

    // Exercise the CAS directly with the same shape exceptionEdge uses: read a (soon-to-be) stale
    // pre-state, let another writer advance the row, then attempt the conditional updateMany keyed
    // on the stale `from`. The CAS matches 0 rows → count !== 1. We assert the guard's contract:
    // the conditional write is a no-op (does not resolve the row) and thus produces no audit row.
    await withTenant(orgAId, async (tx) => {
      const preState = await tx.exception.findUniqueOrThrow({
        where: { id: exceptionId },
        select: { status: true },
      });
      expect(preState.status).toBe("in_progress");

      // A concurrent legal edge wins the race first (in_progress → resolved), committed here.
      await resolveException(tx, exceptionId, { actorUserId: userId });

      // Now replay the CAS the loser would have issued from its captured `in_progress` pre-state.
      const cas = await tx.exception.updateMany({
        where: { id: exceptionId, status: preState.status },
        data: { status: "resolved" },
      });
      expect(cas.count).toBe(0); // lost the race — no row matched the stale `from`
    });

    // Exactly ONE resolve happened (the winner); the loser's CAS wrote nothing.
    const resolveLogs = await logsFor(orgAId, exceptionId, { action: "exception.resolved" });
    expect(resolveLogs).toHaveLength(1);
    expect((await logsFor(orgAId, exceptionId)).length).toBe(auditBefore.length + 1);

    // And a real edge call from the now-stale state fails loudly (assertFrom / CAS), writing nothing.
    const auditMid = await logsFor(orgAId, exceptionId);
    await expect(
      withTenant(orgAId, (tx) => resolveException(tx, exceptionId, { actorUserId: userId })),
    ).rejects.toThrow();
    expect((await logsFor(orgAId, exceptionId)).length).toBe(auditMid.length); // no extra audit row
  });

  it("a soft-deleted exception cannot be transitioned (edge rejects loudly, writes no audit row)", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    await withTenant(orgAId, (tx) =>
      tx.exception.update({ where: { id: exceptionId }, data: { deletedAt: new Date() } }),
    );
    const auditBefore = await logsFor(orgAId, exceptionId);
    await expect(
      withTenant(orgAId, (tx) => acknowledgeException(tx, exceptionId, { actorUserId: userId })),
    ).rejects.toThrow(/soft-deleted/i);
    expect((await logsFor(orgAId, exceptionId)).length).toBe(auditBefore.length);
  });

  it("two openException calls for the same occurrence yield ONE active exception (idempotent retry)", async () => {
    const fx = await makeOccurrence(orgAId);
    const openInput = {
      organizationId: orgAId,
      propertyId: fx.propertyId,
      outletId: fx.outletId,
      taskOccurrenceId: fx.occurrenceId,
      title: "Fridge over 4C",
    };
    const first = await withTenant(orgAId, (tx) =>
      openException(tx, openInput, { actorUserId: fx.userId }),
    );
    const second = await withTenant(orgAId, (tx) =>
      openException(tx, openInput, { actorUserId: fx.userId }),
    );
    // The retry returned the same row, did not create a second.
    expect(second.id).toBe(first.id);
    const active = await withTenant(orgAId, (tx) =>
      tx.exception.count({
        where: { taskOccurrenceId: fx.occurrenceId, deletedAt: null, status: { not: "verified" } },
      }),
    );
    expect(active).toBe(1);
    // Only one exception.opened audit row was written.
    expect(await logsFor(orgAId, first.id, { action: "exception.opened" })).toHaveLength(1);
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
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "Fix seal" }, { actorUserId: userId }),
    );
    // Second outstanding CA keeps the parent `in_progress` so the reject below does not reopen it
    // (a reopened parent could not be reassigned to — that guard is tested separately).
    const keepOpen = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "outstanding" },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        keepOpen.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    await withTenant(orgAId, (tx) => rejectCorrectiveAction(tx, ca.id, { actorUserId: userId }));
    const reAssigned = await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    expect(reAssigned.status).toBe("assigned");
  });

  it("assign requires exactly one assignee (neither → throws, both → throws, one → ok)", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "y" }, { actorUserId: userId }),
    );

    // Neither assigneeUserId nor assigneeRole → reject before any transition.
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(tx, ca.id, { dueAt: DUE }, { actorUserId: userId }),
      ),
    ).rejects.toThrow(/exactly one of assigneeUserId or assigneeRole/i);

    // Both provided → reject.
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(
          tx,
          ca.id,
          { assigneeUserId: userId, assigneeRole: "KitchenManager", dueAt: DUE },
          { actorUserId: userId },
        ),
      ),
    ).rejects.toThrow(/exactly one of assigneeUserId or assigneeRole/i);

    // The failed attempts did not transition the CA (still open) and wrote no assigned audit row.
    const stillOpen = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(stillOpen.status).toBe("open");
    expect(await logsFor(orgAId, ca.id, { action: "corrective.assigned" })).toHaveLength(0);

    // Exactly one (role only) → ok.
    const assigned = await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeRole: "KitchenManager", dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    expect(assigned.status).toBe("assigned");
  });

  it("assign requires a dueAt (missing → throws, present → ok)", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "needs deadline" },
        { actorUserId: userId },
      ),
    );

    // No dueAt → reject before any transition (assignee is valid, only the deadline is missing).
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
      ),
    ).rejects.toThrow(/dueAt|due date/i);

    // Still open, no assigned audit row from the failed attempt.
    const stillOpen = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(stillOpen.status).toBe("open");
    expect(await logsFor(orgAId, ca.id, { action: "corrective.assigned" })).toHaveLength(0);

    // With a dueAt → ok, and due_at is persisted.
    const assigned = await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    expect(assigned.status).toBe("assigned");
    const row = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(row.dueAt?.toISOString()).toBe(DUE.toISOString());
  });

  it("assign rejects when the parent exception is not acknowledged/in_progress", async () => {
    // Parent still `open` (never acknowledged) → assign must reject.
    const { exceptionId, userId } = await makeException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "premature" },
        { actorUserId: userId },
      ),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(
          tx,
          ca.id,
          { assigneeUserId: userId, dueAt: DUE },
          { actorUserId: userId },
        ),
      ),
    ).rejects.toThrow(/acknowledged.*in_progress|parent exception/i);

    // CA untouched, no assigned audit row.
    const stillOpen = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(stillOpen.status).toBe("open");
    expect(await logsFor(orgAId, ca.id, { action: "corrective.assigned" })).toHaveLength(0);

    // Acknowledge the parent → assign now succeeds AND cascades acknowledged → in_progress.
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );
    const assigned = await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    expect(assigned.status).toBe("assigned");
    const ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("in_progress");

    // Assigning a second CA while the parent is already in_progress is also allowed.
    const ca2 = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "second" }, { actorUserId: userId }),
    );
    const assigned2 = await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca2.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    expect(assigned2.status).toBe("assigned");
  });

  it("rework reassignment (rejected→assigned) clears stale completedBy/completedAt", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "reseal" }, { actorUserId: userId }),
    );
    // Keep the parent in_progress across the rework so the reject does not reopen it.
    const keepOpen = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "outstanding" },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        keepOpen.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));

    const done = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(done.completedBy).toBe(userId);
    expect(done.completedAt).not.toBeNull();

    await withTenant(orgAId, (tx) => rejectCorrectiveAction(tx, ca.id, { actorUserId: userId }));
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );

    const reassigned = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(reassigned.status).toBe("assigned");
    expect(reassigned.completedBy).toBeNull(); // cleared — the row no longer looks completed
    expect(reassigned.completedAt).toBeNull();
  });

  it("corrective-action audit before/after capture the assignee + due change (not just status)", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "audit fields" },
        { actorUserId: userId },
      ),
    );
    // A second, always-outstanding CA keeps the parent `in_progress` through ca's rework, so the
    // reject below does not cascade the parent to resolved/reopened (which would block reassigning).
    const keepOpen = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "keeps parent in_progress" },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        keepOpen.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );

    // First assign: before has null assignee/role/due, after has the new user assignee + due.
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    // Rework so we can reassign to a different target (role) + due and see the prior owner survive.
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    await withTenant(orgAId, (tx) => rejectCorrectiveAction(tx, ca.id, { actorUserId: userId }));
    const DUE2 = new Date("2026-08-01T09:00:00Z");
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeRole: "KitchenManager", dueAt: DUE2 },
        { actorUserId: userId },
      ),
    );

    const assignLogs = await logsFor(orgAId, ca.id, { action: "corrective.assigned" });
    expect(assignLogs).toHaveLength(2);

    // First assign: assignee/role null → userId/null, due null → DUE.
    expect(assignLogs[0].beforeJson).toMatchObject({
      status: "open",
      assigneeUserId: null,
      assigneeRole: null,
      dueAt: null,
    });
    expect(assignLogs[0].afterJson).toMatchObject({
      status: "assigned",
      assigneeUserId: userId,
      dueAt: DUE.toISOString(),
    });

    // Reassign: before captures the PRIOR owner/due (userId/DUE), after the new (role/DUE2). The
    // prior assignee would be lost if the snapshot only recorded status.
    expect(assignLogs[1].beforeJson).toMatchObject({
      assigneeUserId: userId,
      assigneeRole: null,
      dueAt: DUE.toISOString(),
    });
    expect(assignLogs[1].afterJson).toMatchObject({
      assigneeUserId: null,
      assigneeRole: "KitchenManager",
      dueAt: DUE2.toISOString(),
    });
  });

  it("createCorrectiveAction is allowed under open/acknowledged/in_progress parents", async () => {
    // open parent
    const open = await makeException(orgAId);
    const caOpen = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId: open.exceptionId, description: "under open" },
        { actorUserId: open.userId },
      ),
    );
    expect(caOpen.status).toBe("open");

    // acknowledged parent
    const ack = await makeAcknowledgedException(orgAId);
    const caAck = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId: ack.exceptionId, description: "under acknowledged" },
        { actorUserId: ack.userId },
      ),
    );
    expect(caAck.status).toBe("open");

    // in_progress parent (drive it there via the assign cascade of the first CA)
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        caAck.id,
        { assigneeUserId: ack.userId, dueAt: DUE },
        { actorUserId: ack.userId },
      ),
    );
    const inProgress = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: ack.exceptionId } }),
    );
    expect(inProgress.status).toBe("in_progress");
    const caInProg = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId: ack.exceptionId, description: "under in_progress" },
        { actorUserId: ack.userId },
      ),
    );
    expect(caInProg.status).toBe("open");
  });

  it("createCorrectiveAction rejects a resolved parent and a soft-deleted parent", async () => {
    // Resolved parent: acknowledged exception with a sole CA that is marked done → auto-resolves.
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "sole" }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    const resolved = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(resolved.status).toBe("resolved");
    await expect(
      withTenant(orgAId, (tx) =>
        createCorrectiveAction(tx, { exceptionId, description: "late" }, { actorUserId: userId }),
      ),
    ).rejects.toThrow(/resolved|cannot attach/i);

    // Soft-deleted parent.
    const del = await makeException(orgAId);
    await withTenant(orgAId, (tx) =>
      tx.exception.update({ where: { id: del.exceptionId }, data: { deletedAt: new Date() } }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        createCorrectiveAction(
          tx,
          { exceptionId: del.exceptionId, description: "orphan" },
          { actorUserId: del.userId },
        ),
      ),
    ).rejects.toThrow(/soft-deleted|cannot attach/i);
  });

  it("markCorrectiveActionDone / verifyCorrectiveAction require a user actor (system actor rejected)", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "attrib" }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );

    // System actor (actorLabel only) rejected for markDone; CA stays `assigned`, no audit row.
    const auditBeforeDone = await logsFor(orgAId, ca.id);
    await expect(
      withTenant(orgAId, (tx) =>
        markCorrectiveActionDone(tx, ca.id, { actorLabel: "system:import" }),
      ),
    ).rejects.toThrow(/user actor|actorUserId/i);
    expect((await logsFor(orgAId, ca.id)).length).toBe(auditBeforeDone.length);

    // User actor → ok, completedBy set to the user.
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    const done = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(done.completedBy).toBe(userId);

    // System actor rejected for verify; CA stays `done`, no audit row.
    const auditBeforeVerify = await logsFor(orgAId, ca.id);
    await expect(
      withTenant(orgAId, (tx) =>
        verifyCorrectiveAction(tx, ca.id, { actorLabel: "system:import" }),
      ),
    ).rejects.toThrow(/user actor|actorUserId/i);
    expect((await logsFor(orgAId, ca.id)).length).toBe(auditBeforeVerify.length);

    // User actor → ok, verifiedBy set to the user.
    await withTenant(orgAId, (tx) => verifyCorrectiveAction(tx, ca.id, { actorUserId: userId }));
    const verified = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(verified.verifiedBy).toBe(userId);
  });

  it("rejects illegal edges: open→done and done→assign(direct)", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "x" }, { actorUserId: userId }),
    );
    // open → done is illegal (markDone only from assigned).
    await expect(
      withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId })),
    ).rejects.toThrow(/illegal transition/i);

    // Drive to done, then assign directly (illegal — assign only from open/rejected).
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(
          tx,
          ca.id,
          { assigneeUserId: userId, dueAt: DUE },
          { actorUserId: userId },
        ),
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
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
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
      assignCorrectiveAction(
        tx,
        ca1.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca2.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
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

  it("a CA that advanced done→verified still counts as complete for the resolve cascade", async () => {
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
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca1.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca2.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );

    // ca1: done → verified BEFORE the last CA finishes. It must still count as complete.
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca1.id, { actorUserId: userId }));
    await withTenant(orgAId, (tx) => verifyCorrectiveAction(tx, ca1.id, { actorUserId: userId }));

    let ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("in_progress"); // ca2 still outstanding

    // Now mark ca2 done → remaining = CAs not in (done, verified) = 0 → exception auto-resolves.
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca2.id, { actorUserId: userId }));
    ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("resolved");
    expect(ex.resolvedAt).not.toBeNull();
  });

  it("rejecting a CA whose done-cascade had auto-resolved the exception reopens it", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    await withTenant(orgAId, (tx) =>
      acknowledgeException(tx, exceptionId, { actorUserId: userId }),
    );

    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "sole CA" }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    // Sole CA done → resolve cascade auto-moves the exception to resolved.
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    let ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("resolved");

    // Reject the CA's work → exception no longer resolved → cascade resolved→reopened.
    const rejected = await withTenant(orgAId, (tx) =>
      rejectCorrectiveAction(tx, ca.id, { actorUserId: userId }),
    );
    expect(rejected.status).toBe("rejected");

    ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("reopened");
    expect(ex.resolvedAt).toBeNull(); // reopen cleared the stale resolved_at

    const cascadeReopen = await logsFor(orgAId, exceptionId, {
      action: "exception.reopened",
      actorLabel: "system:cascade",
    });
    expect(cascadeReopen).toHaveLength(1);
  });

  it("rejecting a CA whose parent had already advanced to VERIFIED reopens the parent", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "sole CA" }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    // Sole CA done → cascade resolves the exception. Then a manager VERIFIES the exception while the
    // CA is still `done` (not yet CA-verified). Parent is now `verified` with rework still possible.
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));
    await withTenant(orgAId, (tx) => verifyException(tx, exceptionId, { actorUserId: userId }));
    let ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("verified");

    // Reject the CA → parent must reopen even though it is `verified` (not just `resolved`).
    const rejected = await withTenant(orgAId, (tx) =>
      rejectCorrectiveAction(tx, ca.id, { actorUserId: userId }),
    );
    expect(rejected.status).toBe("rejected");

    ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("reopened");
    expect(ex.resolvedAt).toBeNull(); // reopen cleared the stale resolved_at

    const cascadeReopen = await logsFor(orgAId, exceptionId, {
      action: "exception.reopened",
      actorLabel: "system:cascade",
    });
    expect(cascadeReopen).toHaveLength(1);
  });

  it("direct resolveException is blocked while a corrective action is unfinished", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "outstanding" },
        { actorUserId: userId },
      ),
    );
    // Assign cascades the parent acknowledged→in_progress. The CA is `assigned` (unfinished).
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    const inProgress = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(inProgress.status).toBe("in_progress");

    // Direct resolve must be rejected: the D2 "all actions done" rule cannot be bypassed.
    await expect(
      withTenant(orgAId, (tx) => resolveException(tx, exceptionId, { actorUserId: userId })),
    ).rejects.toThrow(/outstanding|corrective action/i);
    const stillInProgress = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(stillInProgress.status).toBe("in_progress"); // unchanged, no resolve

    // An exception with NO unfinished corrective actions resolves via the direct edge. Use a fresh
    // in_progress exception with zero CAs — outstanding count is 0, so resolveException succeeds.
    const fresh = await makeAcknowledgedException(orgAId);
    await withTenant(orgAId, (tx) =>
      startExceptionProgress(tx, fresh.exceptionId, { actorUserId: fresh.userId }),
    );
    const resolved = await withTenant(orgAId, (tx) =>
      resolveException(tx, fresh.exceptionId, { actorUserId: fresh.userId }),
    );
    expect(resolved.status).toBe("resolved");
  });

  it("a soft-deleted corrective action cannot be transitioned and does not count toward auto-resolve", async () => {
    const { exceptionId, userId } = await makeAcknowledgedException(orgAId);
    const ca1 = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "live CA" }, { actorUserId: userId }),
    );
    const ca2 = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(
        tx,
        { exceptionId, description: "to be deleted" },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca1.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        ca2.id,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );

    // Soft-delete ca2.
    await withTenant(orgAId, (tx) =>
      tx.correctiveAction.update({ where: { id: ca2.id }, data: { deletedAt: new Date() } }),
    );

    // A soft-deleted CA cannot be transitioned (edge rejects loudly, writes no audit row).
    const auditBefore = await logsFor(orgAId, ca2.id);
    await expect(
      withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca2.id, { actorUserId: userId })),
    ).rejects.toThrow(/soft-deleted/i);
    expect((await logsFor(orgAId, ca2.id)).length).toBe(auditBefore.length);

    // Marking the LIVE ca1 done resolves the exception: the deleted ca2 (still `assigned`) must NOT
    // count as outstanding. remaining = non-deleted CAs not in (done, verified) = 0.
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca1.id, { actorUserId: userId }));
    const ex = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(ex.status).toBe("resolved");
    expect(ex.resolvedAt).not.toBeNull();
  });
});
