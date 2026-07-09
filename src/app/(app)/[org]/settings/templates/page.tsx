// Task templates list (#135). Author roles (Owner/OrgAdmin/PropertyManager/KitchenManager) only; others
// 404. Shows active + inactive templates; inactive are excluded from the schedule picker but kept here.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { canManageTemplates } from "@/lib/permissions";
import { listTemplates } from "@/lib/templates";

export default async function TemplatesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !canManageTemplates(ctx.role)) notFound();

  const templates = await withTenant(ctx.organizationId, (tx) =>
    listTemplates(tx, { includeInactive: true }),
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Task templates
        </h1>
        <Link
          href={`/${org}/settings/templates/new`}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          New template
        </Link>
      </div>

      {templates.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No templates yet. Create one to start scheduling checks.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                href={`/${org}/settings/templates/${t.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {t.checkType}
                    {t.targetConfig?.minC !== undefined && t.targetConfig?.maxC !== undefined
                      ? ` · ${t.targetConfig.minC}–${t.targetConfig.maxC}°C`
                      : ""}
                    {t.requiredEvidence.length > 0 ? ` · ${t.requiredEvidence.join(", ")}` : ""}
                  </span>
                </span>
                {!t.isActive && (
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    inactive
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
