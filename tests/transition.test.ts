import { describe, it, expect, inject, afterAll } from "vitest";
import { withTenant, disconnect } from "../src/lib/db";
import { transition, logActivity } from "../src/lib/transition";

// Exercise the F4 choke point against memberships.status — a real status column that exists
// today — so we prove the mechanism without depending on later-milestone tables. Each test
// tags its activity_log rows with a unique `action` string so assertions can't bleed across
// tests (or across the shared seed).
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Fetch any membership in org A. The seed guarantees at least one. */
async function anyMembership() {
  const m = await withTenant(orgAId, (tx) => tx.membership.findFirst());
  expect(m).not.toBeNull();
  return m!;
}

describe("transition() — F4 choke point atomicity", () => {
  it("atomic success: mutation applied AND exactly one matching activity_log row written", async () => {
    const membership = await anyMembership();
    const action = "test.transition.success";
    const newStatus = membership.status === "active" ? "suspended" : "active";

    const result = await withTenant(orgAId, (tx) =>
      transition(tx, {
        organizationId: orgAId,
        subjectType: "membership",
        subjectId: membership.id,
        action,
        actorUserId: membership.userId,
        before: { status: membership.status },
        after: { status: newStatus },
        mutate: (t) =>
          t.membership.update({ where: { id: membership.id }, data: { status: newStatus } }),
      }),
    );
    expect(result.status).toBe(newStatus);

    const after = await withTenant(orgAId, (tx) =>
      tx.membership.findUnique({ where: { id: membership.id } }),
    );
    expect(after!.status).toBe(newStatus);

    const logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({ where: { action, subjectId: membership.id } }),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].subjectType).toBe("membership");
    expect(logs[0].actorUserId).toBe(membership.userId);
    expect(logs[0].actorLabel).toBeNull();
  });

  it("rollback when the log insert fails: mutation is rolled back too", async () => {
    const membership = await anyMembership();
    const action = "test.transition.logfail";
    const targetStatus = "rollback-sentinel";

    // Force the activity_log INSERT to fail at the DB level while the membership mutation has
    // already succeeded in the same tx: log the row under orgB while the tenant context (GUC)
    // is orgA. RLS's WITH CHECK on activity_log rejects the row (organization_id != current
    // org), which must roll back the whole tx — including the membership update.
    await expect(
      withTenant(orgAId, (tx) =>
        transition(tx, {
          organizationId: orgBId, // mismatched org -> activity_log WITH CHECK rejects the insert
          subjectType: "membership",
          subjectId: membership.id,
          action,
          actorLabel: "system:test",
          mutate: (t) =>
            t.membership.update({ where: { id: membership.id }, data: { status: targetStatus } }),
        }),
      ),
    ).rejects.toThrow();

    const after = await withTenant(orgAId, (tx) =>
      tx.membership.findUnique({ where: { id: membership.id } }),
    );
    expect(after!.status).not.toBe(targetStatus); // mutation rolled back

    const logs = await withTenant(orgAId, (tx) => tx.activityLog.findMany({ where: { action } }));
    expect(logs).toHaveLength(0); // no log row survived
  });

  it("rollback when the caller throws after a successful transition: nothing persists", async () => {
    const membership = await anyMembership();
    const action = "test.transition.callerthrow";
    const targetStatus = "caller-throw-sentinel";

    await expect(
      withTenant(orgAId, async (tx) => {
        await transition(tx, {
          organizationId: orgAId,
          subjectType: "membership",
          subjectId: membership.id,
          action,
          actorUserId: membership.userId,
          mutate: (t) =>
            t.membership.update({ where: { id: membership.id }, data: { status: targetStatus } }),
        });
        throw new Error("caller aborts after transition");
      }),
    ).rejects.toThrow(/caller aborts/);

    const after = await withTenant(orgAId, (tx) =>
      tx.membership.findUnique({ where: { id: membership.id } }),
    );
    expect(after!.status).not.toBe(targetStatus);

    const logs = await withTenant(orgAId, (tx) => tx.activityLog.findMany({ where: { action } }));
    expect(logs).toHaveLength(0);
  });

  it("requireReason: rejects before any write when reason is blank", async () => {
    const membership = await anyMembership();
    const action = "test.transition.requirereason";
    const targetStatus = "require-reason-sentinel";

    await expect(
      withTenant(orgAId, (tx) =>
        transition(tx, {
          organizationId: orgAId,
          subjectType: "membership",
          subjectId: membership.id,
          action,
          actorUserId: membership.userId,
          requireReason: true,
          reason: "   ", // whitespace-only -> blank
          mutate: (t) =>
            t.membership.update({ where: { id: membership.id }, data: { status: targetStatus } }),
        }),
      ),
    ).rejects.toThrow(/requires a non-empty reason/);

    const after = await withTenant(orgAId, (tx) =>
      tx.membership.findUnique({ where: { id: membership.id } }),
    );
    expect(after!.status).not.toBe(targetStatus);

    const logs = await withTenant(orgAId, (tx) => tx.activityLog.findMany({ where: { action } }));
    expect(logs).toHaveLength(0);
  });

  it("actor labeling: user actor sets actor_user_id (label null); system actor sets actor_label (user null)", async () => {
    const membership = await anyMembership();
    const userAction = "test.transition.actor.user";
    const systemAction = "test.transition.actor.system";

    await withTenant(orgAId, (tx) =>
      transition(tx, {
        organizationId: orgAId,
        subjectType: "membership",
        subjectId: membership.id,
        action: userAction,
        actorUserId: membership.userId,
        mutate: (t) =>
          t.membership.update({ where: { id: membership.id }, data: { status: "active" } }),
      }),
    );

    await withTenant(orgAId, (tx) =>
      transition(tx, {
        organizationId: orgAId,
        subjectType: "membership",
        subjectId: membership.id,
        action: systemAction,
        actorLabel: "system:test",
        mutate: (t) =>
          t.membership.update({ where: { id: membership.id }, data: { status: "active" } }),
      }),
    );

    const [userLog, systemLog] = await withTenant(orgAId, async (tx) => [
      await tx.activityLog.findFirst({ where: { action: userAction } }),
      await tx.activityLog.findFirst({ where: { action: systemAction } }),
    ]);

    expect(userLog!.actorUserId).toBe(membership.userId);
    expect(userLog!.actorLabel).toBeNull();
    expect(systemLog!.actorUserId).toBeNull();
    expect(systemLog!.actorLabel).toBe("system:test");
  });

  it("throws when neither actor is set", async () => {
    const membership = await anyMembership();
    await expect(
      withTenant(orgAId, (tx) =>
        transition(tx, {
          organizationId: orgAId,
          subjectType: "membership",
          subjectId: membership.id,
          action: "test.transition.noactor",
          mutate: (t) => Promise.resolve(t),
        }),
      ),
    ).rejects.toThrow(/exactly one of actorUserId/);
  });

  it("throws when both actors are set", async () => {
    const membership = await anyMembership();
    await expect(
      withTenant(orgAId, (tx) =>
        transition(tx, {
          organizationId: orgAId,
          subjectType: "membership",
          subjectId: membership.id,
          action: "test.transition.bothactors",
          actorUserId: membership.userId,
          actorLabel: "system:test",
          mutate: (t) => Promise.resolve(t),
        }),
      ),
    ).rejects.toThrow(/exactly one of actorUserId/);
  });

  it("rejects a blank/whitespace system actorLabel (no completion attributed to empty text)", async () => {
    const membership = await anyMembership();
    const action = "test.transition.blanklabel";
    await expect(
      withTenant(orgAId, (tx) =>
        transition(tx, {
          organizationId: orgAId,
          subjectType: "membership",
          subjectId: membership.id,
          action,
          actorLabel: "   ", // blank -> not a valid system actor
          mutate: (t) =>
            t.membership.update({ where: { id: membership.id }, data: { status: "active" } }),
        }),
      ),
    ).rejects.toThrow(/exactly one of actorUserId/);

    const logs = await withTenant(orgAId, (tx) => tx.activityLog.findMany({ where: { action } }));
    expect(logs).toHaveLength(0); // no row committed under a blank actor
  });

  it("logActivity enforces the actor invariant at the write boundary too", async () => {
    const membership = await anyMembership();
    await expect(
      withTenant(orgAId, (tx) =>
        logActivity(tx, {
          organizationId: orgAId,
          subjectType: "membership",
          subjectId: membership.id,
          action: "test.logactivity.noactor",
        }),
      ),
    ).rejects.toThrow(/exactly one of actorUserId/);
  });
});
