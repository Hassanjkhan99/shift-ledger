import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { buildCompletionInsert } from "../src/lib/completions";
import {
  openException,
  acknowledgeException,
  createCorrectiveAction,
  assignCorrectiveAction,
} from "../src/lib/exceptions";
import { OrgRole } from "../src/generated/prisma/enums";

// #95 — assignee/actor tenant-membership. Each assignee/actor user id on a tenant row must belong to
// the SAME org. Two layers enforce this:
//   (1) DB composite FK (organization_id, <actor_col>) -> memberships(organization_id, user_id):
//       rejects a NON-MEMBER / cross-tenant user id at the constraint level (existence of an in-org
//       membership), independent of RLS.
//   (2) App layer (assignCorrectiveAction): rejects an INACTIVE / soft-deleted member — a filtered
//       predicate an FK cannot express (the membership row exists but is not active).
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Build a property→outlet→template→scheduled_task→occurrence chain in `orgId` (fresh per call). */
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

/** Create a fresh user + membership in `orgId`. Defaults to an active whole-org Staff member; pass
 *  `status`/`deletedAt` to build an inactive or soft-deleted member (the app-layer paths). */
async function makeMember(
  orgId: string,
  opts: { status?: string; deletedAt?: Date | null } = {},
): Promise<{ userId: string }> {
  return withTenant(orgId, async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `m95-${randomUUID()}@example.com`,
        name: "Member 95",
        emailVerified: true,
      },
      select: { id: true },
    });
    await tx.membership.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        role: OrgRole.Staff,
        propertyScope: [],
        status: opts.status ?? "active",
        deletedAt: opts.deletedAt ?? null,
      },
    });
    return { userId: user.id };
  });
}

/** An acknowledged exception + a fresh `open` corrective action under it, in `orgId`. Returns the
 *  CA id and an in-org active member (the actor). */
async function makeAssignableCA(
  orgId: string,
): Promise<{ caId: string; exceptionId: string; userId: string }> {
  const fx = await makeOccurrence(orgId);
  const exceptionId = await withTenant(orgId, async (tx) => {
    const ex = await openException(
      tx,
      {
        organizationId: orgId,
        propertyId: fx.propertyId,
        outletId: fx.outletId,
        taskOccurrenceId: fx.occurrenceId,
        title: "Fridge over 4C",
      },
      { actorUserId: fx.userId },
    );
    await acknowledgeException(tx, ex.id, { actorUserId: fx.userId });
    return ex.id;
  });
  const caId = await withTenant(orgId, async (tx) => {
    const ca = await createCorrectiveAction(
      tx,
      { exceptionId, description: "Recalibrate" },
      { actorUserId: fx.userId },
    );
    return ca.id;
  });
  return { caId, exceptionId, userId: fx.userId };
}

const DUE = new Date("2026-07-10T12:00:00Z");

// ---- DB composite FK: a non-member / cross-tenant actor id is rejected ----------
describe("#95 DB composite FK — actor must be an in-org member", () => {
  it("corrective_actions.assignee_user_id set to an org-B user (non-member of org A) is rejected", async () => {
    const { caId } = await makeAssignableCA(orgAId);
    // An org-B member's user id — a real user, but NOT a member of org A. A raw update bypasses the
    // app-layer active-member check to exercise the composite FK directly.
    const orgBUser = await withTenant(orgBId, (tx) =>
      tx.membership.findFirstOrThrow({ select: { userId: true } }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        tx.correctiveAction.update({
          where: { id: caId },
          data: { assigneeUserId: orgBUser.userId },
        }),
      ),
    ).rejects.toThrow();
  });

  it("corrective_actions.assignee_user_id set to a global user with NO membership anywhere is rejected", async () => {
    const { caId } = await makeAssignableCA(orgAId);
    const orphan = await withTenant(orgAId, (tx) =>
      tx.user.create({
        data: { email: `orphan-${randomUUID()}@example.com`, emailVerified: true },
        select: { id: true },
      }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        tx.correctiveAction.update({
          where: { id: caId },
          data: { assigneeUserId: orphan.id },
        }),
      ),
    ).rejects.toThrow();
  });

  it("task_completions.completed_by set to a non-member id is rejected", async () => {
    const fx = await makeOccurrence(orgAId);
    // A global user with no org-A membership.
    const orphan = await withTenant(orgAId, (tx) =>
      tx.user.create({
        data: { email: `orphan-${randomUUID()}@example.com`, emailVerified: true },
        select: { id: true },
      }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskCompletion.create({
          data: buildCompletionInsert({
            organizationId: orgAId,
            taskOccurrenceId: fx.occurrenceId,
            clientSubmissionId: randomUUID(),
            result: "pass",
            completedBy: orphan.id, // not an org-A member → composite FK rejects
          }),
        }),
      ),
    ).rejects.toThrow();
  });

  it("task_completions.completed_by set to an in-org active member still succeeds", async () => {
    const fx = await makeOccurrence(orgAId);
    const { userId } = await makeMember(orgAId);
    const row = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: fx.occurrenceId,
          clientSubmissionId: randomUUID(),
          result: "pass",
          completedBy: userId,
        }),
        select: { id: true },
      }),
    );
    expect(row.id).toBeTruthy();
  });
});

// ---- App layer: inactive / soft-deleted member rejected by assignCorrectiveAction ----
describe("#95 app layer — assignCorrectiveAction requires an ACTIVE member", () => {
  it("assigning to a valid active member succeeds (regression)", async () => {
    const { caId } = await makeAssignableCA(orgAId);
    const { userId } = await makeMember(orgAId);
    const assigned = await withTenant(orgAId, (tx) =>
      assignCorrectiveAction(
        tx,
        caId,
        { assigneeUserId: userId, dueAt: DUE },
        { actorUserId: userId },
      ),
    );
    expect(assigned.status).toBe("assigned");
    const row = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({
        where: { id: caId },
        select: { assigneeUserId: true },
      }),
    );
    expect(row.assigneeUserId).toBe(userId);
  });

  it("assigning to a soft-deleted member is rejected (FK sees the row, app layer sees deleted_at)", async () => {
    const { caId, userId: actor } = await makeAssignableCA(orgAId);
    // Membership row EXISTS (so the composite FK would resolve) but is soft-deleted — only the app
    // layer can catch this.
    const { userId } = await makeMember(orgAId, { deletedAt: new Date() });
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(
          tx,
          caId,
          { assigneeUserId: userId, dueAt: DUE },
          { actorUserId: actor },
        ),
      ),
    ).rejects.toThrow(/active member/i);
    // The failed attempt did not transition the CA.
    const row = await withTenant(orgAId, (tx) =>
      tx.correctiveAction.findUniqueOrThrow({ where: { id: caId }, select: { status: true } }),
    );
    expect(row.status).toBe("open");
  });

  it("assigning to an inactive member (status != 'active') is rejected", async () => {
    const { caId, userId: actor } = await makeAssignableCA(orgAId);
    const { userId } = await makeMember(orgAId, { status: "suspended" });
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(
          tx,
          caId,
          { assigneeUserId: userId, dueAt: DUE },
          { actorUserId: actor },
        ),
      ),
    ).rejects.toThrow(/active member/i);
  });

  it("assigning to an org-B user (non-member of org A) is rejected by the app layer before the FK", async () => {
    const { caId, userId: actor } = await makeAssignableCA(orgAId);
    const orgBUser = await withTenant(orgBId, (tx) =>
      tx.membership.findFirstOrThrow({ select: { userId: true } }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        assignCorrectiveAction(
          tx,
          caId,
          { assigneeUserId: orgBUser.userId, dueAt: DUE },
          { actorUserId: actor },
        ),
      ),
    ).rejects.toThrow(/active member/i);
  });
});
