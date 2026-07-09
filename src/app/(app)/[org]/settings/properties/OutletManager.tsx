"use client";
// Outlet (kitchen) management for a property (#133). Lists active outlets and — when the current member
// may manage this property's outlets (D7: Owner/OrgAdmin, or a PropertyManager in scope) — lets them add,
// rename, and archive. Writes go through the sites Server Actions; after each we router.refresh() so the
// RSC list re-reads. Unique-per-property name clashes surface inline.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createOutletAction, updateOutletAction, archiveOutletAction } from "@/app/actions/sites";
import { inputClass, FormError } from "@/app/(auth)/ui";

export interface OutletRow {
  id: string;
  name: string;
}

const smallBtn =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

export function OutletManager({
  org,
  propertyId,
  outlets,
  canManage,
}: {
  org: string;
  propertyId: string;
  outlets: OutletRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function messageFor(status: string): string {
    if (status === "conflict") return "An outlet with this name already exists.";
    if (status === "forbidden") return "You don’t have permission to manage these outlets.";
    if (status === "not-found") return "That outlet or property no longer exists.";
    if (status === "validation") return "Please check the name and try again.";
    return "Something went wrong. Please try again.";
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!newName.trim()) return;
    setPending(true);
    const result = await createOutletAction({
      organizationId: org,
      propertyId,
      name: newName.trim(),
    });
    setPending(false);
    if (result.status === "ok") {
      setNewName("");
      router.refresh();
    } else {
      setError(messageFor(result.status));
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Outlets</h2>
      {outlets.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No outlets yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {outlets.map((o) => (
            <OutletItem key={o.id} org={org} outlet={o} canManage={canManage} onError={setError} />
          ))}
        </ul>
      )}

      {canManage && (
        <form onSubmit={onAdd} className="mt-4 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={pending}
            className={inputClass}
            placeholder="New outlet name (e.g. Main Kitchen)"
          />
          <button type="submit" disabled={pending || !newName.trim()} className={smallBtn}>
            Add
          </button>
        </form>
      )}
      <div className="mt-2">
        <FormError message={error} />
      </div>
    </div>
  );
}

function OutletItem({
  org,
  outlet,
  canManage,
  onError,
}: {
  org: string;
  outlet: OutletRow;
  canManage: boolean;
  onError: (m: string | null) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(outlet.name);
  const [pending, setPending] = useState(false);

  async function onSave() {
    onError(null);
    if (!name.trim() || name.trim() === outlet.name) return;
    setPending(true);
    const result = await updateOutletAction({
      organizationId: org,
      outletId: outlet.id,
      name: name.trim(),
    });
    setPending(false);
    if (result.status === "ok") router.refresh();
    else
      onError(
        result.status === "conflict"
          ? "An outlet with this name already exists."
          : "Could not rename the outlet.",
      );
  }

  async function onArchive() {
    onError(null);
    setPending(true);
    const result = await archiveOutletAction({ organizationId: org, outletId: outlet.id });
    setPending(false);
    if (result.status === "ok") router.refresh();
    else onError("Could not archive the outlet.");
  }

  if (!canManage) {
    return <li className="py-2 text-sm text-zinc-700 dark:text-zinc-300">{outlet.name}</li>;
  }

  return (
    <li className="flex items-center gap-2 py-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={pending}
        className={inputClass}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={pending || !name.trim() || name.trim() === outlet.name}
        className={smallBtn}
      >
        Save
      </button>
      <button type="button" onClick={onArchive} disabled={pending} className={smallBtn}>
        Archive
      </button>
    </li>
  );
}
