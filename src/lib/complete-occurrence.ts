// Completion write orchestrator (M4 #17) — the domain core behind the task-completion Server Action.
//
// It composes the already-built write primitives into the §11.8 complete / fail flow, all inside ONE
// caller withTenant() transaction so the compliance record and its status transition are atomic:
//   1. F2 idempotency — submitCompletion() (#52): a retry with a seen (org, client_submission_id)
//      returns the existing row, never a duplicate compliance record (the D9 offline-queue contract).
//   2. F3 timestamps — recorded_at is server-authoritative (buildCompletionInsert never emits it);
//      client_reported_at is advisory only.
//   3. F4 choke point — the occurrence status flip routes through applyOccurrenceCompletion()
//      (occurrences.ts → transition()), so every status change writes an activity_log row atomically.
//      This module writes NO status column directly.
//   4. Threshold auto-evaluation — a temperature reading outside the frozen config_snapshot forces the
//      fail path even on a `complete` intent (§11.8).
//   5. Fail cascade — a failure auto-opens an Exception (idempotent per occurrence) and evaluates the
//      repeated-deviation review windows, in the same tx.
//
// It does NOT resolve auth or touch the cache — that is the Server Action wrapper (occurrence actions);
// nor the versioned-correction writer (its own ticket). Every DB call runs through the caller `tx`
// (withTenant) so RLS scopes it to the org (D6).
import { z } from "zod";
import type { TenantClient } from "./db";
import { OrgRole } from "../generated/prisma/enums";
import type { OccurrenceStatus, CompletionResult, EvidenceType } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";
import { submitCompletion } from "./completion-write";
import { applyOccurrenceCompletion, type CompletionTransitionTarget } from "./occurrences";
import { openException } from "./exceptions";
import { evaluateRepeatedDeviation } from "./repeated-deviation";
import { assertRoleMayTrigger } from "./permissions";

/** One evidence row to attach to the completion (shape validated by the DB D4 CHECKs). */
export interface EvidenceInput {
  type: EvidenceType;
  valueText?: string;
  valueNumeric?: number | string;
  valueBool?: boolean;
  attachmentId?: string;
}

/** `complete` records a pass (unless a threshold breach forces fail); `fail` records a fail directly. */
export type CompleteIntent = "complete" | "fail";

export interface CompleteOccurrenceInput {
  organizationId: string;
  occurrenceId: string;
  /** F2 idempotency key (client-generated uuid). A seen key returns the existing completion. */
  clientSubmissionId: string;
  /** The resolved actor (users.id) — session owner or shared-tablet picked user (D8). */
  actorUserId: string;
  /** The actor's org role, for the F4 who-may-trigger guard (D7). */
  actorRole: OrgRole;
  intent: CompleteIntent;
  actorConfirmationMethod?: "session" | "pin" | "initials";
  enteredValuesJson?: Prisma.InputJsonValue;
  /** Primary numeric reading (temperature); stored as numeric, never float (§8.14). */
  measuredNumeric?: number | string;
  /** Device self-reported time — advisory only (F3), never used for compliance ordering. */
  clientReportedAt?: Date;
  deviceMetaJson?: Prisma.InputJsonValue;
  evidence?: EvidenceInput[];
  /** Reason / note; used as the auto-opened exception detail on the fail path. */
  reason?: string;
  /** Injected clock for the repeated-deviation window (defaults to now). */
  now?: Date;
}

export type CompleteOccurrenceResult =
  | {
      status: "ok";
      completionId: string;
      occurrenceStatus: OccurrenceStatus;
      result: CompletionResult;
      idempotentReplay: boolean;
      forcedFail: boolean;
      exceptionId?: string;
    }
  | { status: "already_completed"; occurrenceId: string; serverStatus: string }
  | { status: "not_due"; occurrenceId: string; serverStatus: string }
  | { status: "missing_evidence"; missing: EvidenceType[] }
  | { status: "payload_mismatch"; completionId: string }
  | { status: "not_found"; occurrenceId: string };

/** The frozen §8.13 config_snapshot shape the occurrence carries (best-effort parsed). */
const configSnapshotSchema = z
  .object({
    targetConfig: z
      .object({
        minC: z.number().optional(),
        maxC: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .nullish(),
    requiredEvidence: z.array(z.string()).optional(),
  })
  .nullish();

/**
 * Evaluate a temperature reading against the frozen threshold. Returns true (pass) for non-temperature
 * checks, when no reading is supplied, or when no min/max bound is configured; false when the reading
 * is out of the configured [min, max] range (forces the fail path, §11.8).
 */
export function evaluateThresholdPass(
  checkType: string,
  configSnapshot: unknown,
  measuredNumeric: number | string | undefined,
): boolean {
  if (checkType !== "temperature" || measuredNumeric === undefined || measuredNumeric === null) {
    return true;
  }
  const parsed = configSnapshotSchema.safeParse(configSnapshot);
  const target = parsed.success ? parsed.data?.targetConfig : undefined;
  if (!target) return true;
  const min = target.minC ?? target.min;
  const max = target.maxC ?? target.max;
  const value = Number(measuredNumeric);
  if (Number.isNaN(value)) return true; // not a comparable reading — do not force fail on parse noise
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/** The required evidence types (from the frozen snapshot) not covered by the supplied evidence rows. */
export function missingRequiredEvidence(
  configSnapshot: unknown,
  evidence: EvidenceInput[],
): EvidenceType[] {
  const parsed = configSnapshotSchema.safeParse(configSnapshot);
  const required = (parsed.success ? parsed.data?.requiredEvidence : undefined) ?? [];
  if (required.length === 0) return [];
  const provided = new Set(evidence.map((e) => e.type));
  return required.filter((type) => !provided.has(type as EvidenceType)) as EvidenceType[];
}

// Occurrence statuses that are terminal WITHOUT a completion row (so submitCompletion would wrongly
// fresh-insert against them). We gate these up front; completed/completed_late/failed DO carry a
// completion, so submitCompletion classifies those correctly as replay (same key) or conflict.
const TERMINAL_NO_COMPLETION: ReadonlySet<OccurrenceStatus> = new Set<OccurrenceStatus>([
  "skipped",
  "cancelled",
]);

/**
 * Complete (or fail) an occurrence. Runs inside the caller withTenant() transaction. See the module
 * header for the F2/F3/F4 + threshold + fail-cascade guarantees. Returns a discriminated result the
 * Server Action maps to its HTTP-style contract (409/422 etc.); the role guard THROWS (403).
 */
export async function completeOccurrence(
  tx: TenantClient,
  input: CompleteOccurrenceInput,
): Promise<CompleteOccurrenceResult> {
  const now = input.now ?? new Date();

  // 1. Load the occurrence (RLS-scoped, non-deleted) for its config + status + cascade fields.
  const occ = await tx.taskOccurrence.findFirst({
    where: { id: input.occurrenceId, deletedAt: null },
    select: {
      status: true,
      checkType: true,
      configSnapshot: true,
      propertyId: true,
      outletId: true,
      scheduledTaskId: true,
      taskTemplateId: true,
      organizationId: true,
    },
  });
  if (!occ) return { status: "not_found", occurrenceId: input.occurrenceId };

  // 2. Role gate (F4/D7). complete/completeLate/fail share one role set, so the intent-level edge is
  //    sufficient even when a threshold breach later forces the fail target. Throws → the action 403s.
  assertRoleMayTrigger(
    "occurrence",
    input.intent === "fail" ? "fail" : "complete",
    input.actorRole,
  );

  // 3. State pre-gate for the statuses submitCompletion cannot classify:
  //    - pending: not yet due → not completable (the §7.1 completion edges start at due/overdue).
  //    - skipped/cancelled: terminal with NO completion row → would be a spurious fresh insert.
  //    completed/completed_late/failed fall through to submitCompletion, which returns the idempotent
  //    replay (same key) or the already-completed conflict (different key) correctly.
  if (occ.status === "pending") {
    return { status: "not_due", occurrenceId: input.occurrenceId, serverStatus: occ.status };
  }
  if (TERMINAL_NO_COMPLETION.has(occ.status)) {
    return {
      status: "already_completed",
      occurrenceId: input.occurrenceId,
      serverStatus: occ.status,
    };
  }

  // 4. Decide the result (a temperature breach forces fail even on a `complete` intent).
  const passByThreshold = evaluateThresholdPass(
    occ.checkType,
    occ.configSnapshot,
    input.measuredNumeric,
  );
  const result: CompletionResult = input.intent === "fail" || !passByThreshold ? "fail" : "pass";
  const forcedFail = input.intent === "complete" && result === "fail";

  // 5. Required-evidence gate (from the frozen snapshot) — before any insert (422).
  const missing = missingRequiredEvidence(occ.configSnapshot, input.evidence ?? []);
  if (missing.length > 0) return { status: "missing_evidence", missing };

  // 6. F2 idempotent completion write.
  const write = await submitCompletion(tx, {
    organizationId: input.organizationId,
    taskOccurrenceId: input.occurrenceId,
    clientSubmissionId: input.clientSubmissionId,
    result,
    completedBy: input.actorUserId,
    enteredValuesJson: input.enteredValuesJson,
    measuredNumeric: input.measuredNumeric,
    actorConfirmationMethod: input.actorConfirmationMethod,
    clientReportedAt: input.clientReportedAt,
    deviceMetaJson: input.deviceMetaJson,
  });

  if (write.status === "occurrence_not_found") {
    return { status: "not_found", occurrenceId: input.occurrenceId };
  }
  if (write.status === "idempotency_payload_mismatch") {
    return { status: "payload_mismatch", completionId: write.completionId };
  }
  if (write.status === "conflict") {
    return {
      status: "already_completed",
      occurrenceId: input.occurrenceId,
      serverStatus: write.serverStatus,
    };
  }
  // write.status === "ok"
  if (write.idempotentReplay) {
    // A retry of a prior successful submit: the occurrence already transitioned on the first call.
    // Return the existing completion (idempotent success) — no second insert, no re-transition.
    return {
      status: "ok",
      completionId: write.completionId,
      occurrenceStatus: occ.status,
      result,
      idempotentReplay: true,
      forcedFail,
    };
  }

  // 7. Fresh insert. Only due/overdue reach here (see step 3), so the completion edge is legal.
  const from = occ.status; // "due" | "overdue"
  const target: CompletionTransitionTarget =
    result === "fail" ? "failed" : from === "overdue" ? "completed_late" : "completed";

  // Attach evidence rows to the new completion (no status column → not an F4 concern).
  if (input.evidence && input.evidence.length > 0) {
    await tx.evidence.createMany({
      data: input.evidence.map((e) => ({
        organizationId: input.organizationId,
        taskCompletionId: write.completionId,
        type: e.type,
        valueText: e.valueText ?? null,
        valueNumeric: e.valueNumeric ?? null,
        valueBool: e.valueBool ?? null,
        attachmentId: e.attachmentId ?? null,
      })),
    });
  }

  // F4 status flip (atomic with its audit row).
  await applyOccurrenceCompletion(tx, {
    organizationId: input.organizationId,
    occurrenceId: input.occurrenceId,
    expectedFrom: from,
    target,
    actorUserId: input.actorUserId,
    completedAt: now,
  });

  // 8. Fail cascade: auto-open the Exception (idempotent per occurrence) + evaluate repeated deviation.
  let exceptionId: string | undefined;
  if (result === "fail") {
    const exception = await openException(
      tx,
      {
        organizationId: input.organizationId,
        propertyId: occ.propertyId,
        outletId: occ.outletId,
        taskOccurrenceId: input.occurrenceId,
        taskCompletionId: write.completionId,
        title: forcedFail ? "Task failed: reading out of threshold" : "Task failed",
        detail: input.reason,
        // A forced threshold breach (e.g. cold-chain) is critical; a manual fail defaults to normal.
        severity: forcedFail ? "critical" : "normal",
      },
      { actorUserId: input.actorUserId },
    );
    exceptionId = exception.id;

    await evaluateRepeatedDeviation(tx, {
      organizationId: input.organizationId,
      scheduledTaskId: occ.scheduledTaskId,
      taskTemplateId: occ.taskTemplateId,
      outletId: occ.outletId,
      triggeringOccurrenceId: input.occurrenceId,
      now,
    });
  }

  return {
    status: "ok",
    completionId: write.completionId,
    occurrenceStatus: target,
    result,
    idempotentReplay: false,
    forcedFail,
    exceptionId,
  };
}
