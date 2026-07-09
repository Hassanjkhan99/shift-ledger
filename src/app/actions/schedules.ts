"use server";
// Scheduling Server Actions (#136). Zod-validated (RecurrenceSchema + assignee XOR + grace 0–60),
// session-authenticated, D7-gated (Owner/OrgAdmin/PropertyManager/KitchenManager) writes over
// schedules.ts. Includes a dev-only "generate now" so a new schedule produces Today's occurrences
// before the Inngest generation runtime (#20) lands.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { resolveMemberForOrg, type MemberContext } from "@/lib/http-auth";
import { canManageSchedules } from "@/lib/permissions";
import { createSchedule, updateSchedule, setScheduleActive, generateNow } from "@/lib/schedules";
import {
  createScheduleInput,
  updateScheduleInput,
  setScheduleActiveInput,
  generateNowInput,
} from "@/lib/schedule-input";

export type ScheduleActionResult =
  | { status: "ok"; id?: string; created?: number }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "invalid-assignee" }
  | { status: "validation"; issues: unknown[] };

async function ctxFor(organizationId: string): Promise<MemberContext | null> {
  return resolveMemberForOrg((await headers()) as unknown as Headers, organizationId);
}

function revalidateSchedules(org: string, id?: string): void {
  revalidatePath(`/${org}/settings/schedules`);
  if (id) revalidatePath(`/${org}/settings/schedules/${id}`);
}

export async function createScheduleAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = createScheduleInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageSchedules(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    createSchedule(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      outletId: input.outletId,
      taskTemplateId: input.taskTemplateId,
      recurrence: input.recurrence,
      timezone: input.timezone,
      graceMinutes: input.graceMinutes,
      assigneeRole: input.assigneeRole,
      assigneeUserId: input.assigneeUserId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isActive: input.isActive,
    }),
  );
  if (result.status === "not-found") return { status: "not-found" };
  if (result.status === "invalid-assignee") return { status: "invalid-assignee" };
  revalidateSchedules(ctx.organizationId, result.scheduleId);
  return { status: "ok", id: result.scheduleId };
}

export async function updateScheduleAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = updateScheduleInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageSchedules(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    updateSchedule(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      scheduleId: input.scheduleId,
      outletId: input.outletId,
      taskTemplateId: input.taskTemplateId,
      recurrence: input.recurrence,
      timezone: input.timezone,
      graceMinutes: input.graceMinutes,
      assigneeRole: input.assigneeRole,
      assigneeUserId: input.assigneeUserId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    }),
  );
  if (result.status === "not-found") return { status: "not-found" };
  if (result.status === "invalid-assignee") return { status: "invalid-assignee" };
  revalidateSchedules(ctx.organizationId, input.scheduleId);
  return { status: "ok", id: input.scheduleId };
}

export async function setScheduleActiveAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = setScheduleActiveInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageSchedules(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    setScheduleActive(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      scheduleId: input.scheduleId,
      active: input.active,
    }),
  );
  if (result.status === "not-found") return { status: "not-found" };
  revalidateSchedules(ctx.organizationId, input.scheduleId);
  return { status: "ok" };
}

/**
 * Dev-only: materialize the occurrence window now (until the #20 Inngest cron lands). Gated the same as
 * schedule authorship. Returns how many occurrences were created so the UI can confirm.
 */
export async function generateNowAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = generateNowInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageSchedules(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    generateNow(tx, { organizationId: ctx.organizationId, now: new Date() }),
  );
  revalidatePath(`/${ctx.organizationId}/today`);
  revalidateSchedules(ctx.organizationId);
  return { status: "ok", created: result.created };
}
