"use client";
// Dev-only "process now" (#139) — runs the export worker for a queued job until the Inngest runtime (#20)
// lands. Requires R2 to be configured; surfaces the error otherwise rather than failing silently.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { processExportNowAction } from "@/app/actions/exports";

export function ProcessJobButton({ org, jobId }: { org: string; jobId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setPending(true);
    const res = await processExportNowAction({ organizationId: org, jobId });
    setPending(false);
    if (res.status === "ok") router.refresh();
    else setError(res.status === "error" ? res.message : "Failed");
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        {pending ? "Processing…" : "Process now (dev)"}
      </button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}
