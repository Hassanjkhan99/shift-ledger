// Shared-tablet PIN mechanism (#69; D8, §8.8/§8.14).
//
// On shared kitchen tablets every task completion must be attributable to a real person, so a
// 4-digit PIN is a per-ACTION actor confirmation (not a session login — that is #39-#41). This
// module owns PIN issuance, secure storage, constant-time verification with lockout, and the
// on-device pick-user list. Every DB access takes a tenant `tx` (from withTenant) so it inherits
// the transaction-local RLS context (organization_id, D6).
//
// HASHING — why scrypt (node:crypto), not argon2id/bcrypt:
//   The AC lists argon2id/bcrypt only as EXAMPLES of "stored as a hash, never plaintext". Both of
//   those are native-addon dependencies (node-gyp / prebuilt binaries) that complicate CI and the
//   Vercel build. scrypt is a vetted, memory-hard KDF shipped in Node's standard library
//   (`node:crypto`) — zero new dependencies, RFC 7914, and it satisfies the real requirement:
//   the secret is stored only as a salted hash and compared in constant time (crypto.timingSafeEqual).
//   The stored value is self-describing (`scrypt$<saltHex>$<hashHex>`) so params can evolve later.
//
// The raw PIN is NEVER logged, never returned, never stored — only its hash. The lockout audit
// entry (activity_log) carries only non-PII counters, never the PIN.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { TenantClient } from "./db";
import { logActivity } from "./transition";

// ---- Named constants ------------------------------------------------------------
export const PIN_LENGTH = 4;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

// scrypt parameters (RFC 7914). N=16384 (2^14) is the interactive-login default; a 4-digit PIN has
// tiny entropy so the KDF cost + lockout is the real defence, not the hash alone.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16;
const SCRYPT_PREFIX = "scrypt";

const PIN_RE = /^\d{4}$/;

// ---- Result types ---------------------------------------------------------------

/** Discriminated failure reasons so callers/tests can distinguish the paths. */
export type VerifyFailureReason = "no_pin" | "locked_out" | "wrong_pin";

export type VerifyActorPinResult =
  | { ok: true; actorUserId: string }
  | { ok: false; reason: VerifyFailureReason; lockedUntil?: Date };

// ---- Hashing primitives (pure, no DB) -------------------------------------------

/**
 * Hash a 4-digit PIN with a fresh random salt. Returns `scrypt$<saltHex>$<hashHex>`.
 * Throws if `pin` is not exactly 4 digits. NEVER logs the raw pin.
 */
export function hashPin(pin: string): string {
  if (!PIN_RE.test(pin)) {
    throw new Error(`PIN must be exactly ${PIN_LENGTH} digits`);
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `${SCRYPT_PREFIX}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Constant-time verification. Re-derives the hash from `pin` using the stored salt and compares
 * with crypto.timingSafeEqual. Returns false on ANY parse/format/length mismatch (no throw-based
 * timing leak) so a malformed pin and a wrong pin cost the same.
 */
export function verifyPinHash(pin: string, encoded: string): boolean {
  if (!PIN_RE.test(pin)) return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== SCRYPT_PREFIX) return false;
  const [, saltHex, hashHex] = parts;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(pin, salt, expected.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// ---- Issuance -------------------------------------------------------------------

/**
 * Set (create) or reset (update) a member's PIN. Hashes the pin and upserts the staff_pins row,
 * resetting failed_attempts=0, locked_until=null, pin_set_at=now.
 *
 * NOTE: WHO may set/reset a PIN (D7 — PropertyManager/KitchenManager scoped, OrgAdmin/Owner, or a
 * member changing their own) is the caller / Server-Action layer's responsibility; this primitive
 * does not enforce role scoping.
 */
export async function setStaffPin(
  tx: TenantClient,
  args: { organizationId: string; userId: string; pin: string },
): Promise<void> {
  const pinHash = hashPin(args.pin);
  await tx.staffPin.upsert({
    where: { organizationId_userId: { organizationId: args.organizationId, userId: args.userId } },
    create: {
      organizationId: args.organizationId,
      userId: args.userId,
      pinHash,
    },
    update: {
      pinHash,
      pinSetAt: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
}

// ---- Verification + lockout -----------------------------------------------------

/**
 * Verify an actor's PIN at completion time. Accepts `now: Date` for deterministic tests.
 *
 * Behavior:
 *   - No PIN row            -> { ok: false, reason: 'no_pin' }
 *   - locked_until > now    -> { ok: false, reason: 'locked_out', lockedUntil }
 *   - correct pin           -> reset failed_attempts=0 / locked_until=null, { ok: true, actorUserId }
 *   - wrong pin             -> increment failed_attempts; on reaching MAX_FAILED_ATTEMPTS set
 *                              locked_until = now + LOCKOUT_MINUTES and write an
 *                              `actor.pin_lockout` activity_log entry (non-PII). { ok: false, reason: 'wrong_pin' | 'locked_out' }
 */
export async function verifyActorPin(
  tx: TenantClient,
  args: { organizationId: string; userId: string; pin: string; now: Date },
): Promise<VerifyActorPinResult> {
  const { organizationId, userId, pin, now } = args;

  const row = await tx.staffPin.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!row) return { ok: false, reason: "no_pin" };

  if (row.lockedUntil && row.lockedUntil > now) {
    return { ok: false, reason: "locked_out", lockedUntil: row.lockedUntil };
  }

  if (verifyPinHash(pin, row.pinHash)) {
    await tx.staffPin.update({
      where: { id: row.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    return { ok: true, actorUserId: userId };
  }

  // Wrong pin: increment the failure counter and lock out on the threshold.
  const failedAttempts = row.failedAttempts + 1;
  const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = shouldLock ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : null;

  await tx.staffPin.update({
    where: { id: row.id },
    data: { failedAttempts, lockedUntil },
  });

  if (shouldLock) {
    // Audit the lockout — non-PII payload only (no pin, no hash).
    await logActivity(tx, {
      organizationId,
      subjectType: "user",
      subjectId: userId,
      action: "actor.pin_lockout",
      actorLabel: "system:pin-lockout",
      afterJson: {
        failedAttempts,
        lockedUntil: lockedUntil!.toISOString(),
        lockoutMinutes: LOCKOUT_MINUTES,
      },
    });
    return { ok: false, reason: "locked_out", lockedUntil: lockedUntil! };
  }

  return { ok: false, reason: "wrong_pin" };
}

// ---- Pick-user list -------------------------------------------------------------

export interface PickUser {
  userId: string;
  name: string | null;
  role: string;
}

/**
 * The on-device pick-user list: active, non-deleted memberships whose scope covers the tablet's
 * outlet. A membership covers the outlet if its property_scope is EMPTY (whole-org) OR contains the
 * outlet's property_id. Resolves the outlet's property first, then queries memberships. All through
 * the tenant `tx` (RLS), so it is implicitly org-scoped.
 */
export async function listPickUsers(
  tx: TenantClient,
  args: { outletId: string },
): Promise<PickUser[]> {
  const outlet = await tx.outlet.findUniqueOrThrow({
    where: { id: args.outletId },
    select: { propertyId: true },
  });

  const memberships = await tx.membership.findMany({
    where: {
      status: "active",
      deletedAt: null,
      OR: [{ propertyScope: { isEmpty: true } }, { propertyScope: { has: outlet.propertyId } }],
    },
    select: { userId: true, role: true, user: { select: { name: true } } },
  });

  return memberships.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role }));
}
