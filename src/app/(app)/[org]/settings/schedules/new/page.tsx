// New-schedule screen (#136). Author roles only; others 404.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { canManageSchedules } from "@/lib/permissions";
import { loadScheduleFormOptions } from "@/lib/schedules";
import { ScheduleForm } from "../ScheduleForm";

export default async function NewSchedulePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !canManageSchedules(ctx.role)) notFound();

  const options = await withTenant(ctx.organizationId, (tx) =>
    loadScheduleFormOptions(tx, ctx.propertyScope),
  );

  return (
    <div className="mx-auto w-full max-w-md">
      <Link
        href={`/${org}/settings/schedules`}
        className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Schedules
      </Link>
      <h1 className="mb-4 mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New schedule
      </h1>
      {options.templates.length === 0 || options.outlets.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          You need at least one active template and one outlet before creating a schedule.
        </p>
      ) : (
        <ScheduleForm
          org={org}
          mode="create"
          outlets={options.outlets}
          templates={options.templates}
          members={options.members}
        />
      )}
    </div>
  );
}
