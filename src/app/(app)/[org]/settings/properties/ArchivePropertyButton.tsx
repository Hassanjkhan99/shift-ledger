"use client";
// Archive-property control (#133). Soft-deletes the property (archivePropertyAction -> deleted_at); the
// occurrence generator (#8) then skips it and it drops out of the active list. Confirms first since it
// removes the site from day-to-day use. On success we navigate back to the properties list.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { archivePropertyAction } from "@/app/actions/sites";

export function ArchivePropertyButton({ org, propertyId }: { org: string; propertyId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onArchive() {
    if (!window.confirm("Archive this property? It will stop generating new tasks.")) return;
    setError(null);
    setPending(true);
    const result = await archivePropertyAction({ organizationId: org, propertyId });
    if (result.status === "ok") {
      router.push(`/${org}/settings/properties`);
      router.refresh();
      return;
    }
    setPending(false);
    setError(result.status === "forbidden" ? "You don’t have permission." : "Could not archive.");
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={onArchive}
        disabled={pending}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
      >
        {pending ? "Archiving…" : "Archive property"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
