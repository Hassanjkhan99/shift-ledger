import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import {
  hashPin,
  verifyPinHash,
  setStaffPin,
  verifyActorPin,
  listPickUsers,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
} from "../src/lib/staff-pin";

// #69 — shared-tablet PIN mechanism (D8): hash/verify unit behavior, set + verify integration,
// lockout after N failures with an activity_log entry, pick-user list scoping, and RLS + secrecy
// (org B cannot read org A's staff_pins; the stored value is a scrypt hash, never the raw PIN).
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Create a fresh user + active membership in `orgId` (optionally property-scoped). */
async function makeMember(
  orgId: string,
  opts: { propertyScope?: string[]; role?: string; name?: string } = {},
): Promise<{ userId: string }> {
  return withTenant(orgId, async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `pin-${randomUUID()}@example.com`,
        name: opts.name ?? "Kitchen Staff",
        emailVerified: true,
      },
      select: { id: true },
    });
    await tx.membership.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- role is an OrgRole enum; test uses a string literal
        role: (opts.role ?? "Staff") as any,
        propertyScope: opts.propertyScope ?? [],
      },
    });
    return { userId: user.id };
  });
}

/** The seeded property + outlet for an org (seed creates exactly one of each). */
async function seededOutlet(orgId: string): Promise<{ outletId: string; propertyId: string }> {
  return withTenant(orgId, async (tx) => {
    const outlet = await tx.outlet.findFirstOrThrow({
      where: { deletedAt: null },
      select: { id: true, propertyId: true },
    });
    return { outletId: outlet.id, propertyId: outlet.propertyId };
  });
}

// ---- hash / verify unit ---------------------------------------------------------
describe("hashPin / verifyPinHash (unit)", () => {
  it("hash is not the raw pin and differs across calls (random salt), verify matches", () => {
    const h1 = hashPin("1234");
    const h2 = hashPin("1234");
    expect(h1).not.toContain("1234");
    expect(h1).not.toBe(h2); // random salt per call
    expect(h1).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(verifyPinHash("1234", h1)).toBe(true);
    expect(verifyPinHash("1234", h2)).toBe(true);
  });

  it("verify is false for a wrong pin", () => {
    const h = hashPin("1234");
    expect(verifyPinHash("0000", h)).toBe(false);
    expect(verifyPinHash("4321", h)).toBe(false);
  });

  it("verify returns false (no throw) for a malformed encoded value or non-4-digit pin", () => {
    const h = hashPin("1234");
    expect(verifyPinHash("12", h)).toBe(false);
    expect(verifyPinHash("12345", h)).toBe(false);
    expect(verifyPinHash("abcd", h)).toBe(false);
    expect(verifyPinHash("1234", "garbage")).toBe(false);
    expect(verifyPinHash("1234", "bcrypt$aa$bb")).toBe(false);
  });

  it("hashPin rejects a non-4-digit pin", () => {
    expect(() => hashPin("123")).toThrow();
    expect(() => hashPin("12345")).toThrow();
    expect(() => hashPin("abcd")).toThrow();
    expect(() => hashPin("")).toThrow();
  });
});

// ---- set + verify (integration) -------------------------------------------------
describe("setStaffPin + verifyActorPin (integration)", () => {
  it("correct pin returns { ok, actorUserId }; wrong pin rejected + increments failed_attempts", async () => {
    const { userId } = await makeMember(orgAId);
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "4821" }),
    );

    const good = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "4821", now: new Date() }),
    );
    expect(good).toEqual({ ok: true, actorUserId: userId });

    const bad = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now: new Date() }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("wrong_pin");

    const row = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(row.failedAttempts).toBe(1);
  });

  it("rejects a correct pin with no_membership when the membership was soft-deleted (not counted as a wrong attempt)", async () => {
    const { userId } = await makeMember(orgAId);
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "3141" }),
    );
    // Soft-delete the membership AFTER the PIN was issued.
    await withTenant(orgAId, (tx) =>
      tx.membership.updateMany({ where: { userId }, data: { deletedAt: new Date() } }),
    );

    const res = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "3141", now: new Date() }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_membership");

    // A correct-pin-but-no-membership rejection is NOT a bad guess -> failure counter untouched.
    const row = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(row.failedAttempts).toBe(0);
  });

  it("rejects a correct pin held by a read-only role (Auditor) as not_completion_capable (not a wrong attempt)", async () => {
    // An Auditor who somehow has a PIN (e.g. issued before a role change) must not verify ok — the
    // §7.1 occurrence-complete matrix excludes read-only roles, so a completion caller cannot
    // attribute a completion to them.
    const { userId } = await makeMember(orgAId, { role: "Auditor" });
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "8080" }),
    );

    const res = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "8080", now: new Date() }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_completion_capable");

    // Not a bad guess -> failure counter untouched.
    const row = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(row.failedAttempts).toBe(0);
  });

  it("verifyActorPin returns no_pin when the member has no PIN set", async () => {
    const { userId } = await makeMember(orgAId);
    const res = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "1111", now: new Date() }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_pin");
  });

  it("setStaffPin can reset an existing PIN and clears the failure counter", async () => {
    const { userId } = await makeMember(orgAId);
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "1111" }),
    );
    await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "9999", now: new Date() }),
    );
    // Reset to a new pin.
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "2222" }),
    );
    const row = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(row.failedAttempts).toBe(0);
    const ok = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "2222", now: new Date() }),
    );
    expect(ok.ok).toBe(true);
  });
});

// ---- lockout --------------------------------------------------------------------
describe("lockout after repeated failures", () => {
  it("N wrong attempts lock out; the correct pin is still rejected while locked; one audit row; unlocks after expiry", async () => {
    const { userId } = await makeMember(orgAId);
    const now = new Date("2026-07-03T10:00:00Z");
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "5555" }),
    );

    // MAX_FAILED_ATTEMPTS consecutive wrong attempts -> the last one locks out.
    let last;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      last = await withTenant(orgAId, (tx) =>
        verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now }),
      );
    }
    expect(last!.ok).toBe(false);
    if (!last!.ok) expect(last!.reason).toBe("locked_out");

    // Correct pin is STILL rejected while locked_until > now.
    const whileLocked = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "5555", now }),
    );
    expect(whileLocked.ok).toBe(false);
    if (!whileLocked.ok) expect(whileLocked.reason).toBe("locked_out");

    // Exactly one actor.pin_lockout audit row was written for this user.
    const lockoutLogs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({
        where: { subjectId: userId, action: "actor.pin_lockout" },
      }),
    );
    expect(lockoutLogs).toHaveLength(1);
    expect(lockoutLogs[0].subjectType).toBe("user");
    expect(lockoutLogs[0].actorLabel).toBe("system:pin-lockout");
    // Non-PII: the raw pin must never appear in the audit payload.
    expect(JSON.stringify(lockoutLogs[0].afterJson)).not.toContain("5555");

    // After locked_until passes, the correct pin succeeds and resets the counter.
    const later = new Date(now.getTime() + (LOCKOUT_MINUTES + 1) * 60_000);
    const unlocked = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "5555", now: later }),
    );
    expect(unlocked).toEqual({ ok: true, actorUserId: userId });

    const row = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(row.failedAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("writes exactly one lockout audit row even when verification is attempted again after the lock", async () => {
    const { userId } = await makeMember(orgAId);
    const now = new Date("2026-07-05T08:00:00Z");
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "7777" }),
    );

    // Cross the threshold.
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await withTenant(orgAId, (tx) =>
        verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now }),
      );
    }

    const locked = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    const firstLockedUntil = locked.lockedUntil;

    // Further attempts while locked (both wrong and correct pin) hit the early locked-out return
    // BEFORE the increment, so no second audit row is written and locked_until is not overwritten.
    for (let i = 0; i < 3; i++) {
      await withTenant(orgAId, (tx) =>
        verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now }),
      );
      await withTenant(orgAId, (tx) =>
        verifyActorPin(tx, { organizationId: orgAId, userId, pin: "7777", now }),
      );
    }

    const lockoutLogs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({ where: { subjectId: userId, action: "actor.pin_lockout" } }),
    );
    expect(lockoutLogs).toHaveLength(1);

    const stillLocked = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(stillLocked.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(stillLocked.lockedUntil?.getTime()).toBe(firstLockedUntil?.getTime());
  });

  it("re-lock after expiry: an expired lock starts a fresh window; a wrong attempt is treated fresh and re-locks after MAX, writing a SECOND audit row; a correct pin resets", async () => {
    // Regression for the security bug where, after a lockout EXPIRES, failedAttempts stayed at MAX so
    // the `=== MAX` crossing never matched again and the account was never re-locked (unlimited
    // guessing after waiting out one lockout).
    const { userId } = await makeMember(orgAId);
    const t0 = new Date("2026-07-06T10:00:00Z");
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "5555" }),
    );

    // (a) MAX wrong attempts lock out and write exactly one lockout audit row.
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await withTenant(orgAId, (tx) =>
        verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now: t0 }),
      );
    }
    let logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({ where: { subjectId: userId, action: "actor.pin_lockout" } }),
    );
    expect(logs).toHaveLength(1);

    // (b) After the lock expires, a WRONG attempt is treated FRESH: failedAttempts becomes 1 (not 6)
    //     and the account is NOT immediately re-locked.
    const afterExpiry = new Date(t0.getTime() + (LOCKOUT_MINUTES + 1) * 60_000);
    const firstFresh = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now: afterExpiry }),
    );
    expect(firstFresh.ok).toBe(false);
    if (!firstFresh.ok) expect(firstFresh.reason).toBe("wrong_pin");
    const row = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(row.failedAttempts).toBe(1);
    expect(row.lockedUntil).toBeNull();

    // (c) MAX-1 more fresh wrong attempts (total MAX after expiry) RE-LOCK and write a SECOND audit row.
    let last;
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      last = await withTenant(orgAId, (tx) =>
        verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now: afterExpiry }),
      );
    }
    expect(last!.ok).toBe(false);
    if (!last!.ok) expect(last!.reason).toBe("locked_out");
    logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({ where: { subjectId: userId, action: "actor.pin_lockout" } }),
    );
    expect(logs).toHaveLength(2);
  });

  it("correct pin after an expired lock succeeds and resets the counter (no re-lock)", async () => {
    const { userId } = await makeMember(orgAId);
    const t0 = new Date("2026-07-06T12:00:00Z");
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "4242" }),
    );

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await withTenant(orgAId, (tx) =>
        verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now: t0 }),
      );
    }

    // After expiry, the CORRECT pin succeeds and resets the counter + clears the (stale) lock.
    const afterExpiry = new Date(t0.getTime() + (LOCKOUT_MINUTES + 1) * 60_000);
    const ok = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "4242", now: afterExpiry }),
    );
    expect(ok).toEqual({ ok: true, actorUserId: userId });

    const row = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(row.failedAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("counter regression: each wrong attempt increments by exactly one and locks out at exactly MAX", async () => {
    const { userId } = await makeMember(orgAId);
    const now = new Date("2026-07-04T09:00:00Z");
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: "6060" }),
    );

    // Attempts 1..MAX-1: still wrong_pin, counter climbs 1,2,...,MAX-1 (never skipped or stuck).
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      const res = await withTenant(orgAId, (tx) =>
        verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now }),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("wrong_pin");
      const row = await withTenant(orgAId, (tx) =>
        tx.staffPin.findUniqueOrThrow({
          where: { organizationId_userId: { organizationId: orgAId, userId } },
        }),
      );
      expect(row.failedAttempts).toBe(i);
      expect(row.lockedUntil).toBeNull();
    }

    // The MAX-th wrong attempt crosses the threshold and locks out.
    const atMax = await withTenant(orgAId, (tx) =>
      verifyActorPin(tx, { organizationId: orgAId, userId, pin: "0000", now }),
    );
    expect(atMax.ok).toBe(false);
    if (!atMax.ok) expect(atMax.reason).toBe("locked_out");
    const locked = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
      }),
    );
    expect(locked.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(locked.lockedUntil).not.toBeNull();
  });
});

// ---- pick-user list scoping -----------------------------------------------------
describe("listPickUsers (§8.8 scoping)", () => {
  it("lists whole-org + this-property members; excludes a different-property member; only active/non-deleted", async () => {
    const { outletId, propertyId } = await seededOutlet(orgAId);
    const otherPropertyId = randomUUID(); // a property id the outlet does NOT belong to

    const wholeOrg = await makeMember(orgAId, { propertyScope: [], name: "WholeOrg" });
    const thisProperty = await makeMember(orgAId, {
      propertyScope: [propertyId],
      name: "ThisProperty",
    });
    const otherProperty = await makeMember(orgAId, {
      propertyScope: [otherPropertyId],
      name: "OtherProperty",
    });

    // An inactive member scoped to this property must NOT be listed.
    const inactive = await makeMember(orgAId, { propertyScope: [propertyId], name: "Inactive" });
    await withTenant(orgAId, (tx) =>
      tx.membership.updateMany({
        where: { userId: inactive.userId },
        data: { status: "inactive" },
      }),
    );
    // A soft-deleted member scoped to this property must NOT be listed.
    const deleted = await makeMember(orgAId, { propertyScope: [propertyId], name: "Deleted" });
    await withTenant(orgAId, (tx) =>
      tx.membership.updateMany({
        where: { userId: deleted.userId },
        data: { deletedAt: new Date() },
      }),
    );

    const picked = await withTenant(orgAId, (tx) => listPickUsers(tx, { outletId }));
    const ids = picked.map((p) => p.userId);

    expect(ids).toContain(wholeOrg.userId);
    expect(ids).toContain(thisProperty.userId);
    expect(ids).not.toContain(otherProperty.userId);
    expect(ids).not.toContain(inactive.userId);
    expect(ids).not.toContain(deleted.userId);
  });

  it("excludes read-only roles (Auditor) but includes completion-capable roles (Staff/KitchenManager)", async () => {
    const { outletId, propertyId } = await seededOutlet(orgAId);

    const staff = await makeMember(orgAId, {
      propertyScope: [propertyId],
      role: "Staff",
      name: "PickStaff",
    });
    const manager = await makeMember(orgAId, {
      propertyScope: [propertyId],
      role: "KitchenManager",
      name: "PickManager",
    });
    // An active Auditor scoped to this outlet's property must NOT be pickable (read-only role).
    const auditor = await makeMember(orgAId, {
      propertyScope: [propertyId],
      role: "Auditor",
      name: "PickAuditor",
    });

    const picked = await withTenant(orgAId, (tx) => listPickUsers(tx, { outletId }));
    const ids = picked.map((p) => p.userId);

    expect(ids).toContain(staff.userId);
    expect(ids).toContain(manager.userId);
    expect(ids).not.toContain(auditor.userId);
  });

  it("a soft-deleted outlet yields no pick users (fail closed)", async () => {
    const { propertyId } = await seededOutlet(orgAId);
    // A pickable member exists for the property.
    await makeMember(orgAId, { propertyScope: [propertyId], role: "Staff", name: "WouldPick" });

    // Create then soft-delete a dedicated outlet under the same property.
    const outletId = await withTenant(orgAId, async (tx) => {
      const o = await tx.outlet.create({
        data: { organizationId: orgAId, propertyId, name: `decom-${randomUUID()}` },
        select: { id: true },
      });
      await tx.outlet.update({ where: { id: o.id }, data: { deletedAt: new Date() } });
      return o.id;
    });

    const picked = await withTenant(orgAId, (tx) => listPickUsers(tx, { outletId }));
    expect(picked).toEqual([]);
  });

  it("an OrgAdmin with a non-empty property_scope excluding the outlet's property still appears", async () => {
    const { outletId } = await seededOutlet(orgAId);
    const otherPropertyId = randomUUID(); // a property the outlet does NOT belong to

    // Org-wide role but carrying a stale scope that would otherwise exclude this outlet.
    const orgAdmin = await makeMember(orgAId, {
      propertyScope: [otherPropertyId],
      role: "OrgAdmin",
      name: "OrgWideAdmin",
    });

    const picked = await withTenant(orgAId, (tx) => listPickUsers(tx, { outletId }));
    const ids = picked.map((p) => p.userId);
    expect(ids).toContain(orgAdmin.userId);
  });
});

// ---- RLS + secrecy --------------------------------------------------------------
describe("RLS cross-tenant isolation + no-plaintext secrecy", () => {
  it("org B cannot read org A's staff_pins; stored value is a scrypt hash, never the raw pin", async () => {
    const { userId } = await makeMember(orgAId);
    const rawPin = "7913";
    await withTenant(orgAId, (tx) =>
      setStaffPin(tx, { organizationId: orgAId, userId, pin: rawPin }),
    );

    // Org B sees zero of org A's staff_pins.
    const seenFromB = await withTenant(orgBId, (tx) =>
      tx.staffPin.count({ where: { organizationId: orgAId } }),
    );
    expect(seenFromB).toBe(0);

    // No tenant context => default-deny (zero rows).
    const { prisma } = await import("../src/lib/db");
    expect(await prisma.staffPin.count()).toBe(0);

    // The stored pin_hash is a scrypt hash, not the plaintext pin.
    const row = await withTenant(orgAId, (tx) =>
      tx.staffPin.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: orgAId, userId } },
        select: { pinHash: true },
      }),
    );
    expect(row.pinHash).not.toContain(rawPin);
    expect(row.pinHash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(verifyPinHash(rawPin, row.pinHash)).toBe(true);
  });
});
