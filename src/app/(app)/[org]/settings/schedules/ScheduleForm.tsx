"use client";
// Schedule create/edit form + recurrence builder (#136). The "next occurrences" preview is computed with
// the SAME pure module the generator uses (recurrence.ts: RecurrenceSchema + upcomingOccurrenceDates), so
// what the author sees is exactly what generation will materialize — DST-correct (§9). Assignee is a
// role XOR a specific user; grace is 0–60 (D3). Timezone defaults from the chosen outlet's property.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { RecurrenceFreq, OrgRole } from "@/generated/prisma/enums";
import { RecurrenceSchema, upcomingOccurrenceDates } from "@/lib/recurrence";
import { createScheduleAction, updateScheduleAction } from "@/app/actions/schedules";
import { cardClass, labelClass, inputClass, buttonClass, FormError } from "@/app/(auth)/ui";

export interface OutletOption {
  id: string;
  label: string;
  timezone: string;
}
export interface TemplateOption {
  id: string;
  title: string;
}
export interface MemberOption {
  userId: string;
  label: string;
}
export interface ScheduleInitial {
  id: string;
  outletId: string;
  taskTemplateId: string;
  recurrence: {
    freq: RecurrenceFreq;
    interval: number;
    byWeekday?: number[];
    byMonthDay?: number[];
    timeOfDay: string;
  };
  timezone: string;
  graceMinutes: number;
  assigneeRole: OrgRole | null;
  assigneeUserId: string | null;
  startsOn: string;
  endsOn: string | null;
}

const WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];
const ASSIGNABLE_ROLES = [
  OrgRole.KitchenManager,
  OrgRole.ShiftLeader,
  OrgRole.Staff,
  OrgRole.PropertyManager,
];

function parseMonthDays(s: string): number[] {
  return s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
}

/** A non-empty monthly-days entry containing any token that isn't a valid 1–31 day (#161). Silently
 * dropping such a token would save a different recurrence than the author typed. */
function hasInvalidMonthDayToken(s: string): boolean {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .some((t) => !/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 31);
}

export function ScheduleForm({
  org,
  mode,
  outlets,
  templates,
  members,
  initial,
}: {
  org: string;
  mode: "create" | "edit";
  outlets: OutletOption[];
  templates: TemplateOption[];
  members: MemberOption[];
  initial?: ScheduleInitial;
}) {
  const router = useRouter();
  const [outletId, setOutletId] = useState(initial?.outletId ?? outlets[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(initial?.taskTemplateId ?? templates[0]?.id ?? "");
  const [freq, setFreq] = useState<RecurrenceFreq>(
    initial?.recurrence.freq ?? RecurrenceFreq.daily,
  );
  const [interval, setIntervalValue] = useState(String(initial?.recurrence.interval ?? 1));
  const [byWeekday, setByWeekday] = useState<Set<number>>(
    new Set(initial?.recurrence.byWeekday ?? []),
  );
  const [byMonthDay, setByMonthDay] = useState((initial?.recurrence.byMonthDay ?? []).join(", "));
  const [timeOfDay, setTimeOfDay] = useState(initial?.recurrence.timeOfDay ?? "06:00");
  const outletTz = outlets.find((o) => o.id === outletId)?.timezone;
  const [timezone, setTimezone] = useState(initial?.timezone ?? outletTz ?? "Europe/Berlin");
  const [grace, setGrace] = useState(String(initial?.graceMinutes ?? 15));
  const [assigneeMode, setAssigneeMode] = useState<"role" | "user">(
    initial?.assigneeUserId ? "user" : "role",
  );
  const [assigneeRole, setAssigneeRole] = useState<OrgRole>(
    initial?.assigneeRole ?? OrgRole.KitchenManager,
  );
  const [assigneeUserId, setAssigneeUserId] = useState(
    initial?.assigneeUserId ?? members[0]?.userId ?? "",
  );
  const [startsOn, setStartsOn] = useState(
    initial?.startsOn ?? new Date().toISOString().slice(0, 10),
  );
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function buildRecurrence() {
    const rec: Record<string, unknown> = {
      freq,
      interval: Number(interval) || 1,
      timeOfDay,
    };
    if (freq === RecurrenceFreq.weekly && byWeekday.size > 0) {
      rec.byWeekday = [...byWeekday].sort((a, b) => a - b);
    }
    if (freq === RecurrenceFreq.monthly) {
      const days = parseMonthDays(byMonthDay);
      if (days.length > 0) rec.byMonthDay = days;
    }
    return rec;
  }

  // Live preview via the SAME engine the generator uses. Computed each render (cheap, deterministic).
  const parsedRec = RecurrenceSchema.safeParse(buildRecurrence());
  const preview =
    parsedRec.success && /^\d{4}-\d{2}-\d{2}$/.test(startsOn)
      ? upcomingOccurrenceDates(parsedRec.data, {
          startsOn: new Date(`${startsOn}T00:00:00Z`),
          endsOn: endsOn ? new Date(`${endsOn}T00:00:00Z`) : null,
          from: new Date(),
          timezone,
          count: 6,
        })
      : [];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!outletId || !templateId) {
      setError("Pick an outlet and a template.");
      return;
    }
    if (freq === RecurrenceFreq.monthly && hasInvalidMonthDayToken(byMonthDay)) {
      setError("Days of month must be numbers between 1 and 31.");
      return;
    }
    if (!parsedRec.success) {
      setError(parsedRec.error.issues[0]?.message ?? "Invalid recurrence.");
      return;
    }
    setPending(true);
    const payload = {
      organizationId: org,
      outletId,
      taskTemplateId: templateId,
      recurrence: parsedRec.data,
      timezone,
      graceMinutes: Number(grace),
      assigneeRole: assigneeMode === "role" ? assigneeRole : null,
      assigneeUserId: assigneeMode === "user" ? assigneeUserId : null,
      startsOn,
      endsOn: endsOn || null,
    };
    const result =
      mode === "create"
        ? await createScheduleAction(payload)
        : await updateScheduleAction({ ...payload, scheduleId: initial!.id });
    if (result.status === "ok") {
      router.push(`/${org}/settings/schedules`);
      router.refresh();
      return;
    }
    setPending(false);
    if (result.status === "invalid-assignee")
      setError("The chosen assignee is not an active member.");
    else if (result.status === "inactive-template")
      setError("That template is deactivated — pick an active one.");
    else if (result.status === "validation")
      setError("Please check the recurrence, assignee and grace.");
    else if (result.status === "forbidden")
      setError("You don’t have permission to manage schedules for this site.");
    else if (result.status === "not-found") setError("The outlet or template no longer exists.");
    else setError("Could not save the schedule.");
  }

  return (
    <form className={cardClass} onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="sch-template" className={labelClass}>
            Template
          </label>
          <select
            id="sch-template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            disabled={pending}
            className={inputClass}
          >
            {templates.length === 0 && <option value="">No active templates</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sch-outlet" className={labelClass}>
            Outlet
          </label>
          <select
            id="sch-outlet"
            value={outletId}
            onChange={(e) => {
              setOutletId(e.target.value);
              const tz = outlets.find((o) => o.id === e.target.value)?.timezone;
              if (tz) setTimezone(tz);
            }}
            disabled={pending}
            className={inputClass}
          >
            {outlets.length === 0 && <option value="">No outlets</option>}
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="sch-freq" className={labelClass}>
              Repeats
            </label>
            <select
              id="sch-freq"
              value={freq}
              onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}
              disabled={pending}
              className={inputClass}
            >
              <option value={RecurrenceFreq.daily}>Daily</option>
              <option value={RecurrenceFreq.weekly}>Weekly</option>
              <option value={RecurrenceFreq.monthly}>Monthly</option>
            </select>
          </div>
          <div className="w-24">
            <label htmlFor="sch-interval" className={labelClass}>
              Every
            </label>
            <input
              id="sch-interval"
              type="number"
              min="1"
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
          <div className="w-28">
            <label htmlFor="sch-time" className={labelClass}>
              Time
            </label>
            <input
              id="sch-time"
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
        </div>

        {freq === RecurrenceFreq.weekly && (
          <div>
            <span className={labelClass}>On days</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <label
                  key={d.n}
                  className="flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300"
                >
                  <input
                    type="checkbox"
                    checked={byWeekday.has(d.n)}
                    disabled={pending}
                    onChange={() =>
                      setByWeekday((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.n)) next.delete(d.n);
                        else next.add(d.n);
                        return next;
                      })
                    }
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        )}
        {freq === RecurrenceFreq.monthly && (
          <div>
            <label htmlFor="sch-monthdays" className={labelClass}>
              Days of month
            </label>
            <input
              id="sch-monthdays"
              type="text"
              value={byMonthDay}
              onChange={(e) => setByMonthDay(e.target.value)}
              disabled={pending}
              className={inputClass}
              placeholder="e.g. 1, 15"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Comma-separated (1–31). Day 31 fires on the last day of shorter months.
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="sch-tz" className={labelClass}>
              Time zone
            </label>
            <input
              id="sch-tz"
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
          <div className="w-24">
            <label htmlFor="sch-grace" className={labelClass}>
              Grace (min)
            </label>
            <input
              id="sch-grace"
              type="number"
              min="0"
              max="60"
              value={grace}
              onChange={(e) => setGrace(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <span className={labelClass}>Assignee</span>
          <div className="mt-1 flex items-center gap-3">
            <select
              value={assigneeMode}
              onChange={(e) => setAssigneeMode(e.target.value as "role" | "user")}
              disabled={pending}
              className={inputClass + " max-w-[8rem]"}
            >
              <option value="role">By role</option>
              <option value="user">By user</option>
            </select>
            {assigneeMode === "role" ? (
              <select
                value={assigneeRole}
                onChange={(e) => setAssigneeRole(e.target.value as OrgRole)}
                disabled={pending}
                className={inputClass}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={assigneeUserId}
                onChange={(e) => setAssigneeUserId(e.target.value)}
                disabled={pending}
                className={inputClass}
              >
                {members.length === 0 && <option value="">No members</option>}
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="sch-starts" className={labelClass}>
              Starts on
            </label>
            <input
              id="sch-starts"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="sch-ends" className={labelClass}>
              Ends on <span className="text-zinc-400">(optional)</span>
            </label>
            <input
              id="sch-ends"
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
        </div>

        <div className="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
          <p className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Next occurrences
          </p>
          {preview.length > 0 ? (
            <ul className="text-xs text-zinc-600 dark:text-zinc-400">
              {preview.map((d) => (
                <li key={d}>
                  {d} · {timeOfDay}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {parsedRec.success
                ? "No upcoming dates in range."
                : "Complete the recurrence to preview."}
            </p>
          )}
        </div>

        <FormError message={error} />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : mode === "create" ? "Create schedule" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
