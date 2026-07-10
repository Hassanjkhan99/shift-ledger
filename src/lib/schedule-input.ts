// Input schemas for the scheduling Server Actions (#136). Plain module (testable without a Next request
// context). Reuses RecurrenceSchema (the exact shape the generator validates) and enforces the two DB
// CHECKs at the form/action boundary too: assignee is EXACTLY ONE of role/user (XOR), grace is 0–60 (D3).
import { z } from "zod";
import { IANAZone } from "luxon";
import { OrgRole } from "../generated/prisma/enums";
import { RecurrenceSchema } from "./recurrence";

const orgIdField = z.string().uuid();
// Reject not-just-malformed but IMPOSSIBLE dates (e.g. 2026-02-31): the format regex passes them, but
// `new Date()` would silently normalize to another day (Mar 3), saving a schedule on a date the author
// never chose (#161). Round-trip the parsed instant back to YYYY-MM-DD and require it to match.
const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real calendar date.");

const baseScheduleShape = {
  organizationId: orgIdField,
  outletId: z.string().uuid(),
  taskTemplateId: z.string().uuid(),
  recurrence: RecurrenceSchema,
  timezone: z.string().refine((tz) => IANAZone.isValidZone(tz), "Not a valid IANA time zone."),
  graceMinutes: z.number().int().min(0).max(60),
  assigneeRole: z.nativeEnum(OrgRole).nullish(),
  assigneeUserId: z.string().uuid().nullish(),
  startsOn: dateField,
  endsOn: dateField.nullish(),
  isActive: z.boolean().default(true),
};

const scheduleRefine = (
  data: {
    assigneeRole?: OrgRole | null;
    assigneeUserId?: string | null;
    startsOn: string;
    endsOn?: string | null;
  },
  ctx: z.RefinementCtx,
): void => {
  // Assignee XOR (scheduled_tasks_assignee_exactly_one): exactly one of role / user.
  const hasRole = data.assigneeRole != null;
  const hasUser = data.assigneeUserId != null;
  if (hasRole === hasUser) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assigneeRole"],
      message: "Set exactly one assignee: a role or a specific user.",
    });
  }
  if (data.endsOn && data.endsOn < data.startsOn) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsOn"],
      message: "End date must be on or after the start date.",
    });
  }
};

export const createScheduleInput = z.object(baseScheduleShape).superRefine(scheduleRefine);

export const updateScheduleInput = z
  .object({ ...baseScheduleShape, scheduleId: z.string().uuid() })
  .superRefine(scheduleRefine);

export const setScheduleActiveInput = z.object({
  organizationId: orgIdField,
  scheduleId: z.string().uuid(),
  active: z.boolean(),
});

export const generateNowInput = z.object({ organizationId: orgIdField });
