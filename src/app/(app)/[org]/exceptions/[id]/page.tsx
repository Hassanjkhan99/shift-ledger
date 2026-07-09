// Exception detail + triage (#138). The §7.2 exception edges and §7.3 corrective-action workflow, gated
// by the member's role. ShiftLeader+ only (Staff 404s); read-only roles see the state but no edges are
// permitted to them. A cross-tenant / missing id is a 404.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { getExceptionDetail } from "@/lib/exceptions-read";
import { listMembers } from "@/lib/members";
import { ExceptionTriage } from "./ExceptionTriage";
import { CorrectiveActionsPanel } from "./CorrectiveActionsPanel";

export default async function ExceptionDetailPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || ctx.role === "Staff") notFound();

  const { detail, members } = await withTenant(ctx.organizationId, async (tx) => {
    const detail = await getExceptionDetail(tx, id);
    const members = detail ? await listMembers(tx) : [];
    return { detail, members };
  });
  if (!detail) notFound();

  const memberOptions = members
    .filter((m) => m.status === "active")
    .map((m) => ({ userId: m.userId, label: m.name ?? m.email }));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          href={`/${org}/exceptions`}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Exceptions
        </Link>
        <div className="mt-2 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {detail.title}
          </h1>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {detail.status}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {detail.outletName} · opened {new Date(detail.openedAt).toLocaleString()}
          {detail.severity !== "normal" ? ` · ${detail.severity}` : ""}
        </p>
        {detail.detail && (
          <p className="mt-2 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {detail.detail}
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-400">
          <Link href={`/${org}/occurrences/${detail.occurrenceId}`} className="underline">
            View the task this came from →
          </Link>
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Triage</h2>
        <ExceptionTriage org={org} exceptionId={detail.id} status={detail.status} role={ctx.role} />
      </div>

      <CorrectiveActionsPanel
        org={org}
        exceptionId={detail.id}
        correctiveActions={detail.correctiveActions}
        role={ctx.role}
        members={memberOptions}
      />
    </div>
  );
}
