"use client";
// Exception triage controls (#138, §7.2). Shows only the edges legal from the current status AND
// permitted for the member's role (roleMayTrigger). Each button routes through the corresponding
// role-gated Server Action; the server re-checks everything. A shared reason field feeds edges that
// take one (the server enforces where a reason is mandatory).
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OrgRole, ExceptionStatus } from "@/generated/prisma/enums";
import { roleMayTrigger } from "@/lib/permissions";
import {
  acknowledgeExceptionAction,
  startExceptionProgressAction,
  resolveExceptionAction,
  verifyExceptionAction,
  reopenExceptionAction,
} from "@/app/actions/exceptions";

type Edge = "acknowledge" | "startProgress" | "resolve" | "verify" | "reopen";

const EDGES_FROM: Record<ExceptionStatus, Edge[]> = {
  open: ["acknowledge"],
  reopened: ["acknowledge"],
  acknowledged: ["startProgress"],
  in_progress: ["resolve"],
  resolved: ["verify", "reopen"],
  verified: ["reopen"],
};

const LABEL: Record<Edge, string> = {
  acknowledge: "Acknowledge",
  startProgress: "Start progress",
  resolve: "Resolve",
  verify: "Verify",
  reopen: "Reopen",
};

const btn =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

export function ExceptionTriage({
  org,
  exceptionId,
  status,
  role,
  hasOpenCorrectiveActions,
}: {
  org: string;
  exceptionId: string;
  status: ExceptionStatus;
  role: OrgRole;
  hasOpenCorrectiveActions: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edges = (EDGES_FROM[status] ?? [])
    .filter((e) => roleMayTrigger("exception", e, role))
    // Resolve is rejected server-side while any CA is still open — don't offer it then (#160).
    .filter((e) => e !== "resolve" || !hasOpenCorrectiveActions);
  if (edges.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        No triage actions available to you for a {status} exception.
      </p>
    );
  }

  async function trigger(edge: Edge) {
    setError(null);
    setPending(true);
    const payload = { organizationId: org, exceptionId, reason: reason.trim() || undefined };
    const actions = {
      acknowledge: acknowledgeExceptionAction,
      startProgress: startExceptionProgressAction,
      resolve: resolveExceptionAction,
      verify: verifyExceptionAction,
      reopen: reopenExceptionAction,
    } as const;
    const res = await actions[edge](payload);
    setPending(false);
    if (res.status === "ok") {
      setReason("");
      router.refresh();
    } else if (res.status === "forbidden") setError("You don’t have permission for that.");
    else if (res.status === "error") setError(res.message);
    else setError("Could not complete that action.");
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
        placeholder="Reason (required for some actions)"
        className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <div className="flex flex-wrap gap-2">
        {edges.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => trigger(e)}
            disabled={pending}
            className={btn}
          >
            {LABEL[e]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
