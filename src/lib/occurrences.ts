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
import type { OccurrenceStatus } from "../generated/prisma/enums";
import { Prisma } from "../generated/prisma/client";
import type { TenantClient } from "./db";
import { transition, logActivity } from "./transition";

// ---- Typed recurrence (§9.1) ----------------------------------------------------
// A deliberately small, Zod-validatable shape — NOT an iCal RRULE. weekday: 1..7 (Mon..Sun,
// luxon convention). byMonthDay: 1..31. timeOfDay: local wall-clock "HH:mm".
export const RecurrenceSchema = z
  .object({
    freq: z.enum([RecurrenceFreq.daily, RecurrenceFreq.weekly, RecurrenceFreq.monthly]),
    interval: z.number().int().positive(),
    // When present, a day-filter must list at least one day. An empty array is NOT "matches
    // nothing" — it is a malformed schedule that would silently generate zero occurrences, so
    // reject it loudly (.min(1)) rather than letting recurrenceFiresOn treat [] as a filter.
    byWeekday: z.array(z.number().int().min(1).max(7)).min(1).optional(),
    byMonthDay: z.array(z.number().int().min(1).max(31)).min(1).optional(),
    timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "timeOfDay must be HH:mm"),
  })
  .strict()
  // Frequency-specific filter guard: a byWeekday filter only makes sense for weekly and a
  // byMonthDay filter only for monthly. A mismatched filter (e.g. daily + byWeekday) would be
  // silently IGNORED by recurrenceFiresOn (daily has no filter branch), materializing more
  // occurrences than the author intended. Reject the mismatch loudly instead.
  .superRefine((rec, ctx) => {
    if (rec.byWeekday !== undefined && rec.freq !== RecurrenceFreq.weekly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["byWeekday"],
        message: "byWeekday is only valid when freq === 'weekly'",
      });
    }
    if (rec.byMonthDay !== undefined && rec.freq !== RecurrenceFreq.monthly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["byMonthDay"],
        message: "byMonthDay is only valid when freq === 'monthly'",
      });
    }
  });

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

  // Fall-back overlap: the same wall time exists twice. Take the EARLIER (first) UTC instant.
  // We must NOT rely on which of the two the initial parse picked (dt.isAmbiguous is unreliable
  // once the generator self-heals earlier on the same local day). Instead, enumerate BOTH candidate
  // UTC offsets the zone applies to this wall-clock and take the MINIMUM UTC instant, so the earlier
  // one is chosen regardless of which offset the initial DateTime landed on.
  const candidates = possibleUtcMillis(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth() + 1,
    localDate.getUTCDate(),
    hour,
    minute,
    timezone,
  );
  return new Date(Math.min(...candidates));
}

/**
 * Enumerate every distinct UTC instant that the given local wall-clock maps to in `timezone`. For a
 * normal (non-DST) wall time this is a single instant; for a fall-back overlap the same wall time
 * maps to TWO instants (before and after the clock is set back). We probe the two adjacent standard
 * offsets by building the DateTime once and once shifted by the possible DST delta, keeping only the
 * candidates that round-trip back to the requested wall-clock. Callers pick min/max as needed.
 */
function possibleUtcMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): number[] {
  const base = DateTime.fromObject({ year, month, day, hour, minute }, { zone: timezone });
  // Candidate offsets (in minutes) around the base local time: the offset the base resolved to,
  // and the offsets one hour before / one hour after (which straddle a DST fall-back boundary).
  // NOTE: luxon .offset below is a DST UTC shift, not SQL OFFSET pagination (F5 guard).
  const probeOffsets = new Set<number>([
    base.offset, // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
    base.minus({ hours: 1 }).offset, // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
    base.plus({ hours: 1 }).offset, // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
  ]);

  const millis = new Set<number>();
  for (const offsetMinutes of probeOffsets) {
    // A wall-clock at `offsetMinutes` corresponds to this UTC instant…
    const utc = DateTime.fromObject({ year, month, day, hour, minute }, { zone: "utc" }).minus({
      minutes: offsetMinutes,
    });
    // …but only accept it if, viewed back in `timezone`, it actually reads as the requested wall
    // time with that same offset (rejects the phantom instant from the offset that doesn't apply). // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
    const roundTrip = utc.setZone(timezone);
    if (
      roundTrip.hour === hour &&
      roundTrip.minute === minute &&
      roundTrip.offset === offsetMinutes // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
    ) {
      millis.add(utc.toMillis());
    }
  }
  // Fallback: if nothing round-tripped (shouldn't happen for a valid non-gap time), use base.
  return millis.size > 0 ? [...millis] : [base.toMillis()];
}

/**
 * Read the wall-clock "HH:mm" from the dedicated `time_of_day` column. Prisma maps a `@db.Time`
 * to a JS Date whose UTC time-of-day carries HH:mm:ss (the date part is the 1970 epoch). This
 * column is separately editable, so generation honors a time-only edit here even if it diverges
 * from recurrence_json.timeOfDay (which still drives the firing-day logic).
 */
export function timeOfDayHHmm(timeOfDay: Date): string {
  const hh = String(timeOfDay.getUTCHours()).padStart(2, "0");
  const mm = String(timeOfDay.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Interpret a date-only `@db.Date` value (which Prisma returns as UTC midnight) as the start of
 * that same calendar day in `timezone`. Uses the UTC Y/M/D fields so the calendar day is preserved
 * regardless of the zone's distance from UTC — unlike fromJSDate, which would shift it west of UTC.
 */
function dateOnlyToLocal(dateOnly: Date, timezone: string): DateTime {
  return DateTime.fromObject(
    {
      year: dateOnly.getUTCFullYear(),
      month: dateOnly.getUTCMonth() + 1,
      day: dateOnly.getUTCDate(),
    },
    { zone: timezone },
  ).startOf("day");
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
      // Clamp each requested month-day to the last valid day of the candidate month, so a
      // schedule on day 31 (explicit byMonthDay or a starts_on on the 31st) still fires in short
      // months — Feb 28/29, Apr 30, etc. — instead of silently never firing.
      const daysInMonth = candidate.daysInMonth ?? 31;
      return monthDays.some((d) => Math.min(d, daysInMonth) === candidate.day);
    }
    default:
      return false;
  }
}

export interface GenerateArgs {
  organizationId: string;
  now: Date;
}

/** A schedule that was isolated (skipped) this run because it could not be safely materialized. */
export interface SkippedSchedule {
  scheduledTaskId: string;
  reason: string;
}

export interface GenerateResult {
  created: number;
  // Schedules whose recurrence_json failed to parse or whose timezone was invalid. These are
  // isolated so one bad schedule does not roll back the whole tenant's generation run.
  skipped: SkippedSchedule[];
}

// The schedule query's include: check_type + the frozen config_snapshot inputs (targetConfigJson,
// requiredEvidence) from the template, and the outlet's authoritative property_id. Defined once so
// the fetch and the ScheduleWithConfig payload type stay in lockstep.
const SCHEDULE_INCLUDE = {
  taskTemplate: {
    select: { checkType: true, targetConfigJson: true, requiredEvidence: true },
  },
  outlet: { select: { propertyId: true } },
} satisfies Prisma.ScheduledTaskInclude;

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
  // Lower bound for the ends_on scan filter. The rolling window is [today_local, today_local+2],
  // so the earliest local date it can touch is "today" in the furthest-east zone. Anchor the bound
  // at the UTC-MIDNIGHT of `now`'s date minus one day (a pure DATE, no time-of-day). ends_on is a
  // @db.Date stored at UTC midnight; if the bound carried a time-of-day (e.g. `now - 24h` at
  // 00:30Z), then for a zone west of UTC running just after UTC midnight a same-local-day ends_on
  // (UTC midnight) could compare `<` the bound and be wrongly excluded. Truncating to midnight makes
  // date-only ends_on values compare correctly; the per-candidate `candidate > endsOn` guard inside
  // the loop still does the exact exclusion. This keeps the scan off years of ended-but-still-active
  // history rows and lets the (is_active, ends_on) index do the work.
  const endsOnLowerBound = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 24 * 60 * 60 * 1000,
  );

  const schedules = await tx.scheduledTask.findMany({
    where: {
      organizationId,
      isActive: true,
      deletedAt: null,
      // Skip schedules whose parent site was soft-archived — no new occurrences for a
      // tombstoned outlet or property, even if the schedule row itself is still active.
      outlet: { deletedAt: null },
      property: { deletedAt: null },
      // Drop schedules that ended before the window could touch them, in the scan itself (not just
      // the in-loop guard) so a tenant's ended-history rows don't get fetched every run.
      OR: [{ endsOn: null }, { endsOn: { gte: endsOnLowerBound } }],
    },
    // check_type is snapshot from the template onto each occurrence (§8.13, denormalized).
    // targetConfigJson + requiredEvidence are frozen into config_snapshot at generation (§8.13).
    // outlet.propertyId is the AUTHORITATIVE property for the occurrence — see below.
    include: SCHEDULE_INCLUDE,
  });

  let created = 0;
  const skipped: SkippedSchedule[] = [];

  for (const schedule of schedules) {
    try {
      created += await generateForSchedule(tx, schedule, now);
    } catch (err) {
      // Isolate a bad schedule: a malformed recurrence_json (parseRecurrence throws) or an invalid
      // IANA timezone must SKIP just this schedule and continue with the rest, rather than aborting
      // the whole transaction and rolling back every valid schedule's occurrences.
      skipped.push({
        scheduledTaskId: schedule.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, skipped };
}

/** The schedule row shape generateForSchedule needs (with the config + outlet includes). */
type ScheduleWithConfig = Prisma.ScheduledTaskGetPayload<{ include: typeof SCHEDULE_INCLUDE }>;

/**
 * Materialize the rolling window for a SINGLE schedule. Throws on a malformed recurrence or an
 * invalid timezone so the caller can isolate (skip) just this schedule. Returns the created count.
 */
async function generateForSchedule(
  tx: TenantClient,
  schedule: ScheduleWithConfig,
  now: Date,
): Promise<number> {
  const rec = parseRecurrence(schedule.recurrenceJson);
  const tz = schedule.timezone;
  // Guard timezone validity explicitly: an invalid IANA zone makes luxon DateTimes .isValid=false
  // and would silently materialize nothing. Detect it up-front and throw so the caller skips+records.
  if (!DateTime.now().setZone(tz).isValid) {
    throw new Error(`generateOccurrences: invalid timezone '${tz}'`);
  }
  let created = 0;
  // starts_on / ends_on are pure @db.Date values — Prisma hands them back as UTC midnight.
  // fromJSDate(..., {zone: tz}) would reinterpret that instant in the local zone and, for
  // zones west of UTC, shift it to the PREVIOUS calendar day (generation could start a day
  // early / end a day late). Build the DateTime from the UTC Y/M/D fields instead, matching
  // how occurrence_local_date is anchored below.
  const startsOn = dateOnlyToLocal(schedule.startsOn, tz);
  const endsOn = schedule.endsOn ? dateOnlyToLocal(schedule.endsOn, tz) : null;
  const checkType: CheckType = schedule.taskTemplate.checkType;
  // Independent FKs let a scheduled_task carry a property_id that doesn't match its outlet's
  // property. Source the occurrence's property from the OUTLET (the row we already loaded for the
  // archived-site check) so a materialized occurrence always has a consistent (property, outlet)
  // pair, never an impossible one.
  const propertyId = schedule.outlet.propertyId;
  // Wall-clock comes from the dedicated, editable time_of_day column (not recurrence_json).
  const timeOfDay = timeOfDayHHmm(schedule.timeOfDay);

  // §8.13 config_snapshot invariant: FREEZE the template's threshold + required-evidence config onto
  // each occurrence at generation time. A later edit to the template's targetConfigJson /
  // requiredEvidence must not re-judge occurrences that were already materialized under the old
  // config, so we materialize the snapshot here rather than reading the live template at judge time.
  const configSnapshot = {
    targetConfig: (schedule.taskTemplate.targetConfigJson ?? null) as Prisma.InputJsonValue,
    requiredEvidence: schedule.taskTemplate.requiredEvidence,
  } satisfies Prisma.InputJsonValue;

  for (const candidate of windowLocalDates(now, tz)) {
    if (endsOn && candidate > endsOn) continue;
    if (!recurrenceFiresOn(rec, startsOn, candidate)) continue;

    // occurrence_local_date is a pure DATE — anchor it at UTC midnight so Prisma's @db.Date maps
    // the intended calendar day regardless of the runner's local zone.
    const localDate = new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day));
    const dueAt = computeDueAt(localDate, timeOfDay, tz);

    // Idempotent create-if-absent. Prisma's createMany with skipDuplicates maps to
    // INSERT ... ON CONFLICT DO NOTHING; count===0 means the row already existed (never reset it).
    const result = await tx.taskOccurrence.createMany({
      // f4-guard-allow: (none)→pending create; the freshly-inserted row is audited via logActivity below
      data: [
        {
          organizationId: schedule.organizationId,
          propertyId,
          outletId: schedule.outletId,
          scheduledTaskId: schedule.id,
          taskTemplateId: schedule.taskTemplateId,
          checkType,
          configSnapshot,
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

  return created;
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

  // pending → due: due_at reached. Exclude tombstoned rows (deleted_at not null).
  const toDue = await tx.taskOccurrence.findMany({
    where: { status: "pending", dueAt: { lte: now }, deletedAt: null },
    select: { id: true, organizationId: true, dueAt: true },
  });
  for (const occ of toDue) {
    // Compare-and-set: only flip the row if it is STILL pending. If a completion/skip/cancel
    // committed between the read above and this write, the updateMany matches 0 rows and the
    // sweep must not clobber that terminal state or log a phantom transition.
    const res = await transition(tx, {
      organizationId: occ.organizationId,
      subjectType: "taskOccurrence",
      subjectId: occ.id,
      action: "occurrence.due",
      actorLabel: "system:overdue-sweep",
      before: { status: "pending" },
      after: { status: "due" },
      mutate: (t) =>
        t.taskOccurrence.updateMany({
          // f4-guard-allow: transition()-wrapped CAS (sweep pending→due)
          // deletedAt: null in the CAS predicate too — a row soft-deleted between the read above
          // and this write must lose the race (count 0) so the sweep never flips a tombstoned row.
          where: { id: occ.id, status: "pending", deletedAt: null },
          data: { status: "due" },
        }),
      didMutate: (r) => r.count === 1,
    });
    if (res.count === 1) becameDue += 1;
  }

  // due → overdue: grace elapsed. grace_minutes lives on the parent scheduled_task, so join it.
  // Exclude tombstoned rows (deleted_at not null).
  const dueOccurrences = await tx.taskOccurrence.findMany({
    where: { status: "due", deletedAt: null },
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
    // Compare-and-set on the still-`due` status (same concurrency guard as pending→due).
    const res = await transition(tx, {
      organizationId: occ.organizationId,
      subjectType: "taskOccurrence",
      subjectId: occ.id,
      action: "occurrence.overdue",
      actorLabel: "system:overdue-sweep",
      before: { status: "due" },
      after: { status: "overdue" },
      mutate: (t) =>
        t.taskOccurrence.updateMany({
          // f4-guard-allow: transition()-wrapped CAS (sweep due→overdue)
          // deletedAt: null in the CAS predicate too — a row soft-deleted between the read above
          // and this write must lose the race (count 0) so the sweep never flips a tombstoned row.
          where: { id: occ.id, status: "due", deletedAt: null },
          data: { status: "overdue" },
        }),
      didMutate: (r) => r.count === 1,
    });
    if (res.count === 1) becameOverdue += 1;
  }

  return { becameDue, becameOverdue };
}

// ---- Manager occurrence edges with mandatory reason (#10; §7.1) -----------------
// The two §7.1 USER edges that do not depend on the completion flow (which lands with the completion
// Server Action in M4 #17). Both require a reason (D7) and route through the F4 choke point.
//
// SCOPE BOUNDARY: due→completed / overdue→completed_late / due|overdue→failed are NOT built here —
// they need pass/fail evaluation and are the completion Server Action (M4 #17). This module only owns
// the skip/cancel edges, which have no completion dependency. The failed transition (M4 #17) is what
// invokes evaluateRepeatedDeviation() (src/lib/repeated-deviation.ts).

/** Actor of a manager-triggered occurrence edge. `reason` is mandatory (enforced by transition()). */
export interface OccurrenceActor {
  actorUserId: string;
  reason: string;
}

/** Legal `from` statuses per §7.1. skipped: pending|due|overdue. cancelled: pending|due. */
const SKIP_FROM: OccurrenceStatus[] = ["pending", "due", "overdue"];
const CANCEL_FROM: OccurrenceStatus[] = ["pending", "due"];

async function occurrenceManagerEdge(
  tx: TenantClient,
  occurrenceId: string,
  legalFrom: OccurrenceStatus[],
  to: OccurrenceStatus,
  action: string,
  actor: OccurrenceActor,
): Promise<{ id: string; status: OccurrenceStatus }> {
  const current = await tx.taskOccurrence.findUniqueOrThrow({
    // A soft-deleted (tombstoned) occurrence is not a live entity — its status must not be
    // transitionable, so a manager cannot skip/cancel it (and mint a phantom audit row).
    where: { id: occurrenceId, deletedAt: null },
    select: { status: true, organizationId: true },
  });
  if (!legalFrom.includes(current.status)) {
    throw new Error(
      `occurrence: illegal transition to '${to}' from status '${current.status}' ` +
        `(legal from: ${legalFrom.join(", ")})`,
    );
  }
  const expectedFrom = current.status;

  return transition(tx, {
    organizationId: current.organizationId,
    subjectType: "taskOccurrence",
    subjectId: occurrenceId,
    action,
    actorUserId: actor.actorUserId,
    before: { status: current.status },
    after: { status: to },
    reason: actor.reason,
    requireReason: true, // §7.1 / D7: skip & cancel require a reason
    // Compare-and-set: only flip if the row is still in the status we read (expectedFrom). Two
    // concurrent manager edges from the same state (e.g. a skip and a cancel both from `due`) would
    // otherwise both commit; here the loser matches 0 rows — count !== 1 — and we THROW so the whole
    // transition rolls back (no status change, no audit row). This is a USER edge: it fails loudly,
    // unlike the system sweep's silent didMutate no-op. (Mirrors the #9 exception/CA edges.)
    mutate: async (t) => {
      // CAS keyed on the read status AND deletedAt: null — a row soft-deleted between the read
      // and this write also loses the race and rolls the whole transition back.
      const res = await t.taskOccurrence.updateMany({
        // f4-guard-allow: transition()-wrapped CAS (occurrence skip/cancel edge)
        where: { id: occurrenceId, status: expectedFrom, deletedAt: null },
        data: { status: to },
      });
      if (res.count !== 1) {
        throw new Error(
          `occurrence: concurrent modification — transition to '${to}' expected status ` +
            `'${expectedFrom}' but the row changed underneath`,
        );
      }
      return { id: occurrenceId, status: to };
    },
  });
}

/** pending|due|overdue → skipped. Manager marks the occurrence not-applicable, with a reason. */
export function skipOccurrence(tx: TenantClient, occurrenceId: string, actor: OccurrenceActor) {
  return occurrenceManagerEdge(tx, occurrenceId, SKIP_FROM, "skipped", "occurrence.skipped", actor);
}

/** pending|due → cancelled. Occurrence voided (schedule changed/deleted), with a reason. */
export function cancelOccurrence(tx: TenantClient, occurrenceId: string, actor: OccurrenceActor) {
  return occurrenceManagerEdge(
    tx,
    occurrenceId,
    CANCEL_FROM,
    "cancelled",
    "occurrence.cancelled",
    actor,
  );
}

// ---- Completion status edges (§7.1; M4 #17) -------------------------------------
// The three completion-driven occurrence edges: due→completed, overdue→completed_late, and
// due|overdue→failed. This function owns ONLY the occurrence STATUS flip (routed through the F4 choke
// point, so it is a sanctioned status writer here). The surrounding completion flow — pass/fail
// evaluation, the F2 idempotent task_completions insert, evidence attachment, and the fail-path
// Exception + repeated-deviation cascade — lives in the completion orchestrator (complete-occurrence.ts)
// and calls this after the completion row is written, inside the SAME withTenant transaction.

/** The terminal status a completion drives the occurrence to (§7.1). */
export type CompletionTransitionTarget = "completed" | "completed_late" | "failed";

/**
 * Flip an occurrence from its current due/overdue status to a completion terminal status, atomically
 * with the F4 audit row (transition()). Compare-and-set on `expectedFrom` (the status the orchestrator
 * read earlier in the same tx): if a concurrent write changed the row, the CAS matches 0 rows and we
 * THROW so the whole completion transaction — including the just-written completion row — rolls back
 * (a completion can never persist without its status transition). `completedAt` is stamped on the
 * happy-path terminals (completed/completed_late); a `failed` occurrence is not "completed" so it is
 * left null.
 */
export async function applyOccurrenceCompletion(
  tx: TenantClient,
  args: {
    organizationId: string;
    occurrenceId: string;
    expectedFrom: OccurrenceStatus;
    target: CompletionTransitionTarget;
    actorUserId: string;
    completedAt: Date;
  },
): Promise<{ id: string; status: OccurrenceStatus }> {
  const setCompletedAt = args.target !== "failed";
  return transition(tx, {
    organizationId: args.organizationId,
    subjectType: "taskOccurrence",
    subjectId: args.occurrenceId,
    action: `occurrence.${args.target}`,
    actorUserId: args.actorUserId,
    before: { status: args.expectedFrom },
    after: { status: args.target },
    mutate: async (t) => {
      const res = await t.taskOccurrence.updateMany({
        // f4-guard-allow: transition()-wrapped CAS (occurrence completion edge, M4 #17)
        where: { id: args.occurrenceId, status: args.expectedFrom, deletedAt: null },
        data: { status: args.target, ...(setCompletedAt ? { completedAt: args.completedAt } : {}) },
      });
      if (res.count !== 1) {
        throw new Error(
          `occurrence: concurrent modification — completion to '${args.target}' expected status ` +
            `'${args.expectedFrom}' but the row changed underneath`,
        );
      }
      return { id: args.occurrenceId, status: args.target };
    },
  });
}
