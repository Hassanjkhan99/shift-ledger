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
import { OCCURRENCE_ROLE_MATRIX } from "./permissions";
import { OrgRole } from "../generated/prisma/enums";

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

/**
 * Roles that may complete an occurrence on a shared tablet — the §7.1 completion set (from the
 * occurrence role matrix). Read-only roles (Auditor, ExternalInspector) are NOT in this set, so a
 * correct PIN held by such a role fails verification, and they never appear in the pick list even if
 * a membership scopes them to the outlet's property.
 */
const COMPLETION_CAPABLE_ROLES = OCCURRENCE_ROLE_MATRIX.complete;

/** Org-wide completion roles: allowed on ANY outlet regardless of property_scope. */
const ORG_WIDE_ROLES = [OrgRole.Owner, OrgRole.OrgAdmin] as const;

// ---- Result types ---------------------------------------------------------------

/**
 * Discriminated failure reasons so callers/tests can distinguish the paths.
 * `not_completion_capable`: a correct PIN whose only active membership carries a read-only role
 * (Auditor/ExternalInspector) that the §7.1 occurrence-complete matrix excludes — attributing a
 * completion to it would be illegal, so verification fails closed. Like `no_membership`, this is
 * NOT a bad guess and does not touch the failure counter.
 */
export type VerifyFailureReason =
  "no_pin" | "locked_out" | "wrong_pin" | "no_membership" | "not_completion_capable";

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
 *   - correct pin, but no active/non-deleted membership -> { ok: false, reason: 'no_membership' }
 *                              (NOT counted as a wrong-PIN attempt — it is not a bad guess)
 *   - correct pin           -> reset failed_attempts=0 / locked_until=null, { ok: true, actorUserId }
 *   - wrong pin             -> atomically increment failed_attempts; on the RESULTING value reaching
 *                              MAX_FAILED_ATTEMPTS set locked_until = now + LOCKOUT_MINUTES and write
 *                              an `actor.pin_lockout` activity_log entry (non-PII).
 *                              { ok: false, reason: 'wrong_pin' | 'locked_out' }
 *
 * The failure counter is incremented with an atomic DB `{ increment: 1 }` and the lockout decision is
 * derived from the RETURNED value, so concurrent wrong guesses cannot each persist failed_attempts=1
 * and skip the lockout — the threshold can only be crossed once, by the request that increments to it.
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
    // The PIN is correct, but the actor must still have an active, non-deleted membership in this
    // org — otherwise a stale shared-tablet completion could be attributed to a deactivated/removed
    // member. It must ALSO carry a completion-capable role: a read-only role (Auditor/
    // ExternalInspector) that once had a PIN would otherwise verify `ok` and let a caller attribute
    // a completion to a role the §7.1 matrix excludes. Fail closed with a distinct reason.
    // Neither branch is a bad guess, so neither touches the failure counter.
    const membership = await tx.membership.findFirst({
      where: { organizationId, userId, status: "active", deletedAt: null },
      select: { role: true },
    });
    if (!membership) return { ok: false, reason: "no_membership" };
    if (!(COMPLETION_CAPABLE_ROLES as readonly string[]).includes(membership.role)) {
      return { ok: false, reason: "not_completion_capable" };
    }

    await tx.staffPin.update({
      where: { id: row.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    return { ok: true, actorUserId: userId };
  }

  // Wrong pin: increment the failure counter ATOMICALLY and derive the lockout decision from the
  // returned value, so concurrent wrong guesses cannot each write failed_attempts=1 and dodge the
  // lockout (the threshold is crossed exactly once — by the request that increments to it).
  const updated = await tx.staffPin.update({
    where: { id: row.id },
    data: { failedAttempts: { increment: 1 } },
    select: { failedAttempts: true },
  });
  // Lock + audit on the EXACT threshold-crossing request only (=== not >=). Under a concurrent
  // 4→5 / 4→6 race two requests could both read failedAttempts=4 and increment; the one that lands
  // on 5 crosses the threshold and writes the single lockout row, while the one that lands on 6 must
  // NOT write a second `actor.pin_lockout` row nor overwrite locked_until. (A value > MAX cannot
  // occur once locked because the early locked-out return precedes the increment; the `===` guard
  // makes the single-audit invariant hold even under that race.)
  const shouldLock = updated.failedAttempts === MAX_FAILED_ATTEMPTS;

  if (shouldLock) {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
    await tx.staffPin.update({
      where: { id: row.id },
      data: { lockedUntil },
    });
    // Audit the lockout — non-PII payload only (no pin, no hash).
    await logActivity(tx, {
      organizationId,
      subjectType: "user",
      subjectId: userId,
      action: "actor.pin_lockout",
      actorLabel: "system:pin-lockout",
      afterJson: {
        failedAttempts: updated.failedAttempts,
        lockedUntil: lockedUntil.toISOString(),
        lockoutMinutes: LOCKOUT_MINUTES,
      },
    });
    return { ok: false, reason: "locked_out", lockedUntil };
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
 * The scope+role predicate for a pickable membership at `propertyId`. Active + non-deleted +
 * completion-capable, AND (org-wide role OR the property-scope covers this property). Org-wide roles
 * (Owner/OrgAdmin) complete org-wide, so they bypass the scope predicate even if a stale non-empty
 * property_scope would otherwise exclude them. A membership covers the property if its property_scope
 * is NULL or EMPTY (whole-org) OR contains the property id.
 *
 * NULL scope: the `memberships.property_scope` column is a Postgres array WITHOUT a NOT NULL
 * constraint (see the init migration), so a NULL is possible even though Prisma defaults inserts to
 * `[]`. Prisma's `isEmpty`/`has` array filters do NOT match NULL, so NULL is handled explicitly.
 */
function pickEligibleWhere(propertyId: string) {
  return {
    status: "active",
    deletedAt: null,
    role: { in: [...COMPLETION_CAPABLE_ROLES] },
    OR: [
      { role: { in: [...ORG_WIDE_ROLES] } },
      { propertyScope: { equals: null } },
      { propertyScope: { isEmpty: true } },
      { propertyScope: { has: propertyId } },
    ],
  };
}

/**
 * The on-device pick-user list: active, non-deleted, completion-capable memberships whose scope
 * covers the tablet's outlet (see pickEligibleWhere). Resolves the outlet's property first, then
 * queries memberships. All through the tenant `tx` (RLS), so it is implicitly org-scoped.
 *
 * FAIL CLOSED on a decommissioned outlet: the outlet lookup requires `deletedAt: null` AND a
 * non-deleted parent property. A soft-deleted outlet (or one under a soft-deleted property) is
 * treated as "excluded" — it yields an empty pick list rather than throwing, matching occurrence
 * generation's excluded-site semantics, so a decommissioned outlet never returns pickable users.
 */
export async function listPickUsers(
  tx: TenantClient,
  args: { outletId: string },
): Promise<PickUser[]> {
  const outlet = await tx.outlet.findFirst({
    where: { id: args.outletId, deletedAt: null, property: { deletedAt: null } },
    select: { propertyId: true },
  });
  if (!outlet) return [];

  const memberships = await tx.membership.findMany({
    where: pickEligibleWhere(outlet.propertyId),
    select: { userId: true, role: true, user: { select: { name: true } } },
  });

  return memberships.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role }));
}
