"use client";
// Corrective actions (#138, §7.3). Create under an exception, then assign (user XOR role + due) → mark
// done → verify | reject. Only the edges legal from each CA's status AND permitted for the member's role
// are shown; the couple-cascades (last done → parent resolved; reject → parent reopened) are handled
// server-side. markDone carries an F2 clientSubmissionId.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OrgRole, CorrectiveStatus } from "@/generated/prisma/enums";
import { roleMayTrigger } from "@/lib/permissions";
import {
  createCorrectiveActionAction,
  assignCorrectiveActionAction,
  markCorrectiveActionDoneAction,
  verifyCorrectiveActionAction,
  rejectCorrectiveActionAction,
} from "@/app/actions/exceptions";

export interface CA {
  id: string;
  status: CorrectiveStatus;
  description: string;
  assigneeLabel: string | null;
  assigneeRole: OrgRole | null;
  dueAt: string | null;
}
interface Member {
  userId: string;
  label: string;
}

const ASSIGN_ROLES = ["KitchenManager", "ShiftLeader", "Staff", "PropertyManager"] as const;
const btn =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";
const inp =
  "block w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function CorrectiveActionsPanel({
  org,
  exceptionId,
  parentStatus,
  correctiveActions,
  role,
  members,
}: {
  org: string;
  exceptionId: string;
  parentStatus: string;
  correctiveActions: CA[];
  role: OrgRole;
  members: Member[];
}) {
  const router = useRouter();
  const [desc, setDesc] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(res: { status: string; message?: string }) {
    if (res.status === "forbidden") setError("You don’t have permission for that.");
    else if (res.status === "error") setError(res.message ?? "Action failed.");
    else if (res.status === "validation") setError("Please check the inputs.");
    else setError("Action failed.");
  }

  async function createCa() {
    setError(null);
    if (!desc.trim()) return;
    setPending(true);
    const res = await createCorrectiveActionAction({
      organizationId: org,
      exceptionId,
      description: desc.trim(),
    });
    setPending(false);
    if (res.status === "ok") {
      setDesc("");
      router.refresh();
    } else fail(res);
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Corrective actions
      </h2>
      {correctiveActions.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">None yet.</p>
      ) : (
        <ul className="space-y-3">
          {correctiveActions.map((ca) => (
            <CaRow
              key={ca.id}
              org={org}
              exceptionId={exceptionId}
              parentStatus={parentStatus}
              ca={ca}
              role={role}
              members={members}
              onError={setError}
            />
          ))}
        </ul>
      )}

      {roleMayTrigger("correctiveAction", "create", role) && (
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            disabled={pending}
            placeholder="New corrective action…"
            className={inp}
          />
          <button
            type="button"
            onClick={createCa}
            disabled={pending || !desc.trim()}
            className={btn}
          >
            Add
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

function CaRow({
  org,
  exceptionId,
  parentStatus,
  ca,
  role,
  members,
  onError,
}: {
  org: string;
  exceptionId: string;
  parentStatus: string;
  ca: CA;
  role: OrgRole;
  members: Member[];
  onError: (m: string | null) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignMode, setAssignMode] = useState<"role" | "user">("role");
  const [assignRole, setAssignRole] = useState<string>("KitchenManager");
  const [assignUser, setAssignUser] = useState(members[0]?.userId ?? "");
  const [dueAt, setDueAt] = useState("");

  // assignCorrectiveAction requires the parent to be acknowledged/in_progress — don't offer Assign
  // before the acknowledge step (incl. the reject → reopened rework path), or it always fails (#160).
  const parentReady = parentStatus === "acknowledged" || parentStatus === "in_progress";
  const canAssign =
    ["open", "rejected"].includes(ca.status) &&
    parentReady &&
    roleMayTrigger("correctiveAction", "assign", role);
  const canDone = ca.status === "assigned" && roleMayTrigger("correctiveAction", "markDone", role);
  const canVerify = ca.status === "done" && roleMayTrigger("correctiveAction", "verify", role);
  const canReject = ca.status === "done" && roleMayTrigger("correctiveAction", "reject", role);

  async function call(fn: () => Promise<{ status: string; message?: string }>) {
    onError(null);
    setPending(true);
    const res = await fn();
    setPending(false);
    if (res.status === "ok") {
      setAssigning(false);
      router.refresh();
    } else onError(res.status === "forbidden" ? "Not allowed." : (res.message ?? "Action failed."));
  }

  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm text-zinc-900 dark:text-zinc-100">
            {ca.description}
          </span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {ca.status}
            {ca.assigneeLabel || ca.assigneeRole ? ` · ${ca.assigneeLabel ?? ca.assigneeRole}` : ""}
            {ca.dueAt ? ` · due ${ca.dueAt.slice(0, 10)}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 gap-2">
          {canAssign && (
            <button
              type="button"
              onClick={() => setAssigning((v) => !v)}
              disabled={pending}
              className={btn}
            >
              Assign
            </button>
          )}
          {canDone && (
            <button
              type="button"
              disabled={pending}
              className={btn}
              onClick={() =>
                call(() =>
                  markCorrectiveActionDoneAction({
                    organizationId: org,
                    exceptionId,
                    correctiveActionId: ca.id,
                    clientSubmissionId: crypto.randomUUID(),
                  }),
                )
              }
            >
              Mark done
            </button>
          )}
          {canVerify && (
            <button
              type="button"
              disabled={pending}
              className={btn}
              onClick={() =>
                call(() =>
                  verifyCorrectiveActionAction({
                    organizationId: org,
                    exceptionId,
                    correctiveActionId: ca.id,
                  }),
                )
              }
            >
              Verify
            </button>
          )}
          {canReject && (
            <button
              type="button"
              disabled={pending}
              className={btn}
              onClick={() =>
                call(() =>
                  rejectCorrectiveActionAction({
                    organizationId: org,
                    exceptionId,
                    correctiveActionId: ca.id,
                  }),
                )
              }
            >
              Reject
            </button>
          )}
        </span>
      </div>

      {assigning && canAssign && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={assignMode}
            onChange={(e) => setAssignMode(e.target.value as "role" | "user")}
            className={inp + " max-w-[7rem]"}
          >
            <option value="role">Role</option>
            <option value="user">User</option>
          </select>
          {assignMode === "role" ? (
            <select
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
              className={inp + " max-w-[10rem]"}
            >
              {ASSIGN_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={assignUser}
              onChange={(e) => setAssignUser(e.target.value)}
              className={inp + " max-w-[12rem]"}
            >
              {members.length === 0 && <option value="">No members</option>}
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className={inp + " max-w-[10rem]"}
          />
          <button
            type="button"
            disabled={pending || !dueAt}
            className={btn}
            onClick={() =>
              call(() =>
                assignCorrectiveActionAction({
                  organizationId: org,
                  exceptionId,
                  correctiveActionId: ca.id,
                  assigneeRole: assignMode === "role" ? assignRole : null,
                  assigneeUserId: assignMode === "user" ? assignUser : null,
                  dueAt: new Date(`${dueAt}T00:00:00Z`).toISOString(),
                }),
              )
            }
          >
            Save
          </button>
        </div>
      )}
    </li>
  );
}
