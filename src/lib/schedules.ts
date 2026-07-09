// Scheduling domain (#136) — scheduled_tasks CRUD + a dev "generate now" trigger. Each function runs
// inside a caller-provided tenant transaction (withTenant, D6) and audits via logActivity (F4/F6).
//
// The recurrence + due-time logic is the shared pure module (recurrence.ts) the generator uses, so the
// UI preview and generation never diverge (§9). propertyId is derived from the chosen outlet (not the
// form). The two DB CHECKs (assignee XOR, grace 0–60) are validated at the action layer AND enforced by
// the DB; the assignee_user_id composite FK to memberships means a non-member user id is rejected (P2003).
import type { TenantClient } from "./db";
import { logActivity } from "./transition";
import { generateOccurrences } from "./occurrences";
import { Prisma } from "../generated/prisma/client";
import type { OrgRole, RecurrenceFreq } from "../generated/prisma/enums";
import type { Recurrence } from "./recurrence";

export interface ScheduleRow {
  id: string;
  outletId: string;
  propertyId: string;
  taskTemplateId: string;
  recurrence: Recurrence;
  timezone: string;
  graceMinutes: number;
  assigneeRole: OrgRole | null;
  assigneeUserId: string | null;
  startsOn: string; // YYYY-MM-DD
  endsOn: string | null;
  isActive: boolean;
}

export interface ScheduleWriteInput {
  organizationId: string;
  actorUserId: string;
  outletId: string;
  taskTemplateId: string;
  recurrence: Recurrence;
  timezone: string;
  graceMinutes: number;
  assigneeRole?: OrgRole | null;
  assigneeUserId?: string | null;
  startsOn: string; // YYYY-MM-DD
  endsOn?: string | null;
  isActive?: boolean;
}

export type ScheduleResult =
  | { status: "ok"; scheduleId: string }
  | { status: "not-found" } // outlet or template missing/archived
  | { status: "invalid-assignee" }; // assignee user is not an active member (composite FK)

function timeOfDayDate(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}
function dateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function isFkViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003";
}

async function resolvePropertyId(tx: TenantClient, outletId: string): Promise<string | null> {
  const outlet = await tx.outlet.findFirst({
    where: { id: outletId, deletedAt: null },
    select: { propertyId: true },
  });
  return outlet?.propertyId ?? null;
}

/** Common write payload (create + update share it), with propertyId derived from the outlet. */
function schedulePayload(input: ScheduleWriteInput, propertyId: string) {
  return {
    propertyId,
    outletId: input.outletId,
    taskTemplateId: input.taskTemplateId,
    recurrenceJson: input.recurrence as unknown as Prisma.InputJsonValue,
    recurrenceFreq: input.recurrence.freq as RecurrenceFreq,
    timeOfDay: timeOfDayDate(input.recurrence.timeOfDay),
    timezone: input.timezone,
    graceMinutes: input.graceMinutes,
    assigneeRole: input.assigneeRole ?? null,
    assigneeUserId: input.assigneeUserId ?? null,
    startsOn: dateOnly(input.startsOn),
    endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
  };
}

export interface ScheduleFormOptions {
  outlets: { id: string; label: string; timezone: string }[];
  templates: { id: string; title: string }[];
  members: { userId: string; label: string }[];
}

/** Load the create/edit form's option lists (active outlets in scope, active templates, active members). */
export async function loadScheduleFormOptions(
  tx: TenantClient,
  propertyScope: readonly string[],
): Promise<ScheduleFormOptions> {
  const scoped = propertyScope.length > 0;
  const [outlets, templates, members] = await Promise.all([
    tx.outlet.findMany({
      where: { deletedAt: null, ...(scoped ? { propertyId: { in: [...propertyScope] } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, property: { select: { name: true, timezone: true } } },
    }),
    tx.taskTemplate.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
    }),
    tx.membership.findMany({
      where: { deletedAt: null, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { userId: true, user: { select: { email: true, name: true } } },
    }),
  ]);
  return {
    outlets: outlets.map((o) => ({
      id: o.id,
      label: `${o.property.name} · ${o.name}`,
      timezone: o.property.timezone,
    })),
    templates: templates.map((t) => ({ id: t.id, title: t.title })),
    members: members.map((m) => ({ userId: m.userId, label: m.user.name ?? m.user.email })),
  };
}

export async function listSchedules(tx: TenantClient): Promise<ScheduleRow[]> {
  const rows = await tx.scheduledTask.findMany({
    where: { deletedAt: null },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      outletId: true,
      propertyId: true,
      taskTemplateId: true,
      recurrenceJson: true,
      timezone: true,
      graceMinutes: true,
      assigneeRole: true,
      assigneeUserId: true,
      startsOn: true,
      endsOn: true,
      isActive: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    outletId: r.outletId,
    propertyId: r.propertyId,
    taskTemplateId: r.taskTemplateId,
    recurrence: r.recurrenceJson as unknown as Recurrence,
    timezone: r.timezone,
    graceMinutes: r.graceMinutes,
    assigneeRole: r.assigneeRole,
    assigneeUserId: r.assigneeUserId,
    startsOn: isoDate(r.startsOn),
    endsOn: r.endsOn ? isoDate(r.endsOn) : null,
    isActive: r.isActive,
  }));
}

export async function getSchedule(
  tx: TenantClient,
  scheduleId: string,
): Promise<ScheduleRow | null> {
  const r = await tx.scheduledTask.findFirst({
    where: { id: scheduleId, deletedAt: null },
    select: {
      id: true,
      outletId: true,
      propertyId: true,
      taskTemplateId: true,
      recurrenceJson: true,
      timezone: true,
      graceMinutes: true,
      assigneeRole: true,
      assigneeUserId: true,
      startsOn: true,
      endsOn: true,
      isActive: true,
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    outletId: r.outletId,
    propertyId: r.propertyId,
    taskTemplateId: r.taskTemplateId,
    recurrence: r.recurrenceJson as unknown as Recurrence,
    timezone: r.timezone,
    graceMinutes: r.graceMinutes,
    assigneeRole: r.assigneeRole,
    assigneeUserId: r.assigneeUserId,
    startsOn: isoDate(r.startsOn),
    endsOn: r.endsOn ? isoDate(r.endsOn) : null,
    isActive: r.isActive,
  };
}

export async function createSchedule(
  tx: TenantClient,
  input: ScheduleWriteInput,
): Promise<ScheduleResult> {
  const propertyId = await resolvePropertyId(tx, input.outletId);
  if (!propertyId) return { status: "not-found" };
  const template = await tx.taskTemplate.findFirst({
    where: { id: input.taskTemplateId, deletedAt: null },
    select: { id: true },
  });
  if (!template) return { status: "not-found" };

  try {
    const schedule = await tx.scheduledTask.create({
      data: {
        organizationId: input.organizationId,
        ...schedulePayload(input, propertyId),
        isActive: input.isActive ?? true,
      },
      select: { id: true },
    });
    await logActivity(tx, {
      organizationId: input.organizationId,
      subjectType: "scheduledTask",
      subjectId: schedule.id,
      action: "schedule.created",
      actorUserId: input.actorUserId,
      afterJson: {
        outletId: input.outletId,
        taskTemplateId: input.taskTemplateId,
        recurrence: input.recurrence as unknown as Prisma.InputJsonValue,
      },
    });
    return { status: "ok", scheduleId: schedule.id };
  } catch (err) {
    if (isFkViolation(err)) return { status: "invalid-assignee" };
    throw err;
  }
}

export async function updateSchedule(
  tx: TenantClient,
  input: ScheduleWriteInput & { scheduleId: string },
): Promise<ScheduleResult> {
  const before = await tx.scheduledTask.findFirst({
    where: { id: input.scheduleId, deletedAt: null },
    select: { id: true },
  });
  if (!before) return { status: "not-found" };
  const propertyId = await resolvePropertyId(tx, input.outletId);
  if (!propertyId) return { status: "not-found" };

  try {
    await tx.scheduledTask.update({
      where: { id: input.scheduleId },
      data: schedulePayload(input, propertyId),
    });
    await logActivity(tx, {
      organizationId: input.organizationId,
      subjectType: "scheduledTask",
      subjectId: input.scheduleId,
      action: "schedule.updated",
      actorUserId: input.actorUserId,
      afterJson: { outletId: input.outletId, taskTemplateId: input.taskTemplateId },
    });
    return { status: "ok", scheduleId: input.scheduleId };
  } catch (err) {
    if (isFkViolation(err)) return { status: "invalid-assignee" };
    throw err;
  }
}

/** Activate / deactivate a schedule. isActive is not a status-machine column (no F4 concern); #8's
 * generator already skips inactive/ended/archived schedules. */
export async function setScheduleActive(
  tx: TenantClient,
  input: { organizationId: string; actorUserId: string; scheduleId: string; active: boolean },
): Promise<ScheduleResult> {
  const before = await tx.scheduledTask.findFirst({
    where: { id: input.scheduleId, deletedAt: null },
    select: { id: true, isActive: true },
  });
  if (!before) return { status: "not-found" };

  await tx.scheduledTask.update({
    where: { id: input.scheduleId },
    data: { isActive: input.active },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "scheduledTask",
    subjectId: input.scheduleId,
    action: input.active ? "schedule.activated" : "schedule.deactivated",
    actorUserId: input.actorUserId,
    beforeJson: { isActive: before.isActive },
    afterJson: { isActive: input.active },
  });
  return { status: "ok", scheduleId: input.scheduleId };
}

/**
 * Dev-only "generate now" — materialize the rolling occurrence window for this tenant immediately, so a
 * new schedule produces tasks on Today before the Inngest generation runtime (#20) lands. Thin wrapper
 * over the tested generator; the audit entries are written by generateOccurrences itself.
 */
export async function generateNow(
  tx: TenantClient,
  input: { organizationId: string; now: Date },
): Promise<{ created: number }> {
  const result = await generateOccurrences(tx, {
    organizationId: input.organizationId,
    now: input.now,
  });
  return { created: result.created };
}
