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

    await withTenant(orgAId, (tx) => reopenException(tx, exceptionId, { actorUserId: userId }));
    const reopened = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({ where: { id: exceptionId } }),
    );
    expect(reopened.status).toBe("reopened");
    expect(reopened.resolvedAt).toBeNull(); // cleared on reopen

    // The prior resolved status remains captured in the reopen edge's before_json audit row.
    const reopenLog = await logsFor(orgAId, exceptionId, { action: "exception.reopened" });
    expect(reopenLog).toHaveLength(1);
    expect(reopenLog[0].beforeJson).toMatchObject({ status: "resolved" });
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

  it("assign requires exactly one assignee (neither → throws, both → throws, one → ok)", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "y" }, { actorUserId: userId }),
    );

    // Neither assigneeUserId nor assigneeRole → reject before any transition.
    await expect(
      withTenant(orgAId, (tx) => assignCorrectiveAction(tx, ca.id, {}, { actorUserId: userId })),
    ).rejects.toThrow(/exactly one of assigneeUserId or assigneeRole/i);

    // Both provided → reject.
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(
          tx,
          ca.id,
          { assigneeUserId: userId, assigneeRole: "KitchenManager" },
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
        { assigneeRole: "KitchenManager" },
        { actorUserId: userId },
      ),
    );
    expect(assigned.status).toBe("assigned");
  });

  it("rework reassignment (rejected→assigned) clears stale completedBy/completedAt", async () => {
    const { exceptionId, userId } = await makeException(orgAId);
    const ca = await withTenant(orgAId, (tx) =>
      createCorrectiveAction(tx, { exceptionId, description: "reseal" }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) => markCorrectiveActionDone(tx, ca.id, { actorUserId: userId }));

    const done = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(done.completedBy).toBe(userId);
    expect(done.completedAt).not.toBeNull();

    await withTenant(orgAId, (tx) => rejectCorrectiveAction(tx, ca.id, { actorUserId: userId }));
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );

    const reassigned = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: ca.id } }),
    );
    expect(reassigned.status).toBe("assigned");
    expect(reassigned.completedBy).toBeNull(); // cleared — the row no longer looks completed
    expect(reassigned.completedAt).toBeNull();
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
      assignCorrectiveAction(tx, ca1.id, { assigneeUserId: userId }, { actorUserId: userId }),
    );
    await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(tx, ca2.id, { assigneeUserId: userId }, { actorUserId: userId }),
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
      assignCorrectiveAction(tx, ca.id, { assigneeUserId: userId }, { actorUserId: userId }),
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
});
