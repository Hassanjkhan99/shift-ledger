// Completion insert assembly — the F3 (server-authoritative timestamps) seam (#53).
//
// F3 — the compliance "when": a completion's authoritative timestamp is `recorded_at`, stamped by
// the DATABASE (`DEFAULT now()`), NEVER supplied by the client. A device clock can be wrong or
// deliberately manipulated, and "when did this happen" is the crux of the audit — so we never let
// the client drive it. The device's self-reported time is stored SEPARATELY as `client_reported_at`
// (advisory only: forensics/diagnostics), and is never used for compliance logic or ordering.
//
// buildCompletionInsert() is the single place that assembles a completion's insert payload, so the
// F3 rule is structural: it CANNOT emit a `recorded_at` key (the DB default is the only writer), and
// it maps any caller-provided device time into `client_reported_at`.
//
// SCOPE (#53): this ships the timestamp discipline + the insert-payload assembly only. It does NOT
// build the completion Server Action, the pass/fail evaluation, the versioned-correction path
// (M4 #17), or the idempotent-write duplicate-vs-conflict contract (#52 — this issue only creates
// the client_submission_id column + its UNIQUE constraint).

import type { Prisma } from "../generated/prisma/client";
import type { CompletionResult } from "../generated/prisma/enums";

/** Input for assembling a completion insert. `recorded_at` is intentionally NOT accepted (F3). */
export interface CompletionInsertInput {
  organizationId: string;
  taskOccurrenceId: string;
  /** Client-generated idempotency key (F2). Uniqueness is enforced per-org at the DB level. */
  clientSubmissionId: string;
  result: CompletionResult;
  /** Actor (users.id) who recorded the completion. */
  completedBy: string;
  /** Structured entered values, e.g. { measuredCelsius: 3.4 }. Defaults to {} at the DB. */
  enteredValuesJson?: Prisma.InputJsonValue;
  /** Extracted primary reading for threshold checks (numeric, never float). */
  measuredNumeric?: Prisma.Decimal | number | string;
  /** Shared-tablet actor identity (D8): 'session' | 'pin' | 'initials'. Defaults to 'session'. */
  actorConfirmationMethod?: string;
  /** Device self-reported time — ADVISORY ONLY (F3). Stored, never used for compliance/ordering. */
  clientReportedAt?: Date;
  /** User-agent / app version / geo hint. */
  deviceMetaJson?: Prisma.InputJsonValue;
}

/**
 * Assemble the `data` for a task_completions insert (via tx.taskCompletion.create({ data })).
 *
 * F3 GUARANTEE: the returned object NEVER contains `recordedAt` — the DB `DEFAULT now()` is the
 * sole writer of the compliance timestamp. A caller-supplied device time is placed in
 * `clientReportedAt` (advisory) and can never influence `recorded_at`.
 *
 * This helper does not open a transaction or touch the DB; callers insert the returned payload
 * inside their own withTenant() transaction.
 */
export function buildCompletionInsert(
  input: CompletionInsertInput,
): Prisma.TaskCompletionUncheckedCreateInput {
  const data: Prisma.TaskCompletionUncheckedCreateInput = {
    organizationId: input.organizationId,
    taskOccurrenceId: input.taskOccurrenceId,
    clientSubmissionId: input.clientSubmissionId,
    result: input.result,
    completedBy: input.completedBy,
    actorConfirmationMethod: input.actorConfirmationMethod ?? "session",
  };

  if (input.enteredValuesJson !== undefined) {
    data.enteredValuesJson = input.enteredValuesJson;
  }
  if (input.measuredNumeric !== undefined) {
    data.measuredNumeric = input.measuredNumeric;
  }
  // Advisory device time only (F3). recorded_at is deliberately never assembled here.
  if (input.clientReportedAt !== undefined) {
    data.clientReportedAt = input.clientReportedAt;
  }
  if (input.deviceMetaJson !== undefined) {
    data.deviceMetaJson = input.deviceMetaJson;
  }

  return data;
}
