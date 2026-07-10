"use client";
// Task-template create/edit form (#135). check_type drives whether the temperature threshold editor
// (min/max °C) shows. required_evidence is a multiselect over the evidence types. Copy notes that edits
// don't re-judge already-materialized occurrences (they carry a frozen config snapshot, §8.13).
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckType, EvidenceType } from "@/generated/prisma/enums";
import { createTemplateAction, updateTemplateAction } from "@/app/actions/templates";
import { cardClass, labelClass, inputClass, buttonClass, FormError } from "@/app/(auth)/ui";

const CHECK_TYPES = Object.values(CheckType) as CheckType[];
const EVIDENCE_TYPES = Object.values(EvidenceType) as EvidenceType[];

export interface TemplateInitial {
  id: string;
  title: string;
  checkType: CheckType;
  requiredEvidence: EvidenceType[];
  targetConfig: { minC?: number; maxC?: number } | null;
  instructions: string | null;
}

export function TemplateForm({
  org,
  mode,
  initial,
}: {
  org: string;
  mode: "create" | "edit";
  initial?: TemplateInitial;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [checkType, setCheckType] = useState<CheckType>(initial?.checkType ?? CheckType.generic);
  const [evidence, setEvidence] = useState<Set<EvidenceType>>(
    new Set(initial?.requiredEvidence ?? []),
  );
  const [minC, setMinC] = useState(initial?.targetConfig?.minC?.toString() ?? "");
  const [maxC, setMaxC] = useState(initial?.targetConfig?.maxC?.toString() ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isTemp = checkType === CheckType.temperature;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Enter a title.");
      return;
    }
    if (isTemp && (minC === "" || maxC === "")) {
      setError("Temperature templates need a min and max °C.");
      return;
    }
    setPending(true);
    const payload = {
      organizationId: org,
      title: title.trim(),
      checkType,
      requiredEvidence: [...evidence],
      instructions: instructions.trim() || undefined,
      minC: isTemp ? Number(minC) : undefined,
      maxC: isTemp ? Number(maxC) : undefined,
    };
    const result =
      mode === "create"
        ? await createTemplateAction(payload)
        : await updateTemplateAction({ ...payload, templateId: initial!.id });
    if (result.status === "ok") {
      router.push(`/${org}/settings/templates`);
      router.refresh();
      return;
    }
    setPending(false);
    if (result.status === "validation")
      setError("Please check the fields (min ≤ max for temperature).");
    else if (result.status === "forbidden")
      setError("You don’t have permission to manage templates.");
    else if (result.status === "not-found") setError("This template no longer exists.");
    else if (result.status === "check-type-locked")
      setError("This template is used by a schedule; its check type can’t be changed.");
    else setError("Could not save the template.");
  }

  return (
    <form className={cardClass} onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="tpl-title" className={labelClass}>
            Title
          </label>
          <input
            id="tpl-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
            className={inputClass}
            placeholder="Fridge temperature check"
          />
        </div>
        <div>
          <label htmlFor="tpl-type" className={labelClass}>
            Check type
          </label>
          <select
            id="tpl-type"
            value={checkType}
            onChange={(e) => setCheckType(e.target.value as CheckType)}
            disabled={pending}
            className={inputClass}
          >
            {CHECK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {isTemp && (
          <div className="flex gap-4">
            <div className="flex-1">
              <label htmlFor="tpl-min" className={labelClass}>
                Min °C
              </label>
              <input
                id="tpl-min"
                type="number"
                step="0.1"
                value={minC}
                onChange={(e) => setMinC(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label htmlFor="tpl-max" className={labelClass}>
                Max °C
              </label>
              <input
                id="tpl-max"
                type="number"
                step="0.1"
                value={maxC}
                onChange={(e) => setMaxC(e.target.value)}
                disabled={pending}
                className={inputClass}
              />
            </div>
          </div>
        )}
        <div>
          <span className={labelClass}>Required evidence</span>
          <div className="mt-1 flex flex-wrap gap-3">
            {EVIDENCE_TYPES.map((ev) => (
              <label
                key={ev}
                className="flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="checkbox"
                  checked={evidence.has(ev)}
                  disabled={pending}
                  onChange={() =>
                    setEvidence((prev) => {
                      const next = new Set(prev);
                      if (next.has(ev)) next.delete(ev);
                      else next.add(ev);
                      return next;
                    })
                  }
                />
                {ev}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="tpl-instructions" className={labelClass}>
            Instructions <span className="text-zinc-400">(optional)</span>
          </label>
          <textarea
            id="tpl-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={pending}
            rows={3}
            className={inputClass}
          />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Editing a template does not change tasks that were already generated — they keep the
          settings they were created with.
        </p>
        <FormError message={error} />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : mode === "create" ? "Create template" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
