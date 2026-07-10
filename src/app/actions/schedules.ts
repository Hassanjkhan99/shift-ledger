"use server";
// Scheduling Server Actions (#136 + #148 review). Zod-validated (RecurrenceSchema + assignee XOR +
// grace 0–60), session-authenticated, and D7 property-scope-gated: a PropertyManager/KitchenManager may
// only create/edit/deactivate schedules for outlets under a property in their scope (Codex #152). Owner/
// OrgAdmin manage any. Includes a dev-only "generate now" until the Inngest runtime (#20) lands.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withTenant, type TenantClient } from "@/lib/db";
import { resolveMemberForOrg, type MemberContext } from "@/lib/http-auth";
import { canManageSchedules, canManageScheduleAt } from "@/lib/permissions";
import {
  createSchedule,
  updateSchedule,
  setScheduleActive,
  generateNow,
  outletActiveProperty,
  schedulePropertyId,
} from "@/lib/schedules";
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
  | { status: "inactive-template" }
  | { status: "invalid-assignee" }
  | { status: "validation"; issues: unknown[] };

class ScopeError extends Error {}

async function ctxFor(organizationId: string): Promise<MemberContext | null> {
  return resolveMemberForOrg((await headers()) as unknown as Headers, organizationId);
}

function revalidateSchedules(org: string, id?: string): void {
  revalidatePath(`/${org}/settings/schedules`);
  if (id) revalidatePath(`/${org}/settings/schedules/${id}`);
}

/** Throw ScopeError unless the member may manage a schedule at `propertyId` (null ⇒ target missing). */
function assertScope(ctx: MemberContext, propertyId: string | null): string {
  if (!propertyId) throw new ScopeError("not-found");
  if (!canManageScheduleAt(ctx.role, ctx.propertyScope, propertyId))
    throw new ScopeError("forbidden");
  return propertyId;
}

export async function createScheduleAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = createScheduleInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageSchedules(ctx.role)) return { status: "forbidden" };

  try {
    const result = await withTenant(ctx.organizationId, async (tx) => {
      assertScope(ctx, await outletActiveProperty(tx, input.outletId));
      return createSchedule(tx, {
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
      });
    });
    if (result.status !== "ok") return result;
    revalidateSchedules(ctx.organizationId, result.scheduleId);
    return { status: "ok", id: result.scheduleId };
  } catch (err) {
    return scopeResult(err);
  }
}

export async function updateScheduleAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = updateScheduleInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageSchedules(ctx.role)) return { status: "forbidden" };

  try {
    const result = await withTenant(ctx.organizationId, async (tx) => {
      // The member must be in scope for BOTH the schedule's current property and the target outlet's.
      assertScope(ctx, await schedulePropertyId(tx, input.scheduleId));
      assertScope(ctx, await outletActiveProperty(tx, input.outletId));
      return updateSchedule(tx, {
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
      });
    });
    if (result.status !== "ok") return result;
    revalidateSchedules(ctx.organizationId, input.scheduleId);
    return { status: "ok", id: input.scheduleId };
  } catch (err) {
    return scopeResult(err);
  }
}

export async function setScheduleActiveAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = setScheduleActiveInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageSchedules(ctx.role)) return { status: "forbidden" };

  try {
    const result = await withTenant(ctx.organizationId, async (tx) => {
      assertScope(ctx, await schedulePropertyId(tx, input.scheduleId));
      return setScheduleActive(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        scheduleId: input.scheduleId,
        active: input.active,
      });
    });
    if (result.status !== "ok") return result;
    revalidateSchedules(ctx.organizationId, input.scheduleId);
    return { status: "ok" };
  } catch (err) {
    return scopeResult(err);
  }
}

/** Map a thrown ScopeError to the typed result; rethrow anything else. */
function scopeResult(err: unknown): ScheduleActionResult {
  if (err instanceof ScopeError) {
    return err.message === "forbidden" ? { status: "forbidden" } : { status: "not-found" };
  }
  throw err;
}

/**
 * Dev-only: materialize the occurrence window now (until the #20 Inngest cron lands). Org-wide generation,
 * so it stays gated to org-admins to avoid a scoped manager triggering a whole-org run.
 */
export async function generateNowAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = generateNowInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (ctx.role !== "Owner" && ctx.role !== "OrgAdmin") return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx: TenantClient) =>
    generateNow(tx, { organizationId: ctx.organizationId, now: new Date() }),
  );
  revalidatePath(`/${ctx.organizationId}/today`);
  revalidateSchedules(ctx.organizationId);
  return { status: "ok", created: result.created };
}
