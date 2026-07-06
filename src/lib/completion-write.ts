// F2 — the idempotent completion-write contract (issue #52).
//
// A task completion is a durable compliance record. The D9 offline write-queue (#20) retries a
// queued submission when connectivity returns, so if a submission's ACK was lost the client
// RESENDS it with the SAME client-generated `client_submission_id`. This module is the single
// safe-to-replay write path that guarantees such a retry returns the existing row instead of
// writing a second completion (a duplicate compliance record corrupts the audit story). It also
// draws the line between a DUPLICATE replay (same key) and a SEMANTIC conflict (different key
// against an occurrence that already has a current completion).
//
// SCOPE BOUNDARY (#52): this delivers the WRITE SEMANTICS only — the duplicate-vs-conflict contract
// and the concurrency-safe idempotent insert. It deliberately does NOT implement:
//   - pass/fail evaluation of the reading against thresholds,
//   - the occurrence status transition (due → completed / completed_late / failed),
//   - evidence attachment,
//   - the permissioned versioned-CORRECTION flow (a new version + is_current flip).
// Those belong to the completion Server Action (M4 #17). A semantic conflict here is REJECTED, never
// auto-corrected — correction is an explicit, permissioned action with a mandatory reason (#11/#17),
// not a side effect of idempotency handling.
//
// TENANCY: every lookup and insert runs through the caller-provided `tx` (from withTenant), so it
// inherits the transaction-local RLS context. Another org's rows are never visible or leaked.

import type { TenantClient } from "./db";
import type { CompletionResult, OccurrenceStatus } from "../generated/prisma/enums";
import { Prisma } from "../generated/prisma/client";
import { buildCompletionInsert, type CompletionInsertInput } from "./completions";
import { logActivity } from "./transition";

/**
 * Input to submitCompletion. Mirrors buildCompletionInsert's input (which it reuses), minus the
 * advisory device fields that do not participate in the idempotency-payload comparison beyond what
 * the completion itself stores. `recorded_at` is intentionally absent — it is server-authoritative
 * (F3, #53).
 */
export type SubmitCompletionInput = CompletionInsertInput;

/**
 * The write result consumed by #17 (completion Server Action) and #20 (offline queue). A discriminated
 * union so callers must handle each branch explicitly.
 *
 * - `ok`                          — a fresh insert (idempotentReplay=false) OR a duplicate replay of
 *                                    the same logical submission (idempotentReplay=true). Same key +
 *                                    same meaningful payload.
 * - `idempotency_payload_mismatch`— the key was seen before but the incoming body is materially
 *                                    different (client bug reusing a key). Nothing is inserted or
 *                                    mutated; the existing row's id is returned for observability.
 * - `conflict`                    — a DIFFERENT key targets an occurrence that already has a current
 *                                    completion. Nothing is inserted; correction is not auto-created.
 * - `occurrence_not_found`        — the target occurrence is not visible in the current tenant (RLS-
 *                                    scoped lookup returned null). This is a tenant guard: the global
 *                                    current-completion unique index is on `task_occurrence_id`
 *                                    (not org-scoped), so without this check a foreign occurrence id
 *                                    could let this tenant write against — or block — another org's
 *                                    occurrence. Nothing is inserted.
 */
export type CompletionWriteResult =
  | { status: "ok"; completionId: string; idempotentReplay: boolean }
  | { status: "idempotency_payload_mismatch"; completionId: string }
  | {
      status: "conflict";
      reason: "current-completion-exists";
      occurrenceId: string;
      serverStatus: string;
      existingCompletionId?: string;
    }
  | { status: "occurrence_not_found"; occurrenceId: string };

/** The meaningful (identity-defining) fields of a submission, used for the payload-mismatch check. */
interface MeaningfulPayload {
  taskOccurrenceId: string;
  result: CompletionResult;
  completedBy: string;
  actorConfirmationMethod: string;
  measuredNumeric: string | null;
  enteredValues: string;
}

/**
 * Normalize a Decimal | number | string | undefined into a CANONICAL numeric string (or null) so
 * that `3.4`, `"3.40"`, and a Prisma.Decimal(3.4) all compare equal. The stored value is read back
 * as a Prisma.Decimal and stringified to its canonical form, so a client-supplied numeric string
 * (`"3.40"`, `"3.0"`) must be run through the same Decimal canonicalization before comparison, or a
 * valid exact retry is misclassified as a payload mismatch. Non-numeric strings (should not occur)
 * fall back to the raw string so the comparison stays deterministic rather than throwing.
 */
function normalizeMeasured(
  value: Prisma.Decimal | number | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  try {
    return new Prisma.Decimal(value).toString();
  } catch {
    return typeof value === "string" ? value : String(value);
  }
}

/** Deterministic JSON serialization with sorted keys so key order never causes a false mismatch. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function incomingMeaningful(input: SubmitCompletionInput): MeaningfulPayload {
  return {
    taskOccurrenceId: input.taskOccurrenceId,
    result: input.result,
    completedBy: input.completedBy,
    // Defaults to 'session' when the input omits it, matching the DB column default.
    actorConfirmationMethod: input.actorConfirmationMethod ?? "session",
    measuredNumeric: normalizeMeasured(input.measuredNumeric),
    // enteredValuesJson defaults to {} at the DB, so an absent input compares equal to a stored {}.
    enteredValues: stableStringify(input.enteredValuesJson ?? {}),
  };
}

function storedMeaningful(row: {
  taskOccurrenceId: string;
  result: CompletionResult;
  completedBy: string;
  actorConfirmationMethod: string;
  measuredNumeric: Prisma.Decimal | null;
  enteredValuesJson: Prisma.JsonValue;
}): MeaningfulPayload {
  return {
    taskOccurrenceId: row.taskOccurrenceId,
    result: row.result,
    completedBy: row.completedBy,
    actorConfirmationMethod: row.actorConfirmationMethod,
    measuredNumeric: normalizeMeasured(row.measuredNumeric),
    enteredValues: stableStringify(row.enteredValuesJson ?? {}),
  };
}

function payloadsMatch(a: MeaningfulPayload, b: MeaningfulPayload): boolean {
  return (
    a.taskOccurrenceId === b.taskOccurrenceId &&
    a.result === b.result &&
    a.completedBy === b.completedBy &&
    a.actorConfirmationMethod === b.actorConfirmationMethod &&
    a.measuredNumeric === b.measuredNumeric &&
    a.enteredValues === b.enteredValues
  );
}

/** Columns we need to compare a replay and to classify a conflict. */
const EXISTING_SELECT = {
  id: true,
  taskOccurrenceId: true,
  result: true,
  completedBy: true,
  actorConfirmationMethod: true,
  measuredNumeric: true,
  enteredValuesJson: true,
} as const;

/**
 * Read the CURRENT completion for an occurrence and, if present, shape the semantic-conflict result.
 * Returns null when the occurrence has no current completion (the insert path is clear). Reused by
 * both the up-front conflict check and the concurrent-race (count === 0) branch.
 */
async function readConflict(
  tx: TenantClient,
  taskOccurrenceId: string,
): Promise<Extract<CompletionWriteResult, { status: "conflict" }> | null> {
  const current = await tx.taskCompletion.findFirst({
    where: { taskOccurrenceId, isCurrent: true },
    select: { id: true, taskOccurrence: { select: { status: true } } },
  });
  if (!current) return null;
  const serverStatus: OccurrenceStatus = current.taskOccurrence.status;
  return {
    status: "conflict",
    reason: "current-completion-exists",
    occurrenceId: taskOccurrenceId,
    serverStatus,
    existingCompletionId: current.id,
  };
}

/**
 * Idempotent, conflict-aware completion write. Runs inside the caller's withTenant() transaction.
 *
 * Decision flow:
 *   1. Look up an existing row by (organizationId, clientSubmissionId).
 *        - found + same meaningful payload → idempotent replay (no write, no log).
 *        - found + different payload       → idempotency_payload_mismatch (no write, no mutation).
 *   2. No existing key. Verify the target occurrence is visible in THIS tenant (RLS-scoped lookup).
 *        - not visible → occurrence_not_found. Insert nothing (tenant guard: the current-completion
 *          unique index is global on task_occurrence_id, so a foreign id must never reach the insert).
 *   3. Check for a CURRENT completion on the occurrence.
 *        - present → conflict (current-completion-exists). Insert nothing; do NOT auto-correct.
 *   4. Fresh write via a concurrency-safe INSERT ... ON CONFLICT DO NOTHING (createMany +
 *      skipDuplicates). On a genuine insert (count === 1), write exactly ONE activity_log entry
 *      (completion.created) atomically in the same tx. If count === 0 a concurrent submit won a race:
 *        - our key already has a row → same-key replay: compare payloads and return ok, or
 *          idempotency_payload_mismatch if the winning row's payload differs.
 *        - no row under our key      → a DIFFERENT key won the occurrence's current-completion slot →
 *          re-read the current completion and return the semantic conflict result. Never throw.
 */
export async function submitCompletion(
  tx: TenantClient,
  input: SubmitCompletionInput,
): Promise<CompletionWriteResult> {
  // 1. Same-key lookup (RLS scopes this to the current org).
  const existing = await tx.taskCompletion.findUnique({
    where: {
      organizationId_clientSubmissionId: {
        organizationId: input.organizationId,
        clientSubmissionId: input.clientSubmissionId,
      },
    },
    select: EXISTING_SELECT,
  });

  if (existing) {
    return payloadsMatch(incomingMeaningful(input), storedMeaningful(existing))
      ? { status: "ok", completionId: existing.id, idempotentReplay: true }
      : { status: "idempotency_payload_mismatch", completionId: existing.id };
  }

  // 2. Tenant guard. The current-completion unique index is GLOBAL on task_occurrence_id (not
  //    org-scoped), so a cross-tenant occurrence id would otherwise let this org write against — or
  //    block — another org's occurrence. RLS scopes `tx` to this org, so a foreign occurrence returns
  //    null here; reject before any insert path.
  const occurrence = await tx.taskOccurrence.findUnique({
    where: { id: input.taskOccurrenceId },
    select: { id: true },
  });
  if (!occurrence) {
    return { status: "occurrence_not_found", occurrenceId: input.taskOccurrenceId };
  }

  // 3. Different key, but the occurrence may already have a current completion → semantic conflict.
  const conflict = await readConflict(tx, input.taskOccurrenceId);
  if (conflict) return conflict;

  // 4. Fresh write. createMany + skipDuplicates → INSERT ... ON CONFLICT DO NOTHING, so a concurrent
  //    submit with the same key cannot surface a unique-violation to the caller.
  const inserted = await tx.taskCompletion.createMany({
    data: [buildCompletionInsert(input)],
    skipDuplicates: true,
  });

  if (inserted.count === 0) {
    // A concurrent submit won a race that skipped our insert. Two distinct causes:
    const winner = await tx.taskCompletion.findUnique({
      where: {
        organizationId_clientSubmissionId: {
          organizationId: input.organizationId,
          clientSubmissionId: input.clientSubmissionId,
        },
      },
      select: EXISTING_SELECT,
    });
    if (winner) {
      // (a) our OWN key won (a concurrent submit with the same key beat us). Same-key replay:
      //     compare payloads so a concurrent DIFFERENT-payload submit is still flagged, not blindly ok.
      return payloadsMatch(incomingMeaningful(input), storedMeaningful(winner))
        ? { status: "ok", completionId: winner.id, idempotentReplay: true }
        : { status: "idempotency_payload_mismatch", completionId: winner.id };
    }
    // (b) a DIFFERENT key won the occurrence's current-completion slot (partial unique on
    //     task_occurrence_id WHERE is_current). No row under our key → semantic conflict, never throw.
    const raced = await readConflict(tx, input.taskOccurrenceId);
    if (raced) return raced;
    // A skipped insert is always caused by one of those two unique indexes, so one of the branches
    // above returns. Guard the type system (and any future index change) with an explicit throw
    // rather than logging a creation we never performed.
    throw new Error(
      `submitCompletion: insert skipped for occurrence ${input.taskOccurrenceId} but neither the same-key row nor a current completion is visible`,
    );
  }

  // Genuine insert (count === 1). Read back the id of the row we just created (createMany does not
  // return it) and write exactly one creation audit entry.
  const created = await tx.taskCompletion.findUniqueOrThrow({
    where: {
      organizationId_clientSubmissionId: {
        organizationId: input.organizationId,
        clientSubmissionId: input.clientSubmissionId,
      },
    },
    select: { id: true },
  });

  // Exactly one audit entry for a genuine creation (F4 seam, #54).
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "taskCompletion",
    subjectId: created.id,
    action: "completion.created",
    actorUserId: input.completedBy,
    afterJson: {
      taskOccurrenceId: input.taskOccurrenceId,
      result: input.result,
      clientSubmissionId: input.clientSubmissionId,
    },
  });

  return { status: "ok", completionId: created.id, idempotentReplay: false };
}
