// F4 — the single sanctioned state-transition choke point.
//
// Design invariant (§8.20, F4): it must be structurally impossible to change an entity's
// status/version without writing a matching `activity_log` row. Everything that mutates a
// status column or creates a versioned edit routes through transition(): it runs the caller's
// mutation AND writes the audit row in ONE transaction, so the two are all-or-nothing. If the
// mutation throws, no log row is written; if the log insert throws (e.g. a bad actor FK), the
// mutation is rolled back too. There is no code path that persists one without the other.
//
// SCOPE (issue #54): this ticket delivers the MECHANISM only. The activity_log row is written
// via the ordinary Prisma insert path (tx.activityLog.create). The tamper-evident hash chain
// — the per-org dense `seq`, `prev_hash`/`row_hash`, and the SECURITY DEFINER insert function
// that computes them so application code cannot forge the chain — is deferred to M3 (#13).
// This module is the seam for that swap: when #13 lands, ONLY logActivity() changes (it will
// call the SECURITY DEFINER function instead of tx.activityLog.create), and no transition()
// call site has to change.
//
// transition() is deliberately generic over subject_type / the mutation callback: it encodes
// the atomicity + actor + reason rules, not any one domain's state machine. The occurrence /
// exception / corrective-action rules (#8/#9/#10) plug in via the `mutate` callback.

import type { TenantClient } from "./db";
import type { ActivitySubjectType } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";

/**
 * JSON snapshot stored in before_json / after_json. Uses Prisma's InputJsonValue so the
 * jsonb columns accept it directly; in practice callers pass a plain object of state fields.
 */
export type JsonSnapshot = Prisma.InputJsonValue;

/**
 * One append-only audit entry. Fields map 1:1 onto the ActivityLog model columns.
 * Exactly one of `actorUserId` / `actorLabel` identifies the actor (see transition()).
 */
export interface ActivityLogEntry {
  organizationId: string;
  subjectType: ActivitySubjectType;
  subjectId: string;
  action: string;
  actorUserId?: string;
  actorLabel?: string;
  beforeJson?: JsonSnapshot;
  afterJson?: JsonSnapshot;
  reason?: string;
}

/**
 * Insert one activity_log row inside the caller's transaction.
 *
 * This is the single write path for the audit log. As of #13 it calls the SECURITY DEFINER
 * log_activity() function (prisma/superuser/) instead of a direct Prisma insert: that function computes
 * the per-org dense chain_seq + prev_hash/row_hash atomically and is the ONLY sanctioned inserter (a
 * guard trigger rejects direct app_user inserts), so the tamper-evident chain (F6) cannot be forged
 * from application code. The org is taken from the transaction-local GUC the function shares with RLS,
 * so `entry.organizationId` is used only for the caller-side attribution assertion. Do NOT insert into
 * activity_log from anywhere else — go through this seam.
 */
export async function logActivity(
  tx: TenantClient,
  entry: ActivityLogEntry,
): Promise<{ id: string }> {
  // Enforce the attribution invariant at the write boundary too, not only in transition() — this
  // is the exported seam every audit write goes through, incl. direct non-status logs.
  assertExactlyOneActor(entry.actorUserId, entry.actorLabel);
  const before = entry.beforeJson === undefined ? null : JSON.stringify(entry.beforeJson);
  const after = entry.afterJson === undefined ? null : JSON.stringify(entry.afterJson);
  // Prisma enum values are camelCase (e.g. 'taskOccurrence'); the DB enum uses the @map'd snake_case
  // ('task_occurrence'). The normal Prisma insert path translates this, but our raw call must do it —
  // camelCase->snake_case is a no-op for already-snake / unmapped values, so it is safe for all members.
  const dbSubjectType = entry.subjectType.replace(/([A-Z])/g, "_$1").toLowerCase();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT log_activity(
      ${entry.organizationId}::uuid,
      ${dbSubjectType}::activity_subject_type,
      ${entry.subjectId}::uuid,
      ${entry.action},
      ${entry.actorUserId ?? null}::uuid,
      ${entry.actorLabel ?? null},
      ${before}::jsonb,
      ${after}::jsonb,
      ${entry.reason ?? null}
    ) AS id`;
  return { id: rows[0].id };
}

/** Options for a single transition. See transition() for the ordering guarantees. */
export interface TransitionOptions<T> {
  organizationId: string;
  subjectType: ActivitySubjectType;
  subjectId: string;
  action: string;
  /** User actor. Set this XOR `actorLabel` — exactly one. */
  actorUserId?: string;
  /** System actor label, e.g. 'system:overdue-sweep'. Set this XOR `actorUserId`. */
  actorLabel?: string;
  /** Prior state snapshot (mapped to before_json). */
  before?: JsonSnapshot;
  /** New state snapshot (mapped to after_json). */
  after?: JsonSnapshot;
  /** Free-text reason (required for compliance edits — see requireReason). */
  reason?: string;
  /**
   * When true, `reason` must be a non-empty (non-whitespace) string or transition() throws
   * BEFORE any write. #54 only enforces the flag; each domain decides when to set it.
   */
  requireReason?: boolean;
  /** The status/version mutation. Runs inside the same `tx` as the audit insert. */
  mutate: (tx: TenantClient) => Promise<T>;
  /**
   * Optional guard evaluated on the `mutate` result. When it returns false, transition() treats
   * the mutation as a no-op and writes NO activity_log row (returning the result unchanged). Used
   * for compare-and-set writes (e.g. the overdue sweep's `updateMany({ where: { id, status } })`):
   * if a concurrent completion/skip/cancel changed the row between the sweep's read and write, the
   * CAS updates 0 rows and we must NOT emit a spurious transition log. Omit for a normal write,
   * where the mutation is assumed to always apply.
   */
  didMutate?: (result: T) => boolean;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/**
 * Every audit row must have exactly one actor. "Set" means present AND non-blank — a blank/
 * whitespace `actorLabel` (e.g. a missing env-derived cron label) is NOT a valid system actor and
 * must not commit a status change attributed to empty text.
 */
function assertExactlyOneActor(
  actorUserId: string | undefined,
  actorLabel: string | undefined,
): void {
  const hasUser = !isBlank(actorUserId);
  const hasLabel = !isBlank(actorLabel);
  if (hasUser === hasLabel) {
    throw new Error(
      "exactly one of actorUserId (user actor) or actorLabel (system actor) must be a non-empty value",
    );
  }
}

/**
 * Perform a state transition atomically: run the caller's mutation and write the audit row in
 * the SAME transaction. Runs inside a caller-provided `tx` (from withTenant), so it inherits
 * the tenant RLS context and shares the mutation's atomicity.
 *
 * Order of operations:
 *   1. Validate the actor (exactly one of actorUserId / actorLabel) and, if requireReason,
 *      the reason — BEFORE any write, so a bad call cannot mutate anything.
 *   2. Run `mutate(tx)` and capture its result.
 *   3. Write the activity_log row (before -> before_json, after -> after_json).
 *   4. Return the mutation's result.
 *
 * Any throw in step 2, 3, or the caller's surrounding transaction rolls back BOTH the mutation
 * and the audit insert — they can never diverge.
 */
export async function transition<T>(tx: TenantClient, opts: TransitionOptions<T>): Promise<T> {
  assertExactlyOneActor(opts.actorUserId, opts.actorLabel);
  if (opts.requireReason && isBlank(opts.reason)) {
    throw new Error(`transition(): action '${opts.action}' requires a non-empty reason`);
  }

  const result = await opts.mutate(tx);

  // Compare-and-set no-op: the mutation matched nothing (a concurrent write changed the row).
  // Skip the audit row entirely — there was no transition to record.
  if (opts.didMutate && !opts.didMutate(result)) {
    return result;
  }

  await logActivity(tx, {
    organizationId: opts.organizationId,
    subjectType: opts.subjectType,
    subjectId: opts.subjectId,
    action: opts.action,
    actorUserId: opts.actorUserId,
    actorLabel: opts.actorLabel,
    beforeJson: opts.before,
    afterJson: opts.after,
    reason: opts.reason,
  });

  return result;
}
