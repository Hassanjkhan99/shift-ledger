// Occurrence generation + overdue sweep — the schedule-materialization services (#8).
//
// SCOPE / RUNTIME BOUNDARY: this module delivers the INVOCABLE, DETERMINISTIC domain logic only.
// The Inngest RUNTIME that drives it — the hourly generator cron (`scheduling/generate-occurrences`,
// §9.3.1), the ~10-minute overdue sweep cron (`scheduling/sweep-overdue`, §9.3.2), the Inngest dev
// server, and the API route that receives the cron ticks — is deferred to M5 #20. This issue ships
// the functions those crons will call, fully tested. Every function takes `now: Date` explicitly so
// tests are deterministic (no wall-clock reads inside).
//
// TENANCY: generateOccurrences/sweepOccurrences run INSIDE a caller `tx` from withTenant(), so they
// inherit the transaction-local RLS context (organization_id). The PRODUCTION overdue sweep is
// tenant-AGNOSTIC — it runs under a privileged system role and scans the partial index
// `(status, due_at) WHERE status IN ('pending','due')` across all orgs (§8.13/§9.3.2). That
// role/entry point lands with the Inngest wiring in #20; here the sweep is exercised per-tenant
// under withTenant so the transition logic is testable today.
//
// TIME LIBRARY: luxon is the sanctioned IANA-tz library. Fixed UTC offsets cannot express DST, and
// JS `Date` has no first-class IANA wall-clock→UTC conversion. luxon resolves a local wall-clock in
// a named zone to a UTC instant with correct DST semantics (§9.5/§9.6). We force the two DST edge
// cases explicitly rather than trusting a library default (see computeDueAt).

import { DateTime } from "luxon";
import { z } from "zod";
import { CheckType, RecurrenceFreq } from "../generated/prisma/enums";
import type { TenantClient } from "./db";
import { transition, logActivity } from "./transition";

// ---- Typed recurrence (§9.1) ----------------------------------------------------
// A deliberately small, Zod-validatable shape — NOT an iCal RRULE. weekday: 1..7 (Mon..Sun,
// luxon convention). byMonthDay: 1..31. timeOfDay: local wall-clock "HH:mm".
export const RecurrenceSchema = z
  .object({
    freq: z.enum([RecurrenceFreq.daily, RecurrenceFreq.weekly, RecurrenceFreq.monthly]),
    interval: z.number().int().positive(),
    byWeekday: z.array(z.number().int().min(1).max(7)).optional(),
    byMonthDay: z.array(z.number().int().min(1).max(31)).optional(),
    timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "timeOfDay must be HH:mm"),
  })
  .strict();

export type Recurrence = z.infer<typeof RecurrenceSchema>;

/** Parse+validate a scheduled_task.recurrence_json blob through the Zod schema. */
export function parseRecurrence(json: unknown): Recurrence {
  return RecurrenceSchema.parse(json);
}

/**
 * Interpret `localDate` (a calendar date) + `timeOfDay` ("HH:mm") as a wall-clock in the IANA
 * `timezone` and return the corresponding UTC instant as a JS Date. DST edge cases (§9.6):
 *
 *  - Spring-forward gap (e.g. 02:30 on the DE spring transition does not exist): roll FORWARD to
 *    the first valid instant — the moment the clock jumps to (03:00 local). luxon's own behavior
 *    is to shift the wall time forward by the gap length (02:30 -> 03:30), which is NOT what we
 *    want, so we detect the gap (the built hour/minute differs from what was requested) and force
 *    the result to the post-gap hour boundary.
 *  - Fall-back overlap (e.g. 02:30 occurs twice): choose the EARLIER (first) UTC instant. luxon
 *    resolves an ambiguous local time to the earlier instant by default; we detect the ambiguity
 *    and take the minimum of the two candidate instants, so the outcome is forced by us rather than
 *    trusted to a library default.
 */
export function computeDueAt(localDate: Date, timeOfDay: string, timezone: string): Date {
  const [hourStr, minuteStr] = timeOfDay.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  // Use the local calendar Y/M/D of the provided date (occurrence_local_date is a pure DATE).
  const dt = DateTime.fromObject(
    {
      year: localDate.getUTCFullYear(),
      month: localDate.getUTCMonth() + 1,
      day: localDate.getUTCDate(),
      hour,
      minute,
    },
    { zone: timezone },
  );

  if (!dt.isValid) {
    throw new Error(`computeDueAt: invalid datetime for ${timezone} (${dt.invalidReason})`);
  }

  // Spring-forward gap: luxon pushed the wall time out of the requested slot. Force to the first
  // valid instant = the start of the hour the clock jumped to.
  if (dt.hour !== hour || dt.minute !== minute) {
    const jumped = DateTime.fromObject(
      {
        year: localDate.getUTCFullYear(),
        month: localDate.getUTCMonth() + 1,
        day: localDate.getUTCDate(),
        hour: hour + 1, // the clock skips this local hour; the next hour is the first valid one
        minute: 0,
      },
      { zone: timezone },
    );
    return jumped.toJSDate();
  }

  // Fall-back overlap: the same wall time exists twice. Take the EARLIER UTC instant. The later
  // occurrence is exactly the DST shift (typically +1h in UTC) after the earlier one and reads as
  // the same wall time. Compute the alternate and pick the minimum, so the outcome is forced by us.
  const altLater = dt.toUTC().plus({ hours: 1 }).setZone(timezone);
  const isAmbiguous =
    altLater.hour === dt.hour && altLater.minute === dt.minute && altLater.offset !== dt.offset; // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
  if (isAmbiguous) {
    const earlierMs = Math.min(dt.toMillis(), altLater.toMillis());
    return new Date(earlierMs);
  }

  return dt.toJSDate();
}

/** The three local dates in the rolling window [today_local, today_local + 2] (§9.2). */
function windowLocalDates(now: Date, timezone: string): DateTime[] {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf("day");
  return [today, today.plus({ days: 1 }), today.plus({ days: 2 })];
}

/** Does the recurrence fire on this local calendar date? Respects freq/interval/byWeekday/byMonthDay. */
function recurrenceFiresOn(rec: Recurrence, startsOn: DateTime, candidate: DateTime): boolean {
  if (candidate < startsOn.startOf("day")) return false;

  switch (rec.freq) {
    case RecurrenceFreq.daily: {
      const days = Math.round(candidate.diff(startsOn.startOf("day"), "days").days);
      return days % rec.interval === 0;
    }
    case RecurrenceFreq.weekly: {
      // Interval counts whole weeks from the week of starts_on.
      const weeks = Math.floor(
        candidate.startOf("day").diff(startsOn.startOf("week"), "weeks").weeks,
      );
      if (weeks % rec.interval !== 0) return false;
      const weekdays = rec.byWeekday ?? [startsOn.weekday];
      return weekdays.includes(candidate.weekday);
    }
    case RecurrenceFreq.monthly: {
      const months = (candidate.year - startsOn.year) * 12 + (candidate.month - startsOn.month);
      if (months % rec.interval !== 0) return false;
      const monthDays = rec.byMonthDay ?? [startsOn.day];
      return monthDays.includes(candidate.day);
    }
    default:
      return false;
  }
}

export interface GenerateArgs {
  organizationId: string;
  now: Date;
}

export interface GenerateResult {
  created: number;
}

/**
 * Materialize the rolling 3-day window of occurrences for every active, non-deleted scheduled_task
 * in the current tenant (§9.2/§9.3.1). Idempotent: INSERT ... ON CONFLICT DO NOTHING on
 * (scheduled_task_id, occurrence_local_date). An existing occurrence is NEVER overwritten — it may
 * already be completed/failed (§9.4). Only a genuinely-created row gets a `(none)→pending`
 * activity_log entry (system:generator).
 */
export async function generateOccurrences(
  tx: TenantClient,
  { organizationId, now }: GenerateArgs,
): Promise<GenerateResult> {
  const schedules = await tx.scheduledTask.findMany({
    where: { organizationId, isActive: true, deletedAt: null },
    // check_type is snapshot from the template onto each occurrence (§8.13, denormalized).
    include: { taskTemplate: { select: { checkType: true } } },
  });

  let created = 0;

  for (const schedule of schedules) {
    const rec = parseRecurrence(schedule.recurrenceJson);
    const tz = schedule.timezone;
    const startsOn = DateTime.fromJSDate(schedule.startsOn, { zone: tz }).startOf("day");
    const endsOn = schedule.endsOn
      ? DateTime.fromJSDate(schedule.endsOn, { zone: tz }).startOf("day")
      : null;
    const checkType: CheckType = schedule.taskTemplate.checkType;

    for (const candidate of windowLocalDates(now, tz)) {
      if (endsOn && candidate > endsOn) continue;
      if (!recurrenceFiresOn(rec, startsOn, candidate)) continue;

      // occurrence_local_date is a pure DATE — anchor it at UTC midnight so Prisma's @db.Date maps
      // the intended calendar day regardless of the runner's local zone.
      const localDate = new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day));
      const dueAt = computeDueAt(localDate, rec.timeOfDay, tz);

      // Idempotent create-if-absent. Prisma's createMany with skipDuplicates maps to
      // INSERT ... ON CONFLICT DO NOTHING; count===0 means the row already existed (never reset it).
      const result = await tx.taskOccurrence.createMany({
        data: [
          {
            organizationId: schedule.organizationId,
            propertyId: schedule.propertyId,
            outletId: schedule.outletId,
            scheduledTaskId: schedule.id,
            taskTemplateId: schedule.taskTemplateId,
            checkType,
            occurrenceLocalDate: localDate,
            dueAt,
            timezone: tz,
            status: "pending",
            assigneeRole: schedule.assigneeRole,
            assigneeUserId: schedule.assigneeUserId,
          },
        ],
        skipDuplicates: true,
      });

      if (result.count === 0) continue; // already existed — do not overwrite, do not log

      created += result.count;

      // Read back the freshly-created row's id for the audit subject (the (none)→pending log).
      const inserted = await tx.taskOccurrence.findUnique({
        where: {
          scheduledTaskId_occurrenceLocalDate: {
            scheduledTaskId: schedule.id,
            occurrenceLocalDate: localDate,
          },
        },
        select: { id: true },
      });

      if (inserted) {
        await logActivity(tx, {
          organizationId: schedule.organizationId,
          subjectType: "taskOccurrence",
          subjectId: inserted.id,
          action: "occurrence.generated",
          actorLabel: "system:generator",
          afterJson: { status: "pending", dueAt: dueAt.toISOString() },
        });
      }
    }
  }

  return { created };
}

export interface SweepArgs {
  now: Date;
}

export interface SweepResult {
  becameDue: number;
  becameOverdue: number;
}

/**
 * Advance occurrence status by time (§9.3.2, §7.1):
 *   pending → due      when now >= due_at
 *   due     → overdue  when now > due_at + grace_minutes (grace from the parent scheduled_task)
 * Each transition routes through the F4 choke point transition() (actorLabel system:overdue-sweep),
 * so an activity_log row is written atomically with the status flip.
 *
 * Runs inside the caller `tx` (withTenant) here; the production sweep is tenant-agnostic (#20).
 */
export async function sweepOccurrences(tx: TenantClient, { now }: SweepArgs): Promise<SweepResult> {
  let becameDue = 0;
  let becameOverdue = 0;

  // pending → due: due_at reached.
  const toDue = await tx.taskOccurrence.findMany({
    where: { status: "pending", dueAt: { lte: now } },
    select: { id: true, organizationId: true, dueAt: true },
  });
  for (const occ of toDue) {
    await transition(tx, {
      organizationId: occ.organizationId,
      subjectType: "taskOccurrence",
      subjectId: occ.id,
      action: "occurrence.due",
      actorLabel: "system:overdue-sweep",
      before: { status: "pending" },
      after: { status: "due" },
      mutate: (t) => t.taskOccurrence.update({ where: { id: occ.id }, data: { status: "due" } }),
    });
    becameDue += 1;
  }

  // due → overdue: grace elapsed. grace_minutes lives on the parent scheduled_task, so join it.
  const dueOccurrences = await tx.taskOccurrence.findMany({
    where: { status: "due" },
    select: {
      id: true,
      organizationId: true,
      dueAt: true,
      scheduledTask: { select: { graceMinutes: true } },
    },
  });
  for (const occ of dueOccurrences) {
    const graceMs = occ.scheduledTask.graceMinutes * 60_000;
    if (now.getTime() <= occ.dueAt.getTime() + graceMs) continue;
    await transition(tx, {
      organizationId: occ.organizationId,
      subjectType: "taskOccurrence",
      subjectId: occ.id,
      action: "occurrence.overdue",
      actorLabel: "system:overdue-sweep",
      before: { status: "due" },
      after: { status: "overdue" },
      mutate: (t) =>
        t.taskOccurrence.update({ where: { id: occ.id }, data: { status: "overdue" } }),
    });
    becameOverdue += 1;
  }

  return { becameDue, becameOverdue };
}
