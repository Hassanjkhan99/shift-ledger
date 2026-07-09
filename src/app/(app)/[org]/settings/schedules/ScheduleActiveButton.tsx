"use client";
// Activate / deactivate a schedule (#136). Deactivating stops future generation (#8 skips inactive).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setScheduleActiveAction } from "@/app/actions/schedules";

export function ScheduleActiveButton({
  org,
  scheduleId,
  active,
}: {
  org: string;
  scheduleId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onToggle() {
    setPending(true);
    await setScheduleActiveAction({ organizationId: org, scheduleId, active: !active });
    setPending(false);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      {pending ? "…" : active ? "Deactivate" : "Reactivate"}
    </button>
  );
}
