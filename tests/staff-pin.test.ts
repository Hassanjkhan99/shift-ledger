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
    const outlet = await tx.outlet.findFirstOrThrow({ select: { id: true, propertyId: true } });
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
