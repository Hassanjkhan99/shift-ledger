"use client";
// Request an audit-pack export (#139). A date range (optional — omit for everything); the pack embeds the
// activity_log hash-chain head as integrity proof (§F6). On success the job appears in the list, polling
// to completed.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { enqueueExportAction } from "@/app/actions/exports";
import { cardClass, labelClass, inputClass, buttonClass, FormError } from "@/app/(auth)/ui";

export function ExportRequestForm({ org }: { org: string }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await enqueueExportAction({
      organizationId: org,
      from: from || undefined,
      to: to || undefined,
    });
    setPending(false);
    if (res.status === "ok") {
      setFrom("");
      setTo("");
      router.refresh();
    } else if (res.status === "validation") setError("Check the date range.");
    else if (res.status === "unauthorized") setError("Please sign in again.");
    else setError("Could not request the export.");
  }

  return (
    <form className={cardClass} onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="exp-from" className={labelClass}>
              From <span className="text-zinc-400">(optional)</span>
            </label>
            <input
              id="exp-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="exp-to" className={labelClass}>
              To <span className="text-zinc-400">(optional)</span>
            </label>
            <input
              id="exp-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
        </div>
        <FormError message={error} />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Requesting…" : "Request audit pack"}
        </button>
      </div>
    </form>
  );
}
