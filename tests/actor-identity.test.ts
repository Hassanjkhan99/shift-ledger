import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { setStaffPin } from "../src/lib/staff-pin";
import { buildCompletionInsert } from "../src/lib/completions";
import { OrgRole } from "../src/generated/prisma/enums";
import {
  ACTOR_CONFIRMATION_METHODS,
  assertValidConfirmationMethod,
  resolveCompletionActor,
  ActorPinError,
  IneligiblePickUserError,
  mayCreateCorrection,
  assertMayCreateCorrection,
  type CorrectionActor,
} from "../src/lib/actor-identity";

// #11 — shared-tablet actor identity (D8) + correction-version permission guard (D7). Mostly pure
// (method-domain validation + role/scope guard) with a DB-backed path for `pin` resolution (reuses
// the #69 staff-pin fixture) and the DB CHECK constraint.
const orgAId = inject("orgAId");

afterAll(async () => {
  await disconnect();
});

/**
 * Create a fresh user + active membership in `orgId` (to hang a PIN off). Defaults to a whole-org
 * Staff member (eligible to be picked); pass `role`/`propertyScope` to exercise the eligibility gate.
 */
async function makeMember(
  orgId: string,
  opts: { role?: OrgRole; propertyScope?: string[] } = {},
): Promise<{ userId: string }> {
  return withTenant(orgId, async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `actor-${randomUUID()}@example.com`,
        name: "Kitchen Staff",
        emailVerified: true,
      },
      select: { id: true },
    });
    await tx.membership.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        role: opts.role ?? OrgRole.Staff,
        propertyScope: opts.propertyScope ?? [],
      },
    });
    return { userId: user.id };
  });
}

/** A LIVE (non-deleted) seeded outlet + its property for an org. Must filter deletedAt: other test
 *  files soft-delete outlets in the shared org, and isEligiblePickUser fails closed on a deleted
 *  outlet — without the filter findFirstOrThrow could hand back a tombstoned outlet and the eligible
 *  picked-user happy paths would wrongly be rejected. */
async function seededOutlet(orgId: string): Promise<{ outletId: string; propertyId: string }> {
  return withTenant(orgId, async (tx) => {
    const outlet = await tx.outlet.findFirstOrThrow({
      where: { deletedAt: null, property: { deletedAt: null } },
      select: { id: true, propertyId: true },
    });
    return { outletId: outlet.id, propertyId: outlet.propertyId };
  });
}

/** A template → scheduled_task → occurrence chain in `orgId` (for the CHECK-constraint test). */
async function makeOccurrence(orgId: string): Promise<{ occurrenceId: string; userId: string }> {
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
        occurrenceLocalDate: new Date(Date.UTC(2026, 6, 3)),
        dueAt: new Date("2026-07-03T04:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
      },
      select: { id: true },
    });
    return { occurrenceId: occ.id, userId: membership.userId };
  });
}

// ---- assertValidConfirmationMethod (unit) ---------------------------------------
describe("assertValidConfirmationMethod", () => {
  it("accepts the three allowed methods", () => {
    for (const m of ACTOR_CONFIRMATION_METHODS) {
      expect(() => assertValidConfirmationMethod(m)).not.toThrow();
    }
  });

  it("rejects anything else", () => {
    for (const m of ["bogus", "SESSION", "", "otp", "password"]) {
      expect(() => assertValidConfirmationMethod(m)).toThrow(/invalid actor_confirmation_method/);
    }
  });
});

// ---- resolveCompletionActor -----------------------------------------------------
describe("resolveCompletionActor", () => {
  it("session: returns the session user + method 'session'", async () => {
    const sessionUserId = randomUUID();
    const res = await withTenant(orgAId, (tx) =>
      resolveCompletionActor(tx, { method: "session", sessionUserId }),
    );
    expect(res).toEqual({ actorUserId: sessionUserId, method: "session" });
  });

  it("pin: a correct PIN + eligible picked user returns the picked user + method 'pin'", async () => {
    const { outletId } = await seededOutlet(orgAId);
    const { userId } = await makeMember(orgAId);
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "4821" }),
    );
    const res = await withTenant(orgAId, (tx) =>
      resolveCompletionActor(tx, {
        method: "pin",
        organizationId: orgAId,
        outletId,
        pickedUserId: userId,
        pin: "4821",
        now: new Date(),
      }),
    );
    expect(res).toEqual({ actorUserId: userId, method: "pin" });
  });

  it("pin: a wrong PIN surfaces the failure as ActorPinError(wrong_pin)", async () => {
    const { outletId } = await seededOutlet(orgAId);
    const { userId } = await makeMember(orgAId);
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "1234" }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        resolveCompletionActor(tx, {
          method: "pin",
          organizationId: orgAId,
          outletId,
          pickedUserId: userId,
          pin: "0000",
          now: new Date(),
        }),
      ),
    ).rejects.toMatchObject({ name: "ActorPinError", reason: "wrong_pin" });
  });

  it("pin: a member with no PIN surfaces ActorPinError(no_pin)", async () => {
    const { outletId } = await seededOutlet(orgAId);
    const { userId } = await makeMember(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        resolveCompletionActor(tx, {
          method: "pin",
          organizationId: orgAId,
          outletId,
          pickedUserId: userId,
          pin: "1111",
          now: new Date(),
        }),
      ),
    ).rejects.toBeInstanceOf(ActorPinError);
  });

  it("pin: a correct PIN but a picked user NOT in the outlet's scope is rejected (IneligiblePickUserError)", async () => {
    const { outletId } = await seededOutlet(orgAId);
    // Member scoped to a DIFFERENT property — verifyActorPin passes (active membership) but the
    // outlet-scope layer must reject.
    const { userId } = await makeMember(orgAId, { propertyScope: [randomUUID()] });
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "7777" }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        resolveCompletionActor(tx, {
          method: "pin",
          organizationId: orgAId,
          outletId,
          pickedUserId: userId,
          pin: "7777",
          now: new Date(),
        }),
      ),
    ).rejects.toBeInstanceOf(IneligiblePickUserError);
  });

  it("pin: an ineligible picked user is rejected BEFORE any PIN attempt is recorded (no lockout griefing)", async () => {
    const { outletId } = await seededOutlet(orgAId);
    // Out-of-scope member with a PIN set; a WRONG pin is supplied. Eligibility is checked first, so
    // the PIN verifier never runs and no failed attempt is recorded against the user.
    const { userId } = await makeMember(orgAId, { propertyScope: [randomUUID()] });
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "1234" }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        resolveCompletionActor(tx, {
          method: "pin",
          organizationId: orgAId,
          outletId,
          pickedUserId: userId,
          pin: "0000", // wrong — but eligibility should reject before this is checked
          now: new Date(),
        }),
      ),
    ).rejects.toBeInstanceOf(IneligiblePickUserError);

    const pin = await withTenant(orgAId, (tx) =>
      tx.staffPin.findFirst({ where: { userId }, select: { failedAttempts: true } }),
    );
    expect(pin?.failedAttempts).toBe(0); // the PIN verifier never ran
  });

  it("initials: non-empty initials + an eligible picked user return the picked user + method 'initials'", async () => {
    const { outletId } = await seededOutlet(orgAId);
    const { userId } = await makeMember(orgAId);
    const res = await withTenant(orgAId, (tx) =>
      resolveCompletionActor(tx, {
        method: "initials",
        outletId,
        pickedUserId: userId,
        initials: "AB",
      }),
    );
    expect(res).toEqual({ actorUserId: userId, method: "initials" });
  });

  it("initials: empty/invalid initials are rejected", async () => {
    const { outletId } = await seededOutlet(orgAId);
    const pickedUserId = randomUUID();
    for (const initials of ["", "A", "ABCDE", "12", "A1"]) {
      await expect(
        withTenant(orgAId, (tx) =>
          resolveCompletionActor(tx, { method: "initials", outletId, pickedUserId, initials }),
        ),
      ).rejects.toThrow(/initials/);
    }
  });

  it("initials: a well-formed-initials but non-member picked user id is rejected (IneligiblePickUserError)", async () => {
    const { outletId } = await seededOutlet(orgAId);
    // A random global user id with no membership at all — format-valid initials must not attribute.
    await expect(
      withTenant(orgAId, (tx) =>
        resolveCompletionActor(tx, {
          method: "initials",
          outletId,
          pickedUserId: randomUUID(),
          initials: "AB",
        }),
      ),
    ).rejects.toBeInstanceOf(IneligiblePickUserError);
  });

  it("initials: an Auditor (read-only role) picked user is rejected (IneligiblePickUserError)", async () => {
    const { outletId } = await seededOutlet(orgAId);
    const { userId } = await makeMember(orgAId, { role: OrgRole.Auditor });
    await expect(
      withTenant(orgAId, (tx) =>
        resolveCompletionActor(tx, {
          method: "initials",
          outletId,
          pickedUserId: userId,
          initials: "AB",
        }),
      ),
    ).rejects.toBeInstanceOf(IneligiblePickUserError);
  });
});

// ---- assertMayCreateCorrection / mayCreateCorrection (D7 role + scope) -----------
describe("assertMayCreateCorrection / mayCreateCorrection", () => {
  const targetProperty = randomUUID();
  const otherProperty = randomUUID();
  const target = { propertyId: targetProperty };

  const permit = (actor: CorrectionActor) => {
    expect(mayCreateCorrection(actor, target)).toBe(true);
    expect(() => assertMayCreateCorrection(actor, target)).not.toThrow();
  };
  const deny = (actor: CorrectionActor) => {
    expect(mayCreateCorrection(actor, target)).toBe(false);
    expect(() => assertMayCreateCorrection(actor, target)).toThrow(
      /may not create a correction version/,
    );
  };

  it("permits Owner and OrgAdmin for any property (org-wide)", () => {
    permit({ role: OrgRole.Owner, propertyScope: [] });
    permit({ role: OrgRole.Owner, propertyScope: [otherProperty] });
    permit({ role: OrgRole.OrgAdmin, propertyScope: [] });
    permit({ role: OrgRole.OrgAdmin, propertyScope: [otherProperty] });
  });

  it("permits PropertyManager/KitchenManager with empty scope (whole-org) or matching property", () => {
    permit({ role: OrgRole.PropertyManager, propertyScope: [] });
    permit({ role: OrgRole.PropertyManager, propertyScope: [targetProperty] });
    permit({ role: OrgRole.KitchenManager, propertyScope: [] });
    permit({ role: OrgRole.KitchenManager, propertyScope: [targetProperty, otherProperty] });
  });

  it("treats a NULL property_scope as whole-org for scoped managers (nullable DB column)", () => {
    permit({ role: OrgRole.PropertyManager, propertyScope: null });
    permit({ role: OrgRole.KitchenManager, propertyScope: null });
  });

  it("denies PropertyManager/KitchenManager whose scope excludes the target property (§6.3)", () => {
    deny({ role: OrgRole.PropertyManager, propertyScope: [otherProperty] });
    deny({ role: OrgRole.KitchenManager, propertyScope: [otherProperty] });
  });

  it("denies ShiftLeader, Staff, Auditor, ExternalInspector regardless of scope", () => {
    for (const role of [
      OrgRole.ShiftLeader,
      OrgRole.Staff,
      OrgRole.Auditor,
      OrgRole.ExternalInspector,
    ]) {
      deny({ role, propertyScope: [] });
      deny({ role, propertyScope: [targetProperty] });
    }
  });
});

// ---- DB CHECK constraint --------------------------------------------------------
describe("task_completions actor_confirmation_method CHECK (DB)", () => {
  it("rejects an out-of-domain actor_confirmation_method", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskCompletion.create({
          data: buildCompletionInsert({
            organizationId: orgAId,
            taskOccurrenceId: occurrenceId,
            clientSubmissionId: randomUUID(),
            result: "pass",
            completedBy: userId,
            actorConfirmationMethod: "bogus",
          }),
        }),
      ),
    ).rejects.toThrow();
  });
});
