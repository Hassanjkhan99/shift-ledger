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
import type { Prisma } from "../generated/prisma/client";
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

/** Coerce a snapshot value into a JSON-stable form: Dates become ISO strings, null passes through,
 * everything else (strings/enums) passes through. Keeps before/after_json comparable to what a
 * plain object literal would serialize to. The snapshot fields here are string/enum/Date/null. */
function jsonSafe(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value as Prisma.InputJsonValue;
}

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
 *
 * Idempotent per occurrence: D2 holds at most ONE active exception per task_occurrence. If a
 * non-terminal (not `verified`), non-deleted exception already exists for this occurrence, we do
 * NOT create a second one — we return the existing row (no new audit row). This makes a retried
 * fail-handler safe. NOTE: this read-then-insert is not serialized against a concurrent opener; the
 * transaction-level race is tracked separately (#96).
 */
export async function openException(
  tx: TenantClient,
  input: OpenExceptionInput,
  actor: Actor,
): Promise<{ id: string; status: ExceptionStatus }> {
  const existing = await tx.exception.findFirst({
    where: {
      taskOccurrenceId: input.taskOccurrenceId,
      deletedAt: null,
      status: { not: ExceptionStatus.verified },
    },
    select: { id: true, status: true },
  });
  if (existing) {
    return existing;
  }
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
        // f4-guard-allow: (none)→open create routed through transition() (opts.subjectId set below)
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
    select: { status: true, organizationId: true, resolvedAt: true, deletedAt: true },
  });
  // A soft-deleted exception is a tombstone — its status must not be transitionable, including via a
  // corrective-action cascade. Reject loudly (mirrors correctiveEdge's deletedAt guard).
  if (current.deletedAt !== null) {
    throw new Error(`exception: cannot '${edge}' a soft-deleted exception '${exceptionId}'`);
  }
  assertFrom("exception", edge, current.status, EXCEPTION_FROM[edge]);
  const expectedFrom = current.status;

  // Field-level snapshots: status is always captured; when the edge overwrites resolved_at (resolve
  // sets it, reopen nulls it) the audit before/after also record the prior AND new resolved_at, so
  // e.g. a reopen preserves the resolved_at it clears.
  const before: Record<string, Prisma.InputJsonValue | null> = { status: current.status };
  const after: Record<string, Prisma.InputJsonValue | null> = { status: to };
  if ("resolvedAt" in extraData) {
    before.resolvedAt = jsonSafe(current.resolvedAt);
    after.resolvedAt = jsonSafe(extraData.resolvedAt);
  }

  return transition(tx, {
    organizationId: current.organizationId,
    subjectType: "exception",
    subjectId: exceptionId,
    action,
    actorUserId: actor.actorUserId,
    actorLabel: actor.actorLabel,
    before,
    after,
    reason: actor.reason,
    // Compare-and-set: only flip if the row is still in the status we read (expectedFrom). A
    // concurrent legal edge from the same state loses the race — count !== 1 — and we THROW so the
    // whole transition rolls back (no status change, no audit row). Unlike the sweep's silent
    // no-op, a user-driven edge that loses the race must fail loudly.
    mutate: async (t) => {
      const res = await t.exception.updateMany({
        // f4-guard-allow: transition()-wrapped CAS (exception edge)
        where: { id: exceptionId, status: expectedFrom, deletedAt: null },
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

/**
 * in_progress → resolved (sets resolved_at). D2 rule: an exception is only "resolved" once ALL its
 * corrective actions are complete. The auto-cascade in markCorrectiveActionDone enforces this, but a
 * DIRECT resolveException must not be able to bypass it — so we reject the resolve if any non-deleted
 * CA is still outstanding (status not in done/verified).
 */
export async function resolveException(tx: TenantClient, exceptionId: string, actor: Actor) {
  const outstanding = await tx.correctiveAction.count({
    where: {
      exceptionId,
      deletedAt: null,
      status: { notIn: [CorrectiveStatus.done, CorrectiveStatus.verified] },
    },
  });
  if (outstanding > 0) {
    throw new Error(
      `exception: cannot resolve '${exceptionId}' — ${outstanding} corrective action(s) still outstanding (not done/verified)`,
    );
  }
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
    select: { organizationId: true, status: true, deletedAt: true },
  });
  // Do not attach new remediation work to a dead or done parent. A soft-deleted exception is a
  // tombstone; a `resolved`/`verified` parent is terminal-ish — a fresh `open` CA under it would be
  // stranded (assignCorrectiveAction only allows a parent in acknowledged/in_progress), so reject
  // both up front.
  if (parent.deletedAt !== null) {
    throw new Error(
      `createCorrectiveAction: cannot attach to a soft-deleted exception '${input.exceptionId}'`,
    );
  }
  if (parent.status === ExceptionStatus.resolved || parent.status === ExceptionStatus.verified) {
    throw new Error(
      `createCorrectiveAction: cannot attach a corrective action to a '${parent.status}' exception '${input.exceptionId}'`,
    );
  }
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
        // f4-guard-allow: (none)→open create routed through transition() (opts.subjectId set below)
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

// The assignment/completion/verification columns a corrective-action edge may overwrite. The audit
// before/after snapshots capture the prior AND new value of whichever of these an edge touches (not
// just `status`), so a reassignment or rework does not lose the previous owner/due/completion.
const CORRECTIVE_SNAPSHOT_FIELDS = [
  "assigneeUserId",
  "assigneeRole",
  "dueAt",
  "completedBy",
  "completedAt",
  "verifiedBy",
  "verifiedAt",
] as const;

/**
 * Generic corrective-action status edge: assert the current status is legal, then flip it through
 * transition(). Returns the updated row plus its parent exception id (for cascades).
 *
 * The before/after audit snapshots include `status` PLUS whichever assignment/completion/
 * verification fields this edge writes (`extraData` keys), so the audit trail records the full
 * field-level delta — e.g. a reassignment shows the prior assignee/due, a rework shows cleared
 * completion stamps. Soft-deleted rows (`deletedAt` set) are NOT transitionable: the CAS guard is
 * keyed on `deletedAt: null`, so a deleted CA fails the edge loudly.
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
    select: {
      status: true,
      exceptionId: true,
      organizationId: true,
      deletedAt: true,
      assigneeUserId: true,
      assigneeRole: true,
      dueAt: true,
      completedBy: true,
      completedAt: true,
      verifiedBy: true,
      verifiedAt: true,
    },
  });
  // A soft-deleted CA is not a live entity — its status must not be transitionable.
  if (current.deletedAt !== null) {
    throw new Error(
      `correctiveAction: cannot '${edge}' a soft-deleted corrective action '${correctiveActionId}'`,
    );
  }
  assertFrom("correctiveAction", edge, current.status, CORRECTIVE_FROM[edge]);
  const expectedFrom = current.status;

  // Build field-level before/after snapshots: status is always captured; each field this edge
  // overwrites (present in extraData) contributes its prior value (before) and new value (after).
  const before: Record<string, Prisma.InputJsonValue | null> = { status: current.status };
  const after: Record<string, Prisma.InputJsonValue | null> = { status: to };
  for (const field of CORRECTIVE_SNAPSHOT_FIELDS) {
    if (field in extraData) {
      before[field] = jsonSafe(current[field]);
      after[field] = jsonSafe(extraData[field]);
    }
  }

  const updated = await transition(tx, {
    organizationId: current.organizationId,
    subjectType: "correctiveAction",
    subjectId: correctiveActionId,
    action,
    actorUserId: actor.actorUserId,
    actorLabel: actor.actorLabel,
    before,
    after,
    reason: actor.reason,
    // Compare-and-set: only flip if the row is still in the status we read (expectedFrom) AND still
    // live (deletedAt null). A concurrent legal edge from the same state loses the race — count !==
    // 1 — and we THROW so the whole transition rolls back (no status change, no audit row). Unlike
    // the sweep's silent no-op, a user-driven edge that loses the race must fail loudly.
    mutate: async (t) => {
      const res = await t.correctiveAction.updateMany({
        // f4-guard-allow: transition()-wrapped CAS (corrective-action edge)
        where: { id: correctiveActionId, status: expectedFrom, deletedAt: null },
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
 * open → assigned AND rejected → assigned. Sets assignee + due_at. §7.3: an `assigned` CA has an
 * assignee AND a due date — so we require exactly one assignee target AND a non-null dueAt (a CA
 * assigned without a deadline can never surface on the (organization_id, status, due_at) overdue
 * path). The parent exception must already be `acknowledged` or `in_progress`: assigning while the
 * parent is still open/reopened (or terminal) would skip the acknowledged→in_progress cascade and
 * strand the parent. When the parent is `acknowledged`, this still cascades it → in_progress (§7.2)
 * in the same tx (actorLabel 'system:cascade').
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
  // A due date is mandatory: assignment sets the deadline the overdue path keys on.
  if (input.dueAt === undefined || input.dueAt === null) {
    throw new Error("assignCorrectiveAction: a dueAt (due date) is required when assigning");
  }

  // Assert the CA's OWN legal edge first (so an illegal assign — e.g. from `done` — fails as an
  // illegal transition, not a parent-state error), then require the parent exception to be actively
  // in remediation (acknowledged or in_progress). Assigning while the parent is still open/reopened
  // or already terminal would either strand an un-acknowledged parent or attach work to a done one.
  const caBefore = await tx.correctiveAction.findUniqueOrThrow({
    where: { id: correctiveActionId },
    select: {
      status: true,
      deletedAt: true,
      organizationId: true,
      exception: { select: { status: true } },
    },
  });
  if (caBefore.deletedAt !== null) {
    throw new Error(
      `correctiveAction: cannot 'assign' a soft-deleted corrective action '${correctiveActionId}'`,
    );
  }
  assertFrom("correctiveAction", "assign", caBefore.status, CORRECTIVE_FROM.assign);

  // #95: a user assignee must be an ACTIVE, non-deleted member of THIS CA's org. The composite FK
  // (organization_id, assignee_user_id) -> memberships(organization_id, user_id) already rejects a
  // non-member / cross-tenant id at the DB level, but an FK can only prove membership EXISTS — it
  // cannot filter on status='active' / deleted_at IS NULL. So catch an inactive or soft-deleted
  // member here (the FK cannot). The analogous checks for completion `completed_by` and
  // scheduled-task assignees live at their own write paths (the M4 #17 action layer); completion
  // actors are already validated by resolveCompletionActor / isEligiblePickUser.
  if (input.assigneeUserId !== undefined && input.assigneeUserId !== null) {
    const activeMember = await tx.membership.findFirst({
      where: {
        organizationId: caBefore.organizationId,
        userId: input.assigneeUserId,
        status: "active",
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!activeMember) {
      throw new Error(
        `assignCorrectiveAction: assignee '${input.assigneeUserId}' is not an active member of this organization`,
      );
    }
  }

  const parentStatus = caBefore.exception.status;
  if (
    parentStatus !== ExceptionStatus.acknowledged &&
    parentStatus !== ExceptionStatus.in_progress
  ) {
    throw new Error(
      `assignCorrectiveAction: parent exception must be 'acknowledged' or 'in_progress' to assign a corrective action (was '${parentStatus}')`,
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
  // Completion must be attributable to a real user: completedBy is the accountable person. A system
  // actor (actorLabel only) would store `done` with a null completedBy, losing attribution — reject.
  if (!actor.actorUserId) {
    throw new Error(
      "markCorrectiveActionDone: a user actor (actorUserId) is required — completion must be attributable",
    );
  }
  const result = await correctiveEdge(
    tx,
    correctiveActionId,
    "markDone",
    CorrectiveStatus.done,
    "corrective.done",
    actor,
    { completedBy: actor.actorUserId, completedAt: new Date() },
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
  // Verification must be attributable to a real user: verifiedBy is the accountable person. A system
  // actor (actorLabel only) would store `verified` with a null verifiedBy, losing attribution — reject.
  if (!actor.actorUserId) {
    throw new Error(
      "verifyCorrectiveAction: a user actor (actorUserId) is required — verification must be attributable",
    );
  }
  const result = await correctiveEdge(
    tx,
    correctiveActionId,
    "verify",
    CorrectiveStatus.verified,
    "corrective.verified",
    actor,
    { verifiedBy: actor.actorUserId, verifiedAt: new Date() },
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

  // Cascade: rejecting this CA's work means the exception is no longer resolved. If the parent had
  // already advanced to `resolved` (via the done-cascade) OR further to `verified` (a manager
  // verified it while this CA was still `done`), move it back → reopened (§7.2) in the same tx
  // (actorLabel 'system:cascade'). `reopen`'s legal `from` is {resolved, verified}, so both cases
  // are covered by the same edge.
  const parent = await tx.exception.findUniqueOrThrow({
    where: { id: result.exceptionId },
    select: { status: true },
  });
  if (parent.status === ExceptionStatus.resolved || parent.status === ExceptionStatus.verified) {
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
