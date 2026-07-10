"use client";
// Activate / deactivate a template (#135). Deactivated templates are hidden from the schedule picker but
// stay referenced by history. Refreshes the RSC on success.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setTemplateActiveAction } from "@/app/actions/templates";

export function TemplateActiveButton({
  org,
  templateId,
  active,
}: {
  org: string;
  templateId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onToggle() {
    setPending(true);
    await setTemplateActiveAction({ organizationId: org, templateId, active: !active });
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
