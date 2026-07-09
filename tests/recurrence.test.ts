import { describe, it, expect } from "vitest";
import { upcomingOccurrenceDates, parseRecurrence } from "../src/lib/recurrence";

// #136 — the preview engine (upcomingOccurrenceDates) shares recurrenceFiresOn with the generator, so
// these date sequences are exactly what generation will materialize (the DB cross-check lives in
// schedules.test.ts). Pure, no DB.

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("upcomingOccurrenceDates (#136)", () => {
  it("daily interval 1 lists consecutive days from the start", () => {
    const rec = parseRecurrence({ freq: "daily", interval: 1, timeOfDay: "06:00" });
    const dates = upcomingOccurrenceDates(rec, {
      startsOn: utc(2026, 3, 10),
      from: utc(2026, 3, 10),
      timezone: "Europe/Berlin",
      count: 3,
    });
    expect(dates).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });

  it("daily interval 2 skips every other day", () => {
    const rec = parseRecurrence({ freq: "daily", interval: 2, timeOfDay: "06:00" });
    const dates = upcomingOccurrenceDates(rec, {
      startsOn: utc(2026, 3, 10),
      from: utc(2026, 3, 10),
      timezone: "Europe/Berlin",
      count: 3,
    });
    expect(dates).toEqual(["2026-03-10", "2026-03-12", "2026-03-14"]);
  });

  it("weekly Mon/Wed lists only those weekdays", () => {
    // 2026-03-02 is a Monday.
    const rec = parseRecurrence({
      freq: "weekly",
      interval: 1,
      byWeekday: [1, 3],
      timeOfDay: "07:00",
    });
    const dates = upcomingOccurrenceDates(rec, {
      startsOn: utc(2026, 3, 2),
      from: utc(2026, 3, 2),
      timezone: "Europe/Berlin",
      count: 4,
    });
    expect(dates).toEqual(["2026-03-02", "2026-03-04", "2026-03-09", "2026-03-11"]);
  });

  it("monthly day 31 clamps to the last day of shorter months", () => {
    const rec = parseRecurrence({
      freq: "monthly",
      interval: 1,
      byMonthDay: [31],
      timeOfDay: "06:00",
    });
    const dates = upcomingOccurrenceDates(rec, {
      startsOn: utc(2026, 1, 1),
      from: utc(2026, 1, 1),
      timezone: "Europe/Berlin",
      count: 3,
    });
    // Jan 31, Feb 28 (clamped), Mar 31.
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("respects endsOn and the from cursor", () => {
    const rec = parseRecurrence({ freq: "daily", interval: 1, timeOfDay: "06:00" });
    const dates = upcomingOccurrenceDates(rec, {
      startsOn: utc(2026, 3, 1),
      endsOn: utc(2026, 3, 12),
      from: utc(2026, 3, 10),
      timezone: "Europe/Berlin",
      count: 10,
    });
    expect(dates).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });
});
