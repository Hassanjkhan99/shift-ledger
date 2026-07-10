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
  | { status: "inactive-template" } // selected template is deactivated (#157)
  | { status: "invalid-assignee" }; // assignee user is not an active member (#157)

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

// Resolve the outlet's property, requiring BOTH the outlet and its parent property to be active — a
// schedule under an archived site never materializes (the generator filters property.deletedAt), so we
// reject it up front (Codex #157).
async function resolvePropertyId(tx: TenantClient, outletId: string): Promise<string | null> {
  const outlet = await tx.outlet.findFirst({
    where: { id: outletId, deletedAt: null, property: { deletedAt: null } },
    select: { propertyId: true },
  });
  return outlet?.propertyId ?? null;
}

/** The property of an outlet if BOTH it and its parent are active — for the action's scope check (#152). */
export async function outletActiveProperty(
  tx: TenantClient,
  outletId: string,
): Promise<string | null> {
  return resolvePropertyId(tx, outletId);
}

/** The property a schedule belongs to (regardless of archived state) — for the action's scope check (#152). */
export async function schedulePropertyId(
  tx: TenantClient,
  scheduleId: string,
): Promise<string | null> {
  const s = await tx.scheduledTask.findFirst({
    where: { id: scheduleId, deletedAt: null },
    select: { propertyId: true },
  });
  return s?.propertyId ?? null;
}

/** True if `userId` is an ACTIVE, non-deleted member — the composite FK only proves a row exists (#157). */
async function isActiveMember(tx: TenantClient, userId: string): Promise<boolean> {
  const m = await tx.membership.findFirst({
    where: { userId, status: "active", deletedAt: null },
    select: { id: true },
  });
  return m !== null;
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
      // Exclude outlets whose parent property is archived (#157) + honor property scope (#152).
      where: {
        deletedAt: null,
        property: { deletedAt: null },
        ...(scoped ? { propertyId: { in: [...propertyScope] } } : {}),
      },
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

/** List schedules. Pass `propertyScope` (non-empty) to limit to those properties — scoped managers
 * must not see out-of-scope schedules (#152). Omit / empty = whole org (org-admins). */
export async function listSchedules(
  tx: TenantClient,
  propertyScope: readonly string[] = [],
): Promise<ScheduleRow[]> {
  const rows = await tx.scheduledTask.findMany({
    where: {
      deletedAt: null,
      ...(propertyScope.length > 0 ? { propertyId: { in: [...propertyScope] } } : {}),
    },
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
    select: { id: true, isActive: true },
  });
  if (!template) return { status: "not-found" };
  if (!template.isActive) return { status: "inactive-template" }; // don't schedule on a retired template
  if (input.assigneeUserId && !(await isActiveMember(tx, input.assigneeUserId))) {
    return { status: "invalid-assignee" };
  }

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
    select: {
      id: true,
      outletId: true,
      taskTemplateId: true,
      recurrenceJson: true,
      timezone: true,
      graceMinutes: true,
      assigneeRole: true,
      assigneeUserId: true,
      startsOn: true,
      endsOn: true,
    },
  });
  if (!before) return { status: "not-found" };
  const propertyId = await resolvePropertyId(tx, input.outletId);
  if (!propertyId) return { status: "not-found" };
  // Only require the template be active when it's being (re)pointed — editing other fields of a schedule
  // whose template was later deactivated must still work.
  if (input.taskTemplateId !== before.taskTemplateId) {
    const template = await tx.taskTemplate.findFirst({
      where: { id: input.taskTemplateId, deletedAt: null },
      select: { isActive: true },
    });
    if (!template) return { status: "not-found" };
    if (!template.isActive) return { status: "inactive-template" };
  }
  if (input.assigneeUserId && !(await isActiveMember(tx, input.assigneeUserId))) {
    return { status: "invalid-assignee" };
  }

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
      // Full before/after so any field change (recurrence/time/grace/assignee/dates/outlet) is auditable (#156).
      beforeJson: {
        outletId: before.outletId,
        taskTemplateId: before.taskTemplateId,
        recurrence: before.recurrenceJson as Prisma.InputJsonValue,
        timezone: before.timezone,
        graceMinutes: before.graceMinutes,
        assigneeRole: before.assigneeRole,
        assigneeUserId: before.assigneeUserId,
        startsOn: isoDate(before.startsOn),
        endsOn: before.endsOn ? isoDate(before.endsOn) : null,
      },
      afterJson: {
        outletId: input.outletId,
        taskTemplateId: input.taskTemplateId,
        recurrence: input.recurrence as unknown as Prisma.InputJsonValue,
        timezone: input.timezone,
        graceMinutes: input.graceMinutes,
        assigneeRole: input.assigneeRole ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
      },
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
