// Schedules list (#136). Author roles only (Owner/OrgAdmin/PropertyManager/KitchenManager); others 404.
// Shows each schedule with its template + outlet, plus a dev "generate now" trigger.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { canManageSchedules } from "@/lib/permissions";
import { listSchedules, loadScheduleFormOptions } from "@/lib/schedules";
import { GenerateNowButton } from "./GenerateNowButton";

export default async function SchedulesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !canManageSchedules(ctx.role)) notFound();

  // Org-admins see every schedule; scoped managers only their properties' (#152). generate-now is
  // org-wide, so it's admin-only.
  const isOrgAdmin = ctx.role === "Owner" || ctx.role === "OrgAdmin";
  const { schedules, options } = await withTenant(ctx.organizationId, async (tx) => {
    const [schedules, options] = await Promise.all([
      listSchedules(tx, isOrgAdmin ? [] : ctx.propertyScope),
      loadScheduleFormOptions(tx, ctx.propertyScope),
    ]);
    return { schedules, options };
  });
  const templateTitle = new Map(options.templates.map((t) => [t.id, t.title]));
  const outletLabel = new Map(options.outlets.map((o) => [o.id, o.label]));

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Schedules
        </h1>
        <div className="flex items-center gap-2">
          {isOrgAdmin && <GenerateNowButton org={org} />}
          <Link
            href={`/${org}/settings/schedules/new`}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            New schedule
          </Link>
        </div>
      </div>

      {schedules.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No schedules yet. Create one (needs a template + outlet) to start generating tasks.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {schedules.map((s) => (
            <li key={s.id}>
              <Link
                href={`/${org}/settings/schedules/${s.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {templateTitle.get(s.taskTemplateId) ?? "—"}
                  </span>
                  <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {outletLabel.get(s.outletId) ?? "—"} · {s.recurrence.freq} ·{" "}
                    {s.recurrence.timeOfDay}
                  </span>
                </span>
                {!s.isActive && (
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
