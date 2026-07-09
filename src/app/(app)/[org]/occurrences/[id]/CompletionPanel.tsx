"use client";
// Task completion panel (#137). Complete / fail / skip an occurrence with the value-evidence the template
// requires and (for temperature) a measured reading. Wraps the tested #17 Server Actions and surfaces
// their outcomes: missing-evidence (422), threshold-forced fail, already-completed (409). Actor is the
// session user (shared-tablet PIN/initials picker + binary photo/file capture are follow-ups — a task
// requiring photo/file evidence will report it as missing here until that widget lands).
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EvidenceType } from "@/generated/prisma/enums";
import { completeTaskAction, skipTaskAction } from "@/app/actions/occurrences";
import { inputClass, labelClass, FormError } from "@/app/(auth)/ui";

interface Detail {
  id: string;
  outletId: string;
  checkType: string;
  requiredEvidence: EvidenceType[];
  targetConfig: { minC?: number; maxC?: number } | null;
}

const VALUE_EVIDENCE: ReadonlySet<string> = new Set([
  "note",
  "initials",
  "signature",
  "checkbox",
  "temperature",
]);

export function CompletionPanel({ org, occurrence }: { org: string; occurrence: Detail }) {
  const router = useRouter();
  const [measured, setMeasured] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isTemp = occurrence.checkType === "temperature";
  const binaryRequired = occurrence.requiredEvidence.filter((t) => !VALUE_EVIDENCE.has(t));

  function buildEvidence() {
    return occurrence.requiredEvidence
      .map((type) => {
        if (type === "checkbox") return { type, valueBool: checks[type] ?? false };
        if (type === "temperature") return { type, valueNumeric: measured };
        if (VALUE_EVIDENCE.has(type)) {
          const v = values[type]?.trim();
          return v ? { type, valueText: v } : null;
        }
        return null; // binary (photo/file) — capture widget is a follow-up
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }

  function surface(status: string, missing?: EvidenceType[]) {
    if (status === "missing_evidence")
      setError(`Missing required evidence: ${(missing ?? []).join(", ")}`);
    else if (status === "already_completed") setError("This task has already been completed.");
    else if (status === "not_due") setError("This task is not due yet.");
    else if (status === "not_found") setError("This task no longer exists.");
    else if (status === "forbidden") setError("You don’t have permission to do that.");
    else if (status === "validation") setError("Please check your entries.");
    else if (status === "unauthorized") setError("Please sign in again.");
    else setError("Something went wrong. Please try again.");
  }

  async function submit(intent: "complete" | "fail") {
    setError(null);
    setOk(null);
    if (intent === "fail" && !reason.trim()) {
      setError("A failure needs a reason.");
      return;
    }
    setPending(true);
    const res = await completeTaskAction({
      organizationId: org,
      occurrenceId: occurrence.id,
      outletId: occurrence.outletId,
      clientSubmissionId: crypto.randomUUID(),
      intent,
      measuredNumeric: isTemp && measured !== "" ? measured : undefined,
      evidence: buildEvidence(),
      reason: intent === "fail" ? reason.trim() : undefined,
    });
    setPending(false);
    if (res.status === "ok") {
      setOk(
        res.forcedFail
          ? "Reading out of range — recorded as failed and an exception was opened."
          : res.result === "fail"
            ? "Recorded as failed — an exception was opened."
            : "Task completed.",
      );
      router.refresh();
      return;
    }
    surface(res.status, "missing" in res ? res.missing : undefined);
  }

  async function skip() {
    setError(null);
    setOk(null);
    if (!reason.trim()) {
      setError("A skip needs a reason.");
      return;
    }
    setPending(true);
    const res = await skipTaskAction({
      organizationId: org,
      occurrenceId: occurrence.id,
      outletId: occurrence.outletId,
      reason: reason.trim(),
    });
    setPending(false);
    if (res.status === "skipped") {
      setOk("Task skipped.");
      router.refresh();
      return;
    }
    surface(res.status);
  }

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      {isTemp && (
        <div>
          <label htmlFor="cp-measured" className={labelClass}>
            Measured °C
            {occurrence.targetConfig && (
              <span className="ml-1 text-xs text-zinc-400">
                (target {occurrence.targetConfig.minC}–{occurrence.targetConfig.maxC})
              </span>
            )}
          </label>
          <input
            id="cp-measured"
            type="number"
            step="0.1"
            value={measured}
            onChange={(e) => setMeasured(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>
      )}

      {occurrence.requiredEvidence.map((type) => {
        if (type === "temperature") return null; // captured by the measured field
        if (type === "checkbox") {
          return (
            <label
              key={type}
              className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <input
                type="checkbox"
                checked={checks[type] ?? false}
                disabled={pending}
                onChange={(e) => setChecks((p) => ({ ...p, [type]: e.target.checked }))}
              />
              Confirmed
            </label>
          );
        }
        if (VALUE_EVIDENCE.has(type)) {
          return (
            <div key={type}>
              <label htmlFor={`cp-${type}`} className={labelClass}>
                {type}
              </label>
              <input
                id={`cp-${type}`}
                type="text"
                value={values[type] ?? ""}
                disabled={pending}
                onChange={(e) => setValues((p) => ({ ...p, [type]: e.target.value }))}
                className={inputClass}
              />
            </div>
          );
        }
        return null;
      })}

      {binaryRequired.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This task requires {binaryRequired.join(", ")} evidence. Photo/file capture is coming
          soon; until then this task can’t be completed here.
        </p>
      )}

      <div>
        <label htmlFor="cp-reason" className={labelClass}>
          Reason <span className="text-zinc-400">(required to fail or skip)</span>
        </label>
        <input
          id="cp-reason"
          type="text"
          value={reason}
          disabled={pending}
          onChange={(e) => setReason(e.target.value)}
          className={inputClass}
        />
      </div>

      <FormError message={error} />
      {ok && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        >
          {ok}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => submit("complete")}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Complete
        </button>
        <button
          type="button"
          onClick={() => submit("fail")}
          disabled={pending}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Fail
        </button>
        <button
          type="button"
          onClick={skip}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Skip
        </button>
      </div>
      <p className="text-xs text-zinc-400">Recorded as you (session actor).</p>
    </div>
  );
}
