"use client";
// Dev-only "generate now" (#136). Materializes the occurrence window immediately (until the #20 Inngest
// cron lands) so a freshly-created schedule shows tasks on Today. Reports how many were created.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateNowAction } from "@/app/actions/schedules";

export function GenerateNowButton({ org }: { org: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setMsg(null);
    const result = await generateNowAction({ organizationId: org });
    setPending(false);
    if (result.status === "ok") {
      setMsg(`Generated ${result.created ?? 0} occurrence(s).`);
      router.refresh();
    } else {
      setMsg("Could not generate.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        {pending ? "Generating…" : "Generate now (dev)"}
      </button>
      {msg && <span className="text-xs text-zinc-500 dark:text-zinc-400">{msg}</span>}
    </div>
  );
}
