// Task detail + completion (#137). Deep-linkable occurrence view: the frozen template/threshold/required
// evidence, current status, completion history (§8.14), and the complete/fail/skip panel (when the task
// is still actionable). Membership is proven by the [org] layout; a cross-tenant / missing id is a 404.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { readOccurrenceDetail, isActionable } from "@/lib/occurrence-detail";
import { CompletionPanel } from "./CompletionPanel";

export default async function OccurrenceDetailPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx) notFound();

  const detail = await withTenant(ctx.organizationId, (tx) => readOccurrenceDetail(tx, id));
  if (!detail) notFound();

  const actionable = isActionable(detail.status);

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div>
        <Link
          href={`/${org}/today`}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Today
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {detail.templateTitle}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {detail.outletName} · {detail.checkType} · due {new Date(detail.dueAt).toLocaleString()}
        </p>
        <span className="mt-2 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {detail.status}
        </span>
      </div>

      {detail.instructions && (
        <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {detail.instructions}
        </p>
      )}

      {actionable ? (
        <CompletionPanel
          org={org}
          occurrence={{
            id: detail.id,
            outletId: detail.outletId,
            checkType: detail.checkType,
            requiredEvidence: detail.requiredEvidence,
            targetConfig: detail.targetConfig,
          }}
        />
      ) : (
        <p className="rounded-md border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          This task is {detail.status} and can no longer be changed here.
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">History</h2>
        {detail.completions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No completion recorded yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {detail.completions.map((c) => (
              <li key={c.id} className="px-4 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    v{c.version} · {c.result}
                    {c.isCurrent && <span className="ml-1 text-xs text-emerald-600">current</span>}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {new Date(c.recordedAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {c.completedBy}
                  {c.measuredNumeric != null ? ` · ${c.measuredNumeric}°C` : ""} · via{" "}
                  {c.actorConfirmationMethod}
                  {c.editReason ? ` · ${c.editReason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
