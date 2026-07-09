// Exports (#139) — request an audit pack (date range) and download completed ones. Any active member,
// including read-only Auditor / ExternalInspector (D7). Membership is proven by the [org] layout; the
// signed download route (/api/exports/[id]/download) re-checks tenancy and 404s cross-tenant jobs.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { listExportJobs } from "@/lib/exports-read";
import { ExportRequestForm } from "./ExportRequestForm";
import { ProcessJobButton } from "./ProcessJobButton";

export default async function ExportsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx) notFound();

  const jobs = await withTenant(ctx.organizationId, (tx) => listExportJobs(tx));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Export audit packs
      </h1>

      <ExportRequestForm org={org} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Recent exports
        </h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No export jobs yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {j.filters.from || j.filters.to
                      ? `${j.filters.from?.slice(0, 10) ?? "…"} → ${j.filters.to?.slice(0, 10) ?? "…"}`
                      : "All records"}
                  </span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(j.createdAt).toLocaleString()}
                    {j.error ? ` · ${j.error}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {j.status}
                  </span>
                  {j.downloadable && (
                    <a
                      href={`/api/exports/${j.id}/download`}
                      className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      Download
                    </a>
                  )}
                  {(j.status === "queued" || j.status === "failed") && (
                    <ProcessJobButton org={org} jobId={j.id} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
