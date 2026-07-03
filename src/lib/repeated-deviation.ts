// F4 domain wiring (#10) — the repeated-deviation / root-cause review rule (§ issue #10 spec).
//
// Called after an occurrence resolves to `failed`. (The failed transition ITSELF — pass/fail eval +
// occurrence.failed + the Exception it spawns — is the completion Server Action, M4 #17; that action
// invokes this function inside the SAME tx as the failure, so the review request cannot drift from
// the failure that triggered it.)
//
// Two independent windows are evaluated (thresholds/windows are MVP constants below):
//   - (scheduled_task_id, outlet_id) over a rolling 7 LOCAL days, threshold 3 → root-cause review.
//   - (task_template_id, outlet_id)  over a rolling 30 days,        threshold 5 → template review.
//
// When a threshold is met we write ONE activity_log entry (action `review.repeated_deviation_requested`,
// subject = the triggering occurrence, actorLabel `system:repeated-deviation`) with a NON-PII payload.
//
// IDEMPOTENCY: we do not emit a duplicate request for the same grouping key while an active review
// window is still open — before writing, we look for an existing such log entry for that grouping key
// within the window. So the 3rd failure logs once; subsequent failures in the same window do not spam.
//
// The activity_log write goes through logActivity() (the same F4 audit-insert path transition() uses),
// so it participates in the caller's transaction. There is no status mutation here — this is a review
// SIGNAL, not a state change — so it does not need transition() (which pairs a status write with a log).

import type { TenantClient } from "./db";
import { logActivity } from "./transition";

// ---- MVP config (thresholds + windows) ------------------------------------------
export const SCHEDULED_TASK_WINDOW_DAYS = 7;
export const SCHEDULED_TASK_THRESHOLD = 3;
export const TEMPLATE_WINDOW_DAYS = 30;
export const TEMPLATE_THRESHOLD = 5;

const REVIEW_ACTION = "review.repeated_deviation_requested";

/** Which grouping produced the review request. */
export type DeviationGrouping = "scheduledTask+outlet" | "template+outlet";

export interface EvaluateRepeatedDeviationInput {
  organizationId: string;
  scheduledTaskId: string;
  taskTemplateId: string;
  outletId: string;
  /** The occurrence that just resolved to `failed` — the review request's subject. */
  triggeringOccurrenceId: string;
  now: Date;
}

/** Non-PII payload written to activity_log.after_json for a review request. */
export interface RepeatedDeviationPayload {
  groupingKey: DeviationGrouping;
  window: string;
  count: number;
  threshold: number;
  scheduledTaskId?: string;
  taskTemplateId?: string;
  outletId: string;
  triggeringOccurrenceId: string;
}

export interface EvaluateRepeatedDeviationResult {
  /** The review requests emitted by THIS call (0, 1, or 2 — one per grouping that newly tripped). */
  requested: RepeatedDeviationPayload[];
}

/** Subtract `days` whole days from `now` to get the rolling window's lower bound. */
function windowStart(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Has a review request for this exact grouping key already been logged within the window? If so, the
 * review window is still open and we must not emit a duplicate (idempotency).
 *
 * The recency bound is measured against the log row's own `created_at` (server-authoritative, F3),
 * so `windowDays` is subtracted from REAL wall-clock time here — NOT from the caller's logical `now`.
 * The failure-COUNT window (below) is keyed on `occurrence_local_date` and does use the caller's
 * `now`; the two clocks are independent and only coincide in production (where now ≈ real time).
 */
async function alreadyRequested(
  tx: TenantClient,
  organizationId: string,
  grouping: DeviationGrouping,
  keyId: string,
  outletId: string,
  windowDays: number,
): Promise<boolean> {
  const recencyFloor = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const existing = await tx.activityLog.findFirst({
    where: {
      organizationId,
      action: REVIEW_ACTION,
      createdAt: { gte: recencyFloor },
      // Match the grouping key inside the non-PII payload we wrote previously.
      AND: [
        { afterJson: { path: ["groupingKey"], equals: grouping } },
        { afterJson: { path: ["outletId"], equals: outletId } },
        {
          afterJson: {
            path: [grouping === "scheduledTask+outlet" ? "scheduledTaskId" : "taskTemplateId"],
            equals: keyId,
          },
        },
      ],
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Evaluate the two repeated-deviation windows for the just-failed occurrence and, for each grouping
 * that has newly reached its threshold (and has no open review window), write a single
 * `review.repeated_deviation_requested` activity_log entry. Idempotent per grouping key + window.
 *
 * Runs inside the caller's tenant `tx`; the failed_count queries are RLS-scoped to the org.
 */
export async function evaluateRepeatedDeviation(
  tx: TenantClient,
  input: EvaluateRepeatedDeviationInput,
): Promise<EvaluateRepeatedDeviationResult> {
  const requested: RepeatedDeviationPayload[] = [];

  // --- Grouping 1: (scheduled_task_id, outlet_id) over 7 local days, threshold 3 ---
  const stWindowFrom = windowStart(input.now, SCHEDULED_TASK_WINDOW_DAYS);
  const stCount = await tx.taskOccurrence.count({
    where: {
      organizationId: input.organizationId,
      scheduledTaskId: input.scheduledTaskId,
      outletId: input.outletId,
      status: "failed",
      // Rolling window keyed on the occurrence's local date (§7.1 occurrences carry a pure DATE).
      occurrenceLocalDate: { gte: stWindowFrom },
    },
  });
  if (stCount >= SCHEDULED_TASK_THRESHOLD) {
    const dup = await alreadyRequested(
      tx,
      input.organizationId,
      "scheduledTask+outlet",
      input.scheduledTaskId,
      input.outletId,
      SCHEDULED_TASK_WINDOW_DAYS,
    );
    if (!dup) {
      const payload: RepeatedDeviationPayload = {
        groupingKey: "scheduledTask+outlet",
        window: `${SCHEDULED_TASK_WINDOW_DAYS}d`,
        count: stCount,
        threshold: SCHEDULED_TASK_THRESHOLD,
        scheduledTaskId: input.scheduledTaskId,
        outletId: input.outletId,
        triggeringOccurrenceId: input.triggeringOccurrenceId,
      };
      await logActivity(tx, {
        organizationId: input.organizationId,
        subjectType: "taskOccurrence",
        subjectId: input.triggeringOccurrenceId,
        action: REVIEW_ACTION,
        actorLabel: "system:repeated-deviation",
        afterJson: { ...payload },
      });
      requested.push(payload);
    }
  }

  // --- Grouping 2: (task_template_id, outlet_id) over 30 days, threshold 5 ---
  const tplWindowFrom = windowStart(input.now, TEMPLATE_WINDOW_DAYS);
  const tplCount = await tx.taskOccurrence.count({
    where: {
      organizationId: input.organizationId,
      taskTemplateId: input.taskTemplateId,
      outletId: input.outletId,
      status: "failed",
      occurrenceLocalDate: { gte: tplWindowFrom },
    },
  });
  if (tplCount >= TEMPLATE_THRESHOLD) {
    const dup = await alreadyRequested(
      tx,
      input.organizationId,
      "template+outlet",
      input.taskTemplateId,
      input.outletId,
      TEMPLATE_WINDOW_DAYS,
    );
    if (!dup) {
      const payload: RepeatedDeviationPayload = {
        groupingKey: "template+outlet",
        window: `${TEMPLATE_WINDOW_DAYS}d`,
        count: tplCount,
        threshold: TEMPLATE_THRESHOLD,
        taskTemplateId: input.taskTemplateId,
        outletId: input.outletId,
        triggeringOccurrenceId: input.triggeringOccurrenceId,
      };
      await logActivity(tx, {
        organizationId: input.organizationId,
        subjectType: "taskOccurrence",
        subjectId: input.triggeringOccurrenceId,
        action: REVIEW_ACTION,
        actorLabel: "system:repeated-deviation",
        afterJson: { ...payload },
      });
      requested.push(payload);
    }
  }

  return { requested };
}
