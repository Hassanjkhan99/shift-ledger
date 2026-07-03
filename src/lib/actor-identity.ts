// Shared-tablet actor identity + correction-version permission guards (#11; D8, D7, §8.14/§6.2/§6.3).
//
// Two attributability guards live here:
//
//  1. D8 — shared-tablet actor identity (§8.14). A task completion must always resolve to a concrete
//     `completed_by` actor plus an `actor_confirmation_method` in ('session','pin','initials'), so
//     "who did it" is non-repudiable even on a wall-mounted tablet under a shared session.
//     resolveCompletionActor() turns a raw completion input into that concrete actor.
//
//  2. D7 — correction-version permission + scope (§6.2/§6.3). assertMayCreateCorrection() is the guard
//     the correction path calls before writing a new immutable completion version.
//
// DEFERRED (M4 #17): the physical version-WRITE — insert v(n+1), set supersedes_id, flip the prior
// row's is_current, with a mandatory edit_reason + activity_log before/after — is an UPDATE on
// task_completions, which the #53 append-only trigger rejects. §8.14 routes it through a SECURITY
// DEFINER versioning writer that needs a superuser-owned function (not creatable in an app_user
// migration), so it lands with the completion Server Action in M4 #17. THIS ticket delivers only the
// GUARDS #17 calls; it does not perform the write and does not touch the append-only trigger.

import { OrgRole } from "../generated/prisma/enums";
import type { TenantClient } from "./db";
import { verifyActorPin, type VerifyFailureReason } from "./staff-pin";

// ---- Actor confirmation method domain (mirrors the DB CHECK) --------------------

/** The allowed shared-tablet actor-identity methods (D8, §8.14). Mirrors the migration CHECK. */
export const ACTOR_CONFIRMATION_METHODS = ["session", "pin", "initials"] as const;
export type ActorConfirmationMethod = (typeof ACTOR_CONFIRMATION_METHODS)[number];

/**
 * Throw unless `m` is one of the three allowed methods. This mirrors
 * task_completions_actor_confirmation_method_check at the app boundary so a bad value is rejected
 * before it ever reaches the DB (and narrows the type for callers).
 */
export function assertValidConfirmationMethod(m: string): asserts m is ActorConfirmationMethod {
  if (!(ACTOR_CONFIRMATION_METHODS as readonly string[]).includes(m)) {
    throw new Error(
      `actor-identity: invalid actor_confirmation_method '${m}' ` +
        `(allowed: ${ACTOR_CONFIRMATION_METHODS.join(", ")})`,
    );
  }
}

// ---- resolveCompletionActor (D8) ------------------------------------------------

/** Typed initials must be 2–4 letters — enough to attribute, no binary attachment needed (D4). */
const INITIALS_RE = /^[A-Za-z]{2,4}$/;

/** Discriminated input to resolveCompletionActor, one shape per method. */
export type ResolveCompletionActorInput =
  | { method: "session"; sessionUserId: string }
  | { method: "pin"; organizationId: string; pickedUserId: string; pin: string; now: Date }
  | { method: "initials"; pickedUserId: string; initials: string };

/** Why a pin-based actor resolution failed (surfaced instead of throwing on the expected paths). */
export class ActorPinError extends Error {
  constructor(public readonly reason: VerifyFailureReason) {
    super(`actor-identity: pin actor confirmation failed (${reason})`);
    this.name = "ActorPinError";
  }
}

/**
 * Resolve the concrete `completed_by` actor + method for a completion so shared-tablet completions
 * are non-repudiable.
 *
 *  - `session`  — personal device / ambient session: the actor is the session owner.
 *  - `pin`      — shared tablet: the picked user, confirmed via verifyActorPin (staff-pin.ts, #69).
 *                 A verification failure (no_pin/locked_out/wrong_pin) throws ActorPinError(reason).
 *  - `initials` — shared tablet: the picked user, confirmed by typed initials (2–4 letters).
 *
 * Takes a tenant `tx` (from withTenant) so the PIN lookup inherits the RLS context.
 */
export async function resolveCompletionActor(
  tx: TenantClient,
  input: ResolveCompletionActorInput,
): Promise<{ actorUserId: string; method: ActorConfirmationMethod }> {
  assertValidConfirmationMethod(input.method);

  switch (input.method) {
    case "session":
      return { actorUserId: input.sessionUserId, method: "session" };

    case "pin": {
      const result = await verifyActorPin(tx, {
        organizationId: input.organizationId,
        userId: input.pickedUserId,
        pin: input.pin,
        now: input.now,
      });
      if (!result.ok) {
        throw new ActorPinError(result.reason);
      }
      return { actorUserId: result.actorUserId, method: "pin" };
    }

    case "initials": {
      if (!INITIALS_RE.test(input.initials)) {
        throw new Error("actor-identity: initials must be 2–4 letters");
      }
      return { actorUserId: input.pickedUserId, method: "initials" };
    }
  }
}

// ---- assertMayCreateCorrection (D7, §6.2/§6.3) ----------------------------------

/** The org roles that may create a correction version regardless of property scope (org-wide). */
const ORG_WIDE_CORRECTION_ROLES: readonly OrgRole[] = [OrgRole.Owner, OrgRole.OrgAdmin];

/** The property-scoped roles that may correct only within their scope. */
const SCOPED_CORRECTION_ROLES: readonly OrgRole[] = [
  OrgRole.PropertyManager,
  OrgRole.KitchenManager,
];

export interface CorrectionActor {
  role: OrgRole;
  /** Empty = whole-org scope; else limited to these property ids (Membership.propertyScope). */
  propertyScope: string[];
}

export interface CorrectionTarget {
  /** The property the target completion belongs to. */
  propertyId: string;
}

/**
 * Non-throwing D7 predicate: may `actor` create a correction version for `target`?
 *
 *  - Owner / OrgAdmin: always (org-wide).
 *  - PropertyManager / KitchenManager: only if propertyScope is empty (whole-org) OR contains the
 *    target property (§6.3 — property scope layered on org scope).
 *  - Everyone else (ShiftLeader, Staff, Auditor, ExternalInspector): never.
 */
export function mayCreateCorrection(actor: CorrectionActor, target: CorrectionTarget): boolean {
  if (ORG_WIDE_CORRECTION_ROLES.includes(actor.role)) {
    return true;
  }
  if (SCOPED_CORRECTION_ROLES.includes(actor.role)) {
    return actor.propertyScope.length === 0 || actor.propertyScope.includes(target.propertyId);
  }
  return false;
}

/**
 * Throw unless `actor` may create a correction version for `target` (D7 permission + property scope,
 * §6.2/§6.3). Returns void on allow. This is the guard the M4 #17 versioning writer calls before it
 * performs the (deferred) version-WRITE.
 */
export function assertMayCreateCorrection(actor: CorrectionActor, target: CorrectionTarget): void {
  if (!mayCreateCorrection(actor, target)) {
    throw new Error(
      `actor-identity: role '${actor.role}' may not create a correction version for property ` +
        `'${target.propertyId}' (allowed: Owner, OrgAdmin, or PropertyManager/KitchenManager in scope)`,
    );
  }
}
