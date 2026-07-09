// The Pothos code-first schema (#15) — object types + the root Query fields backing the live client
// islands (Today list, occurrence detail, Exceptions list, notification badge). No SDL file is
// hand-maintained (ADR-b); `printSchema(schema)` emits SDL for codegen (scripts/print-graphql-schema.ts).
//
// Read model design notes:
//  - occurrencesToday is a cheap INDEXED read over materialized task_occurrences (never a recurrence
//    computation, §8.13/§11.8) grouped by outlet. Its object shape mirrors the RSC->Prisma Path A read
//    so #16 can seed the TanStack cache via HydrationBoundary with no duplicate client fetch (D10).
//  - The two per-occurrence relations that would otherwise N+1 — current completion + evidence count —
//    resolve through t.loadable DataLoader fields (F1, see loaders.ts). outlet + template come back on
//    the SAME findMany via Prisma include (a join, one query), so the whole Today read is 3 queries:
//    the occurrence list, the batched completion load, the batched evidence-count load.
//  - Every resolver runs through ctx.run (withTenant) so RLS tenant-isolates it (D6): a cross-org id
//    simply isn't found. scope-auth adds role gating on the triage reads on top.
//  - Growing lists use keyset pagination (F5), never OFFSET.
import { GraphQLError } from "graphql";
import { builder } from "./builder";
import { loadCurrentCompletions, loadEvidenceCounts } from "./loaders";
import { keysetPaginate } from "../keyset";
import {
  OrgRole,
  OccurrenceStatus,
  ExceptionStatus,
  CheckType,
} from "../../generated/prisma/enums";

// ---- Enums (code-first, from the canonical Prisma enums) -------------------------
const OccurrenceStatusEnum = builder.enumType("OccurrenceStatus", {
  values: Object.values(OccurrenceStatus),
});
const CheckTypeEnum = builder.enumType("CheckType", { values: Object.values(CheckType) });
const OrgRoleEnum = builder.enumType("OrgRole", { values: Object.values(OrgRole) });
const ExceptionStatusEnum = builder.enumType("ExceptionStatus", {
  values: Object.values(ExceptionStatus),
});

// ---- Backing TS shapes (the Prisma selections resolvers return) -----------------
interface TemplateShape {
  id: string;
  title: string;
  checkType: CheckType;
  requiredEvidence: string[];
}
interface OutletShape {
  id: string;
  name: string;
  propertyId: string;
}
interface OccurrenceShape {
  id: string;
  outletId: string;
  status: OccurrenceStatus;
  checkType: CheckType;
  dueAt: Date;
  occurrenceLocalDate: Date;
  timezone: string;
  assigneeRole: OrgRole | null;
  assigneeUserId: string | null;
  configSnapshot: unknown;
  taskTemplate: TemplateShape;
  outlet: OutletShape;
}
interface OutletGroupShape {
  outlet: OutletShape;
  occurrences: OccurrenceShape[];
}
interface ExceptionShape {
  id: string;
  status: ExceptionStatus;
  severity: string;
  title: string;
  detail: string | null;
  outletId: string;
  propertyId: string;
  openedAt: Date;
}
interface ExceptionPageShape {
  items: ExceptionShape[];
  nextCursor: string | null;
}

// The exact Prisma selection used by every occurrence read, so the list, the by-id read, and their
// object shapes stay in lockstep (also the shape #16's RSC Path A read must mirror for hydration).
const OCCURRENCE_SELECT = {
  id: true,
  outletId: true,
  status: true,
  checkType: true,
  dueAt: true,
  occurrenceLocalDate: true,
  timezone: true,
  assigneeRole: true,
  assigneeUserId: true,
  configSnapshot: true,
  taskTemplate: { select: { id: true, title: true, checkType: true, requiredEvidence: true } },
  outlet: { select: { id: true, name: true, propertyId: true } },
} as const;

// ---- Object types ---------------------------------------------------------------
const TaskTemplateType = builder.objectRef<TemplateShape>("TaskTemplate").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    title: t.exposeString("title"),
    checkType: t.field({ type: CheckTypeEnum, resolve: (tpl) => tpl.checkType }),
    requiredEvidence: t.exposeStringList("requiredEvidence"),
  }),
});

const OutletType = builder.objectRef<OutletShape>("Outlet").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    propertyId: t.exposeID("propertyId"),
  }),
});

const TaskCompletionType = builder.objectRef<{
  id: string;
  result: string;
  isCurrent: boolean;
  version: number;
  recordedAt: Date;
}>("TaskCompletion");
TaskCompletionType.implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    result: t.exposeString("result"),
    isCurrent: t.exposeBoolean("isCurrent"),
    version: t.exposeInt("version"),
    recordedAt: t.string({ resolve: (c) => c.recordedAt.toISOString() }),
    // evidence count batched per-request (F1) — never a per-completion query.
    evidenceCount: t.loadable({
      type: "Int",
      resolve: (c) => c.id,
      load: (ids: string[], ctx) => loadEvidenceCounts(ids, ctx),
    }),
  }),
});

const TaskOccurrenceType = builder.objectRef<OccurrenceShape>("TaskOccurrence");
TaskOccurrenceType.implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    outletId: t.exposeID("outletId"),
    status: t.field({ type: OccurrenceStatusEnum, resolve: (o) => o.status }),
    checkType: t.field({ type: CheckTypeEnum, resolve: (o) => o.checkType }),
    dueAt: t.string({ resolve: (o) => o.dueAt.toISOString() }),
    // occurrence_local_date is a pure calendar date (@db.Date, UTC-anchored) -> YYYY-MM-DD.
    occurrenceLocalDate: t.string({
      resolve: (o) => o.occurrenceLocalDate.toISOString().slice(0, 10),
    }),
    timezone: t.exposeString("timezone"),
    assigneeRole: t.field({
      type: OrgRoleEnum,
      nullable: true,
      resolve: (o) => o.assigneeRole,
    }),
    assigneeUserId: t.id({ nullable: true, resolve: (o) => o.assigneeUserId }),
    // Frozen threshold + required-evidence config captured at generation (§8.13).
    configSnapshot: t.field({ type: "JSON", nullable: true, resolve: (o) => o.configSnapshot }),
    template: t.field({ type: TaskTemplateType, resolve: (o) => o.taskTemplate }),
    // current completion batched per-request (F1) — null while pending/due/overdue.
    currentCompletion: t.loadable({
      type: TaskCompletionType,
      nullable: true,
      resolve: (o) => o.id,
      load: (ids: string[], ctx) => loadCurrentCompletions(ids, ctx),
    }),
  }),
});

const OutletOccurrencesType = builder.objectRef<OutletGroupShape>("OutletOccurrences").implement({
  fields: (t) => ({
    outlet: t.field({ type: OutletType, resolve: (g) => g.outlet }),
    occurrences: t.field({ type: [TaskOccurrenceType], resolve: (g) => g.occurrences }),
  }),
});

const ExceptionType = builder.objectRef<ExceptionShape>("Exception").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    status: t.field({ type: ExceptionStatusEnum, resolve: (e) => e.status }),
    severity: t.exposeString("severity"),
    title: t.exposeString("title"),
    detail: t.exposeString("detail", { nullable: true }),
    outletId: t.exposeID("outletId"),
    propertyId: t.exposeID("propertyId"),
    openedAt: t.string({ resolve: (e) => e.openedAt.toISOString() }),
  }),
});

const ExceptionPageType = builder.objectRef<ExceptionPageShape>("ExceptionPage").implement({
  fields: (t) => ({
    items: t.field({ type: [ExceptionType], resolve: (p) => p.items }),
    // Opaque keyset cursor for the next page; null when the list is exhausted (F5).
    nextCursor: t.string({ nullable: true, resolve: (p) => p.nextCursor }),
  }),
});

// Exception statuses that count as "open" for the notification badge (everything not terminal-happy).
const OPEN_EXCEPTION_STATUSES: ExceptionStatus[] = [
  ExceptionStatus.open,
  ExceptionStatus.acknowledged,
  ExceptionStatus.in_progress,
  ExceptionStatus.reopened,
];

// ---- Helpers --------------------------------------------------------------------
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a YYYY-MM-DD arg to the UTC-midnight Date that matches how occurrence_local_date is stored. */
function parseLocalDate(date: string): Date {
  if (!LOCAL_DATE_RE.test(date)) {
    throw new GraphQLError("date must be YYYY-MM-DD");
  }
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new GraphQLError("date is not a valid calendar date");
  return d;
}

/** Today's calendar date at UTC midnight (default for occurrencesToday when no date arg is given). */
function todayUtcDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const MAX_PAGE = 100;
const DEFAULT_PAGE = 20;
function clampLimit(limit: number | null | undefined): number {
  if (limit == null) return DEFAULT_PAGE;
  return Math.max(1, Math.min(MAX_PAGE, Math.trunc(limit)));
}

// ---- Root Query -----------------------------------------------------------------
builder.queryType({
  fields: (t) => ({
    // Today's occurrences grouped by outlet (§11.8). Any authenticated member; property-scoped
    // members see only their in-scope properties (D6 read scope).
    occurrencesToday: t.field({
      type: [OutletOccurrencesType],
      authScopes: { member: true },
      args: {
        outletId: t.arg.id({ required: false }),
        status: t.arg({ type: OccurrenceStatusEnum, required: false }),
        date: t.arg.string({ required: false }),
      },
      resolve: async (_root, args, ctx) => {
        if (!ctx.member) return [];
        const org = ctx.member.organizationId;
        const localDate = args.date ? parseLocalDate(args.date) : todayUtcDate();
        const scope = ctx.member.propertyScope;
        const rows: OccurrenceShape[] = await ctx.run(org, (tx) =>
          tx.taskOccurrence.findMany({
            where: {
              organizationId: org,
              occurrenceLocalDate: localDate,
              deletedAt: null,
              ...(args.outletId ? { outletId: String(args.outletId) } : {}),
              ...(args.status ? { status: args.status as OccurrenceStatus } : {}),
              ...(scope.length > 0 ? { propertyId: { in: scope } } : {}),
            },
            select: OCCURRENCE_SELECT,
            orderBy: [{ outletId: "asc" }, { dueAt: "asc" }],
          }),
        );
        // Group contiguously (rows are already ordered by outletId), then order groups by outlet name.
        const groups = new Map<string, OutletGroupShape>();
        for (const row of rows) {
          let group = groups.get(row.outletId);
          if (!group) {
            group = { outlet: row.outlet, occurrences: [] };
            groups.set(row.outletId, group);
          }
          group.occurrences.push(row);
        }
        return [...groups.values()].sort((a, b) => a.outlet.name.localeCompare(b.outlet.name));
      },
    }),

    // A single occurrence by id. Cross-org / missing id -> null (RLS masks it as not-found, D6).
    occurrence: t.field({
      type: TaskOccurrenceType,
      nullable: true,
      authScopes: { member: true },
      args: { id: t.arg.id({ required: true }) },
      resolve: async (_root, args, ctx) => {
        if (!ctx.member) return null;
        const org = ctx.member.organizationId;
        const row = await ctx.run(org, (tx) =>
          tx.taskOccurrence.findFirst({
            where: { id: String(args.id), deletedAt: null },
            select: OCCURRENCE_SELECT,
          }),
        );
        return row;
      },
    }),

    // Notification badge: count of non-terminal exceptions in the org. Triage roles and above.
    openExceptionsCount: t.int({
      authScopes: { minRole: OrgRole.ShiftLeader },
      resolve: async (_root, _args, ctx) => {
        if (!ctx.member) return 0;
        const org = ctx.member.organizationId;
        return ctx.run(org, (tx) =>
          tx.exception.count({
            where: {
              organizationId: org,
              deletedAt: null,
              status: { in: OPEN_EXCEPTION_STATUSES },
            },
          }),
        );
      },
    }),

    // Exceptions list, keyset-paginated newest-first by UUIDv7 id (F5). Triage roles and above.
    exceptions: t.field({
      type: ExceptionPageType,
      authScopes: { minRole: OrgRole.ShiftLeader },
      args: {
        status: t.arg({ type: ExceptionStatusEnum, required: false }),
        cursor: t.arg.string({ required: false }),
        limit: t.arg.int({ required: false }),
      },
      resolve: async (_root, args, ctx) => {
        if (!ctx.member) return { items: [], nextCursor: null };
        const org = ctx.member.organizationId;
        return ctx.run(org, (tx) =>
          keysetPaginate<ExceptionShape>({
            keys: [{ field: "id", direction: "desc" }],
            params: { cursor: args.cursor ?? null, limit: clampLimit(args.limit) },
            baseWhere: {
              organizationId: org,
              deletedAt: null,
              ...(args.status ? { status: args.status as ExceptionStatus } : {}),
            },
            fetch: (queryArgs) =>
              tx.exception.findMany({
                ...queryArgs,
                select: {
                  id: true,
                  status: true,
                  severity: true,
                  title: true,
                  detail: true,
                  outletId: true,
                  propertyId: true,
                  openedAt: true,
                },
              }),
          }),
        );
      },
    }),
  }),
});

/** The finished GraphQL schema. Built once; imported by the yoga instance and the SDL printer. */
export const schema = builder.toSchema();
