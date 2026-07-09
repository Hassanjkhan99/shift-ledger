// Pure recurrence logic (#8/#136) — the typed schedule shape, DST-correct due-time computation, and the
// firing-day predicate. Extracted from occurrences.ts so BOTH the server generator AND the client
// scheduling preview (#136) share ONE implementation and can never diverge (§9). This module has NO
// Prisma / db imports, so it is safe to import into a client component.
//
// TIME LIBRARY: luxon is the sanctioned IANA-tz library. Fixed UTC offsets cannot express DST, and JS
// `Date` has no first-class IANA wall-clock→UTC conversion. luxon resolves a local wall-clock in a named
// zone to a UTC instant with correct DST semantics (§9.5/§9.6); we force the two DST edge cases
// explicitly rather than trusting a library default (see computeDueAt).
import { DateTime } from "luxon";
import { z } from "zod";
import { RecurrenceFreq } from "../generated/prisma/enums";

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
 *    the first valid instant — the moment the clock jumps to (03:00 local).
 *  - Fall-back overlap (e.g. 02:30 occurs twice): choose the EARLIER (first) UTC instant.
 */
export function computeDueAt(localDate: Date, timeOfDay: string, timezone: string): Date {
  const [hourStr, minuteStr] = timeOfDay.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

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
 * maps to TWO instants. Callers pick min/max as needed.
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
  // NOTE: luxon .offset below is a DST UTC shift, not SQL OFFSET pagination (F5 guard).
  const probeOffsets = new Set<number>([
    base.offset, // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
    base.minus({ hours: 1 }).offset, // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
    base.plus({ hours: 1 }).offset, // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
  ]);

  const millis = new Set<number>();
  for (const offsetMinutes of probeOffsets) {
    const utc = DateTime.fromObject({ year, month, day, hour, minute }, { zone: "utc" }).minus({
      minutes: offsetMinutes,
    });
    const roundTrip = utc.setZone(timezone);
    if (
      roundTrip.hour === hour &&
      roundTrip.minute === minute &&
      roundTrip.offset === offsetMinutes // keyset-guard-allow: luxon .offset is a DST UTC shift, not SQL OFFSET (F5)
    ) {
      millis.add(utc.toMillis());
    }
  }
  return millis.size > 0 ? [...millis] : [base.toMillis()];
}

/**
 * Read the wall-clock "HH:mm" from the dedicated `time_of_day` column. Prisma maps a `@db.Time`
 * to a JS Date whose UTC time-of-day carries HH:mm:ss (the date part is the 1970 epoch).
 */
export function timeOfDayHHmm(timeOfDay: Date): string {
  const hh = String(timeOfDay.getUTCHours()).padStart(2, "0");
  const mm = String(timeOfDay.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Does the recurrence fire on this local calendar date? Respects freq/interval/byWeekday/byMonthDay. */
export function recurrenceFiresOn(
  rec: Recurrence,
  startsOn: DateTime,
  candidate: DateTime,
): boolean {
  if (candidate < startsOn.startOf("day")) return false;

  switch (rec.freq) {
    case RecurrenceFreq.daily: {
      const days = Math.round(candidate.diff(startsOn.startOf("day"), "days").days);
      return days % rec.interval === 0;
    }
    case RecurrenceFreq.weekly: {
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
      const daysInMonth = candidate.daysInMonth ?? 31;
      return monthDays.some((d) => Math.min(d, daysInMonth) === candidate.day);
    }
    default:
      return false;
  }
}

/** Interpret a date-only value (UTC midnight, from a @db.Date or a form) as start-of-day in `timezone`. */
export function dateOnlyToLocal(dateOnly: Date, timezone: string): DateTime {
  return DateTime.fromObject(
    {
      year: dateOnly.getUTCFullYear(),
      month: dateOnly.getUTCMonth() + 1,
      day: dateOnly.getUTCDate(),
    },
    { zone: timezone },
  ).startOf("day");
}

/**
 * The next `count` local calendar dates a recurrence fires on, from `from` forward — the exact
 * predicate the generator uses (recurrenceFiresOn), so the #136 scheduling preview never diverges
 * from what generation will actually create. Returns ISO "YYYY-MM-DD" strings. Bounded by `maxScan`
 * days so an over-sparse recurrence can't loop unboundedly.
 */
export function upcomingOccurrenceDates(
  rec: Recurrence,
  opts: {
    startsOn: Date;
    endsOn?: Date | null;
    from: Date;
    timezone: string;
    count?: number;
    maxScan?: number;
  },
): string[] {
  const count = opts.count ?? 5;
  const maxScan = opts.maxScan ?? 400;
  const startsOnDT = dateOnlyToLocal(opts.startsOn, opts.timezone);
  const endsOnDT = opts.endsOn ? dateOnlyToLocal(opts.endsOn, opts.timezone) : null;
  const fromDT = DateTime.fromJSDate(opts.from, { zone: opts.timezone }).startOf("day");
  let cursor = startsOnDT > fromDT ? startsOnDT : fromDT;

  const out: string[] = [];
  for (let i = 0; i < maxScan && out.length < count; i++) {
    if (endsOnDT && cursor > endsOnDT) break;
    if (recurrenceFiresOn(rec, startsOnDT, cursor)) {
      out.push(cursor.toISODate() ?? "");
    }
    cursor = cursor.plus({ days: 1 });
  }
  return out.filter(Boolean);
}
