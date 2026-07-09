// Exceptions list (#138). The notification badge links here. Triage reads are ShiftLeader+ (Staff is
// excluded, matching the badge scope); read-only roles (Auditor/ExternalInspector) may view. Keyset-
// paginated (F5, cursor seek) with an optional status filter via ?status=.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { listExceptions } from "@/lib/exceptions-read";
import { ExceptionStatus } from "@/generated/prisma/enums";

const STATUSES = Object.values(ExceptionStatus) as ExceptionStatus[];

function parseStatus(v: string | undefined): ExceptionStatus | undefined {
  return v && (STATUSES as string[]).includes(v) ? (v as ExceptionStatus) : undefined;
}

export default async function ExceptionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { org } = await params;
  const { status: statusParam, cursor } = await searchParams;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || ctx.role === "Staff") notFound();

  const status = parseStatus(statusParam);
  const page = await withTenant(ctx.organizationId, (tx) => listExceptions(tx, { status, cursor }));

  const filterHref = (s?: string) => `/${org}/exceptions${s ? `?status=${s}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Exceptions
      </h1>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          href={filterHref()}
          className={`rounded-full border px-2 py-0.5 ${!status ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={filterHref(s)}
            className={`rounded-full border px-2 py-0.5 ${status === s ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
          >
            {s}
          </Link>
        ))}
      </div>

      {page.items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No exceptions.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {page.items.map((e) => (
            <li key={e.id}>
              <Link
                href={`/${org}/exceptions/${e.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {e.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {e.outletName} · {new Date(e.openedAt).toLocaleString()}
                  </span>
                </span>
                <span className="ml-2 flex shrink-0 items-center gap-2">
                  {e.severity !== "normal" && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
                      {e.severity}
                    </span>
                  )}
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {e.status}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor && (
        <div className="mt-4 text-center">
          <Link
            href={`/${org}/exceptions?${status ? `status=${status}&` : ""}cursor=${encodeURIComponent(page.nextCursor)}`}
            className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
          >
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
