// Exception + CorrectiveAction state machines (#9; D2 §7.2/§7.3).
//
// SCOPE: this module delivers the FULL D2 state machines for the two remediation entities and the
// auto-cascades that couple them. Every status change routes through the F4 choke point
// transition() (src/lib/transition.ts), so it is structurally impossible to move an entity's status
// without writing a matching activity_log row in the SAME transaction.
//
// Each edge function VALIDATES that the current row status is a legal `from` for the requested edge
// and throws a clear error otherwise — legal-edge enforcement IS the machine. Explicitly OUT OF
// SCOPE (deferred to #10): role-based who-may-trigger guards, the mandatory-reason policy, and the
// repeated-deviation rule. This ticket enforces the graph of legal transitions only.
//
// TENANCY: every function takes a `tx: TenantClient` (from withTenant), so it inherits the
// transaction-local RLS context (organization_id). Cascades issue their transition() calls in the
// SAME tx as the triggering change, so the CA change and the parent-exception advance are atomic
// and both audited.
//
// ACTORS: user-driven edges take `actorUserId`; the auto-cascades use actorLabel 'system:cascade'.

import { ExceptionStatus, CorrectiveStatus } from "../generated/prisma/enums";
import type { OrgRole } from "../generated/prisma/enums";
import type { TenantClient } from "./db";
import { transition } from "./transition";

/** Identifies the actor of an edge: exactly one of actorUserId / actorLabel (see transition()). */
export interface Actor {
  actorUserId?: string;
  actorLabel?: string;
  /** Free-text reason. The mandatory-reason policy is #10; this ticket only threads it through. */
  reason?: string;
}

// ---- Legal-edge tables (§7.2/§7.3) ----------------------------------------------
// The set of legal `from` statuses for each edge, enforced by assertFrom() before any write.

const EXCEPTION_FROM = {
  acknowledge: [ExceptionStatus.open, ExceptionStatus.reopened],
  startProgress: [ExceptionStatus.acknowledged],
  resolve: [ExceptionStatus.in_progress],
  verify: [ExceptionStatus.resolved],
  reopen: [ExceptionStatus.resolved, ExceptionStatus.verified],
} as const;

const CORRECTIVE_FROM = {
  assign: [CorrectiveStatus.open, CorrectiveStatus.rejected],
  markDone: [CorrectiveStatus.assigned],
  verify: [CorrectiveStatus.done],
  reject: [CorrectiveStatus.done],
} as const;

/** Throw a clear error if `current` is not a legal `from` for `edge`. */
function assertFrom<S extends string>(
  entity: string,
  edge: string,
  current: S,
  legalFrom: readonly S[],
): void {
  if (!legalFrom.includes(current)) {
    throw new Error(
      `${entity}: illegal transition '${edge}' from status '${current}' (legal from: ${legalFrom.join(", ")})`,
    );
  }
}

// =================================================================================
// Exception machine (§7.2)
// =================================================================================

export interface OpenExceptionInput {
  organizationId: string;
  propertyId: string;
  outletId: string;
  taskOccurrenceId: string;
  /** The failing completion version, if the exception is raised from a completion. */
  taskCompletionId?: string;
  title: string;
  detail?: string;
  /** normal/critical (e.g. cold-chain breach). Defaults to the DB default 'normal'. */
  severity?: string;
}

/**
 * (none) → open. Creates a new exception row in `open` and logs the `(none)→open` edge via
 * transition() (F4). The subject id is not known until the INSERT returns, so we thread it out of
 * mutate() into the transition opts object BEFORE transition() reads it for the audit row.
 */
export async function openException(
  tx: TenantClient,
  input: OpenExceptionInput,
  actor: Actor,
): Promise<{ id: string; status: ExceptionStatus }> {
  const opts = {
    organizationId: input.organizationId,
    subjectType: "exception" as const,
    subjectId: "", // filled in by mutate() before transition() logs
    action: "exception.opened",
    actorUserId: actor.actorUserId,
    actorLabel: actor.actorLabel,
    after: { status: ExceptionStatus.open },
    reason: actor.reason,
    mutate: async (t: TenantClient) => {
      const row = await t.exception.create({
        data: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          outletId: input.outletId,
          taskOccurrenceId: input.taskOccurrenceId,
          taskCompletionId: input.taskCompletionId ?? null,
          title: input.title,
          detail: input.detail ?? null,
          severity: input.severity ?? undefined,
          status: ExceptionStatus.open,
          openedBy: actor.actorUserId ?? null,
        },
        select: { id: true, status: true },
      });
      opts.subjectId = row.id;
      return row;
    },
  };
  return transition(tx, opts);
}

/**
 * Generic exception status edge: assert the current status is legal, then flip it through
 * transition(). Used by every user-driven exception edge and by the cascades.
 */
async function exceptionEdge(
  tx: TenantClient,
  exceptionId: string,
  edge: keyof typeof EXCEPTION_FROM,
  to: ExceptionStatus,
  action: string,
  actor: Actor,
  extraData: Record<string, unknown> = {},
): Promise<{ id: string; status: ExceptionStatus }> {
  const current = await tx.exception.findUniqueOrThrow({
    where: { id: exceptionId },
    select: { status: true, organizationId: true },
  });
  assertFrom("exception", edge, current.status, EXCEPTION_FROM[edge]);
  const expectedFrom = current.status;

  return transition(tx, {
    organizationId: current.organizationId,
    subjectType: "exception",
    subjectId: exceptionId,
    action,
    actorUserId: actor.actorUserId,
    actorLabel: actor.actorLabel,
    before: { status: current.status },
    after: { status: to },
    reason: actor.reason,
    // Compare-and-set: only flip if the row is still in the status we read (expectedFrom). A
    // concurrent legal edge from the same state loses the race — count !== 1 — and we THROW so the
    // whole transition rolls back (no status change, no audit row). Unlike the sweep's silent
    // no-op, a user-driven edge that loses the race must fail loudly.
    mutate: async (t) => {
      const res = await t.exception.updateMany({
        where: { id: exceptionId, status: expectedFrom },
        data: { status: to, ...extraData },
      });
      if (res.count !== 1) {
        throw new Error(
          `exception: concurrent modification — '${edge}' expected status '${expectedFrom}' but the row changed underneath`,
        );
      }
      return { id: exceptionId, status: to };
    },
  });
}

/** open → acknowledged AND reopened → acknowledged. */
export function acknowledgeException(tx: TenantClient, exceptionId: string, actor: Actor) {
  return exceptionEdge(
    tx,
    exceptionId,
    "acknowledge",
    ExceptionStatus.acknowledged,
    "exception.acknowledged",
    actor,
  );
}

/** acknowledged → in_progress. */
export function startExceptionProgress(tx: TenantClient, exceptionId: string, actor: Actor) {
  return exceptionEdge(
    tx,
    exceptionId,
    "startProgress",
    ExceptionStatus.in_progress,
    "exception.started",
    actor,
  );
}

/** in_progress → resolved (sets resolved_at). */
export function resolveException(tx: TenantClient, exceptionId: string, actor: Actor) {
  return exceptionEdge(
    tx,
    exceptionId,
    "resolve",
    ExceptionStatus.resolved,
    "exception.resolved",
    actor,
    { resolvedAt: new Date() },
  );
}

/** resolved → verified. */
export function verifyException(tx: TenantClient, exceptionId: string, actor: Actor) {
  return exceptionEdge(
    tx,
    exceptionId,
    "verify",
    ExceptionStatus.verified,
    "exception.verified",
    actor,
  );
}

/**
 * resolved → reopened AND verified → reopened. Clears resolved_at: a reopened exception is active
 * again, so a stale resolved_at would misrepresent it as still resolved. The prior value survives
 * in the audit log's before_json.
 */
export function reopenException(tx: TenantClient, exceptionId: string, actor: Actor) {
  return exceptionEdge(
    tx,
    exceptionId,
    "reopen",
    ExceptionStatus.reopened,
    "exception.reopened",
    actor,
    { resolvedAt: null },
  );
}

// =================================================================================
// CorrectiveAction machine (§7.3) + cascades (§7.2)
// =================================================================================

export interface CreateCorrectiveActionInput {
  exceptionId: string;
  description: string;
}

/**
 * (none) → open. Creates a corrective action under an exception (inherits the exception's org),
 * logging the `(none)→open` edge via transition() (F4). The subject id is threaded out of mutate().
 */
export async function createCorrectiveAction(
  tx: TenantClient,
  input: CreateCorrectiveActionInput,
  actor: Actor,
): Promise<{ id: string; status: CorrectiveStatus }> {
  const parent = await tx.exception.findUniqueOrThrow({
    where: { id: input.exceptionId },
    select: { organizationId: true },
  });
  const opts = {
    organizationId: parent.organizationId,
    subjectType: "correctiveAction" as const,
    subjectId: "", // filled in by mutate() before transition() logs
    action: "corrective.created",
    actorUserId: actor.actorUserId,
    actorLabel: actor.actorLabel,
    after: { status: CorrectiveStatus.open },
    reason: actor.reason,
    mutate: async (t: TenantClient) => {
      const row = await t.correctiveAction.create({
        data: {
          organizationId: parent.organizationId,
          exceptionId: input.exceptionId,
          description: input.description,
          status: CorrectiveStatus.open,
        },
        select: { id: true, status: true },
      });
      opts.subjectId = row.id;
      return row;
    },
  };
  return transition(tx, opts);
}

/**
 * Generic corrective-action status edge: assert the current status is legal, then flip it through
 * transition(). Returns the updated row plus its parent exception id (for cascades).
 */
async function correctiveEdge(
  tx: TenantClient,
  correctiveActionId: string,
  edge: keyof typeof CORRECTIVE_FROM,
  to: CorrectiveStatus,
  action: string,
  actor: Actor,
  extraData: Record<string, unknown> = {},
): Promise<{ id: string; status: CorrectiveStatus; exceptionId: string; organizationId: string }> {
  const current = await tx.correctiveAction.findUniqueOrThrow({
    where: { id: correctiveActionId },
    select: { status: true, exceptionId: true, organizationId: true },
  });
  assertFrom("correctiveAction", edge, current.status, CORRECTIVE_FROM[edge]);
  const expectedFrom = current.status;

  const updated = await transition(tx, {
    organizationId: current.organizationId,
    subjectType: "correctiveAction",
    subjectId: correctiveActionId,
    action,
    actorUserId: actor.actorUserId,
    actorLabel: actor.actorLabel,
    before: { status: current.status },
    after: { status: to },
    reason: actor.reason,
    // Compare-and-set: only flip if the row is still in the status we read (expectedFrom). A
    // concurrent legal edge from the same state loses the race — count !== 1 — and we THROW so the
    // whole transition rolls back (no status change, no audit row). Unlike the sweep's silent
    // no-op, a user-driven edge that loses the race must fail loudly.
    mutate: async (t) => {
      const res = await t.correctiveAction.updateMany({
        where: { id: correctiveActionId, status: expectedFrom },
        data: { status: to, ...extraData },
      });
      if (res.count !== 1) {
        throw new Error(
          `correctiveAction: concurrent modification — '${edge}' expected status '${expectedFrom}' but the row changed underneath`,
        );
      }
      return { id: correctiveActionId, status: to };
    },
  });
  return { ...updated, exceptionId: current.exceptionId, organizationId: current.organizationId };
}

export interface AssignCorrectiveActionInput {
  assigneeUserId?: string;
  assigneeRole?: OrgRole;
  dueAt?: Date;
}

/**
 * open → assigned AND rejected → assigned. Sets assignee + due_at. If this moves the CA into
 * `assigned` while its parent exception is still `acknowledged`, cascade the exception
 * acknowledged → in_progress (§7.2) in the same tx (actorLabel 'system:cascade').
 */
export async function assignCorrectiveAction(
  tx: TenantClient,
  correctiveActionId: string,
  input: AssignCorrectiveActionInput,
  actor: Actor,
): Promise<{ id: string; status: CorrectiveStatus }> {
  // Exactly one assignee target: a CA must be assigned to a specific user XOR a role, never both
  // and never neither (an unassigned "assigned" CA has no owner). Checked before any write.
  const hasUser = input.assigneeUserId !== undefined && input.assigneeUserId !== null;
  const hasRole = input.assigneeRole !== undefined && input.assigneeRole !== null;
  if (hasUser === hasRole) {
    throw new Error(
      "assignCorrectiveAction: exactly one of assigneeUserId or assigneeRole must be provided",
    );
  }

  const result = await correctiveEdge(
    tx,
    correctiveActionId,
    "assign",
    CorrectiveStatus.assigned,
    "corrective.assigned",
    actor,
    {
      assigneeUserId: input.assigneeUserId ?? null,
      assigneeRole: input.assigneeRole ?? null,
      dueAt: input.dueAt ?? null,
      // Rework reassignment (rejected → assigned): clear the prior attempt's completion stamps so
      // the row doesn't look completed while it is merely `assigned` again.
      completedBy: null,
      completedAt: null,
    },
  );

  // Cascade: first CA activated on an acknowledged exception → in_progress.
  const parent = await tx.exception.findUniqueOrThrow({
    where: { id: result.exceptionId },
    select: { status: true },
  });
  if (parent.status === ExceptionStatus.acknowledged) {
    await exceptionEdge(
      tx,
      result.exceptionId,
      "startProgress",
      ExceptionStatus.in_progress,
      "exception.started",
      { actorLabel: "system:cascade" },
    );
  }

  return { id: result.id, status: result.status };
}

/**
 * assigned → done. Sets completed_by/at. If ALL non-deleted CAs on the parent exception are now
 * `done`, cascade the exception in_progress → resolved (§7.2) in the same tx ('system:cascade').
 */
export async function markCorrectiveActionDone(
  tx: TenantClient,
  correctiveActionId: string,
  actor: Actor,
): Promise<{ id: string; status: CorrectiveStatus }> {
  const result = await correctiveEdge(
    tx,
    correctiveActionId,
    "markDone",
    CorrectiveStatus.done,
    "corrective.done",
    actor,
    { completedBy: actor.actorUserId ?? null, completedAt: new Date() },
  );

  // Cascade: last CA done on the parent → resolve the exception (only when it is in_progress).
  // A CA that already advanced done → verified counts as complete too, so remaining excludes BOTH
  // `done` AND `verified` — otherwise a CA verified before the last one finishes would wrongly
  // keep the parent from auto-resolving.
  const remaining = await tx.correctiveAction.count({
    where: {
      exceptionId: result.exceptionId,
      deletedAt: null,
      status: { notIn: [CorrectiveStatus.done, CorrectiveStatus.verified] },
    },
  });
  if (remaining === 0) {
    const parent = await tx.exception.findUniqueOrThrow({
      where: { id: result.exceptionId },
      select: { status: true },
    });
    if (parent.status === ExceptionStatus.in_progress) {
      await exceptionEdge(
        tx,
        result.exceptionId,
        "resolve",
        ExceptionStatus.resolved,
        "exception.resolved",
        { actorLabel: "system:cascade" },
        { resolvedAt: new Date() },
      );
    }
  }

  return { id: result.id, status: result.status };
}

/** done → verified. Sets verified_by/at. */
export async function verifyCorrectiveAction(
  tx: TenantClient,
  correctiveActionId: string,
  actor: Actor,
): Promise<{ id: string; status: CorrectiveStatus }> {
  const result = await correctiveEdge(
    tx,
    correctiveActionId,
    "verify",
    CorrectiveStatus.verified,
    "corrective.verified",
    actor,
    { verifiedBy: actor.actorUserId ?? null, verifiedAt: new Date() },
  );
  return { id: result.id, status: result.status };
}

/** done → rejected (returns for rework; rejected → assigned re-enters via assignCorrectiveAction). */
export async function rejectCorrectiveAction(
  tx: TenantClient,
  correctiveActionId: string,
  actor: Actor,
): Promise<{ id: string; status: CorrectiveStatus }> {
  const result = await correctiveEdge(
    tx,
    correctiveActionId,
    "reject",
    CorrectiveStatus.rejected,
    "corrective.rejected",
    actor,
  );

  // Cascade: rejecting this CA's work means the exception is no longer resolved. If the resolve
  // cascade had already auto-moved the parent to `resolved` (because this CA was done), move it
  // back resolved → reopened (§7.2) in the same tx (actorLabel 'system:cascade').
  const parent = await tx.exception.findUniqueOrThrow({
    where: { id: result.exceptionId },
    select: { status: true },
  });
  if (parent.status === ExceptionStatus.resolved) {
    await exceptionEdge(
      tx,
      result.exceptionId,
      "reopen",
      ExceptionStatus.reopened,
      "exception.reopened",
      { actorLabel: "system:cascade" },
      { resolvedAt: null },
    );
  }

  return { id: result.id, status: result.status };
}
