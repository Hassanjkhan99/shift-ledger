// F4 domain wiring (#10) — the who-may-trigger role matrix (D7, §7.1/§7.2/§7.3).
//
// This is the POLICY layer only. It declares, per state machine and per edge, the set of OrgRoles
// permitted to trigger that transition (transcribed from the "Who can trigger" columns of the
// §7.1/§7.2/§7.3 tables). It does NOT itself perform any transition.
//
// ENFORCEMENT POINT: the completion / skip / cancel / remediation Server Actions (M4 #17 and
// friends) call assertRoleMayTrigger(machine, edge, sessionRole) with the AUTHENTICATED session's
// org role BEFORE routing the change through transition() (src/lib/transition.ts). This ticket (#10)
// delivers and tests the matrix + the reason/deviation rules + the codebase-wide F4 assertion; it
// deliberately does not build the action layer that consumes it.
//
// SYSTEM / INNGEST / CASCADE transitions have NO triggering role — they act under an `actorLabel`
// (e.g. system:generator, system:overdue-sweep, system:cascade, system:repeated-deviation) rather
// than a user role, and are therefore EXEMPT from the role guard. The §7.1/§7.2/§7.3 rows whose
// "Who can trigger" is "—" (pure system edges) simply have no entry in these matrices.
//
// "(scoped)" in the design tables is a property/outlet-scope concern enforced by the tenant/property
// guard layer, not by this role matrix; here we encode the ROLE dimension only.

import { OrgRole } from "../generated/prisma/enums";

/** The three domain state machines whose user edges carry a role guard. */
export type Machine = "occurrence" | "exception" | "correctiveAction";

// ---- Occurrence user edges (§7.1) -----------------------------------------------
// System edges ((none)→pending, pending→due, due→overdue) are actorLabel-driven → not listed.
export const OCCURRENCE_ROLE_MATRIX = {
  // due → completed / overdue → completed_late / due|overdue → failed all share the completion roles.
  complete: [
    OrgRole.KitchenManager,
    OrgRole.ShiftLeader,
    OrgRole.Staff,
    OrgRole.PropertyManager,
    OrgRole.Owner,
    OrgRole.OrgAdmin,
  ],
  completeLate: [
    OrgRole.KitchenManager,
    OrgRole.ShiftLeader,
    OrgRole.Staff,
    OrgRole.PropertyManager,
    OrgRole.Owner,
    OrgRole.OrgAdmin,
  ],
  fail: [
    OrgRole.KitchenManager,
    OrgRole.ShiftLeader,
    OrgRole.Staff,
    OrgRole.PropertyManager,
    OrgRole.Owner,
    OrgRole.OrgAdmin,
  ],
  // pending|due → cancelled and pending|due|overdue → skipped: managers only.
  cancel: [OrgRole.PropertyManager, OrgRole.KitchenManager, OrgRole.Owner, OrgRole.OrgAdmin],
  skip: [OrgRole.PropertyManager, OrgRole.KitchenManager, OrgRole.Owner, OrgRole.OrgAdmin], // keyset-guard-allow: `skip` is the §7.1 edge name, not SQL OFFSET/Prisma skip (F5)
} as const satisfies Record<string, readonly OrgRole[]>;

// ---- Exception user edges (§7.2) ------------------------------------------------
// The acknowledged→in_progress and in_progress→resolved cascades run as system:cascade → exempt.
export const EXCEPTION_ROLE_MATRIX = {
  // open→acknowledged and reopened→acknowledged: triage roles.
  acknowledge: [
    OrgRole.ShiftLeader,
    OrgRole.KitchenManager,
    OrgRole.PropertyManager,
    OrgRole.Owner,
    OrgRole.OrgAdmin,
  ],
  // acknowledged→in_progress (manual, non-cascade): managers.
  startProgress: [OrgRole.KitchenManager, OrgRole.PropertyManager, OrgRole.Owner, OrgRole.OrgAdmin],
  // in_progress→resolved (manual, non-cascade): managers.
  resolve: [OrgRole.KitchenManager, OrgRole.PropertyManager, OrgRole.Owner, OrgRole.OrgAdmin],
  // resolved→verified: managers.
  verify: [OrgRole.PropertyManager, OrgRole.KitchenManager, OrgRole.Owner, OrgRole.OrgAdmin],
  // resolved→reopened and verified→reopened: managers.
  reopen: [OrgRole.PropertyManager, OrgRole.KitchenManager, OrgRole.Owner, OrgRole.OrgAdmin],
} as const satisfies Record<string, readonly OrgRole[]>;

// ---- CorrectiveAction user edges (§7.3) -----------------------------------------
export const CORRECTIVE_ROLE_MATRIX = {
  // (none)→open: created under an exception.
  create: [
    OrgRole.ShiftLeader,
    OrgRole.KitchenManager,
    OrgRole.PropertyManager,
    OrgRole.Owner,
    OrgRole.OrgAdmin,
  ],
  // open→assigned and rejected→assigned: managers.
  assign: [OrgRole.KitchenManager, OrgRole.PropertyManager, OrgRole.Owner, OrgRole.OrgAdmin],
  // assigned→done: managers only by ROLE alone. §7.3 also lets the ASSIGNED frontline actor
  // (a Staff/ShiftLeader) mark their OWN corrective action done — but that is an ASSIGNEE
  // exception that needs the row's assignee_user_id/assignee_role, which this role-only guard
  // does not have. It is therefore enforced at the action layer with row context (M4 #17), NOT
  // here. Listing Staff/ShiftLeader in this role-only matrix would let ANY frontline user mark
  // ANY CA done, so they are deliberately omitted.
  markDone: [OrgRole.KitchenManager, OrgRole.PropertyManager, OrgRole.Owner, OrgRole.OrgAdmin],
  // done→verified: managers.
  verify: [OrgRole.PropertyManager, OrgRole.KitchenManager, OrgRole.Owner, OrgRole.OrgAdmin],
  // done→rejected: managers.
  reject: [OrgRole.PropertyManager, OrgRole.KitchenManager, OrgRole.Owner, OrgRole.OrgAdmin],
} as const satisfies Record<string, readonly OrgRole[]>;

/** The full matrix keyed by machine, exported so the policy is testable as data. */
export const ROLE_MATRIX = {
  occurrence: OCCURRENCE_ROLE_MATRIX,
  exception: EXCEPTION_ROLE_MATRIX,
  correctiveAction: CORRECTIVE_ROLE_MATRIX,
} as const;

/** A legal edge name for a given machine (the keys of that machine's matrix). */
export type EdgeOf<M extends Machine> = keyof (typeof ROLE_MATRIX)[M];

/**
 * Throw unless `role` is permitted to trigger `edge` on `machine`. The action layer (#17) calls this
 * with the authenticated session's OrgRole before invoking the corresponding transition() service.
 * System/cascade edges are not represented here (they use actorLabel) and are never routed through
 * this guard.
 */
export function assertRoleMayTrigger<M extends Machine>(
  machine: M,
  edge: EdgeOf<M>,
  role: OrgRole,
): void {
  const machineMatrix = ROLE_MATRIX[machine] as Record<string, readonly OrgRole[]>;
  const allowed = machineMatrix[edge as string];
  if (!allowed) {
    throw new Error(`permissions: unknown edge '${String(edge)}' for machine '${machine}'`);
  }
  if (!allowed.includes(role)) {
    throw new Error(
      `permissions: role '${role}' may not trigger '${machine}.${String(edge)}' ` +
        `(allowed: ${allowed.join(", ")})`,
    );
  }
}

/** Non-throwing predicate form of assertRoleMayTrigger (for UI affordance checks). */
export function roleMayTrigger<M extends Machine>(
  machine: M,
  edge: EdgeOf<M>,
  role: OrgRole,
): boolean {
  const machineMatrix = ROLE_MATRIX[machine] as Record<string, readonly OrgRole[]>;
  const allowed = machineMatrix[edge as string];
  return allowed !== undefined && allowed.includes(role);
}

// ---- Evidence write authorization (#114) ----------------------------------------
// Auditor + ExternalInspector are READ-ONLY (D7): they may view evidence/exports but not create it.
// Every other org role may write evidence. Enforced by POST /api/uploads + /api/uploads/finalize.
const EVIDENCE_WRITE_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>([
  OrgRole.Owner,
  OrgRole.OrgAdmin,
  OrgRole.PropertyManager,
  OrgRole.KitchenManager,
  OrgRole.ShiftLeader,
  OrgRole.Staff,
]);

/** True if `role` may create/write evidence (upload + finalize). Read-only roles get 403. */
export function canWriteEvidence(role: OrgRole): boolean {
  return EVIDENCE_WRITE_ROLES.has(role);
}

// ---- Org & sites management authorization (#133, D7) ----------------------------
// Organization + property management is org-wide administration: Owner / OrgAdmin only. Outlet
// management is delegated to the PropertyManager, but ONLY within their property scope (a membership's
// property_scope; empty = whole org). This is the role/scope dimension for the settings CRUD Server
// Actions — distinct from the ROLE_MATRIX above, which governs the occurrence/exception/CA state
// machines, not site administration.
const ORG_MANAGER_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>([OrgRole.Owner, OrgRole.OrgAdmin]);

/** True if `role` may create/edit/archive properties (and the organization). Owner/OrgAdmin only. */
export function canManageProperties(role: OrgRole): boolean {
  return ORG_MANAGER_ROLES.has(role);
}

/**
 * True if `role` may create/edit/archive outlets under the property `propertyId`. Owner/OrgAdmin may
 * manage any outlet; a PropertyManager may manage outlets only within their `propertyScope`
 * (an empty scope means the whole org). All other roles: no.
 */
export function canManageOutlets(
  role: OrgRole,
  propertyScope: readonly string[],
  propertyId: string,
): boolean {
  if (ORG_MANAGER_ROLES.has(role)) return true;
  if (role === OrgRole.PropertyManager) {
    return propertyScope.length === 0 || propertyScope.includes(propertyId);
  }
  return false;
}

// ---- Task templates authorship (#135, D7) ---------------------------------------
// A template is ORG-WIDE config (no property dimension) reused across every site's schedules, so a
// property-scoped manager editing/deactivating one would affect sites outside their scope (Codex #152).
// Since there is no scope to check, template authoring is restricted to the org-wide roles.
/** True if `role` may create/edit/deactivate task templates (org-wide config; Owner/OrgAdmin). */
export function canManageTemplates(role: OrgRole): boolean {
  return ORG_MANAGER_ROLES.has(role);
}

/** True if `role` may create/edit/deactivate scheduled tasks (D7, #136). Same author set as templates. */
export function canManageSchedules(role: OrgRole): boolean {
  return CONFIG_AUTHOR_ROLES.has(role);
}

// ---- Members & invitations authorization (#134, D7) -----------------------------
// Owner/OrgAdmin manage the whole roster; a PropertyManager may manage members within their scope.

/** True if `role` may reach the members screen + manage teammates at all. */
export function canManageMembers(role: OrgRole): boolean {
  return ORG_MANAGER_ROLES.has(role) || role === OrgRole.PropertyManager;
}

/**
 * True if an actor may create/edit a membership (or invitation) granting `targetRole` + `targetScope`.
 * Owner/OrgAdmin: anyone. PropertyManager: may NOT grant Owner/OrgAdmin/PropertyManager, and the target
 * scope must be non-empty AND a subset of the PM's own scope (a whole-org PM — empty scope — may grant
 * any non-admin scope). Everyone else: no.
 */
export function canAssignMembership(
  actorRole: OrgRole,
  actorScope: readonly string[],
  targetRole: OrgRole,
  targetScope: readonly string[],
): boolean {
  if (ORG_MANAGER_ROLES.has(actorRole)) return true;
  if (actorRole !== OrgRole.PropertyManager) return false;
  // A PM cannot mint admins or other managers.
  if (
    targetRole === OrgRole.Owner ||
    targetRole === OrgRole.OrgAdmin ||
    targetRole === OrgRole.PropertyManager
  ) {
    return false;
  }
  // The granted scope must be concrete and contained within the PM's own scope.
  if (targetScope.length === 0) return false;
  if (actorScope.length === 0) return true; // whole-org PM
  return targetScope.every((p) => actorScope.includes(p));
}
