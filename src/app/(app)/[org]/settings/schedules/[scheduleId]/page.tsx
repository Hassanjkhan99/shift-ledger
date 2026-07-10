// Schedule detail / edit (#136). Author roles only; others 404. Edit the schedule + activate/deactivate.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { canManageSchedules } from "@/lib/permissions";
import { getSchedule, loadScheduleFormOptions } from "@/lib/schedules";
import { ScheduleForm } from "../ScheduleForm";
import { ScheduleActiveButton } from "../ScheduleActiveButton";

export default async function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ org: string; scheduleId: string }>;
}) {
  const { org, scheduleId } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !canManageSchedules(ctx.role)) notFound();

  const { schedule, options } = await withTenant(ctx.organizationId, async (tx) => {
    const [schedule, options] = await Promise.all([
      getSchedule(tx, scheduleId),
      loadScheduleFormOptions(tx, ctx.propertyScope),
    ]);
    return { schedule, options };
  });
  if (!schedule) notFound();

  // A scoped manager may not open a schedule outside their property scope (#152); org-admins may (empty scope).
  const isOrgAdmin = ctx.role === "Owner" || ctx.role === "OrgAdmin";
  if (
    !isOrgAdmin &&
    ctx.propertyScope.length > 0 &&
    !ctx.propertyScope.includes(schedule.propertyId)
  ) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div>
        <Link
          href={`/${org}/settings/schedules`}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Schedules
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Edit schedule
          </h1>
          <ScheduleActiveButton org={org} scheduleId={schedule.id} active={schedule.isActive} />
        </div>
      </div>
      <ScheduleForm
        org={org}
        mode="edit"
        outlets={options.outlets}
        templates={options.templates}
        members={options.members}
        initial={{
          id: schedule.id,
          outletId: schedule.outletId,
          taskTemplateId: schedule.taskTemplateId,
          recurrence: schedule.recurrence,
          timezone: schedule.timezone,
          graceMinutes: schedule.graceMinutes,
          assigneeRole: schedule.assigneeRole,
          assigneeUserId: schedule.assigneeUserId,
          startsOn: schedule.startsOn,
          endsOn: schedule.endsOn,
        }}
      />
    </div>
  );
}
