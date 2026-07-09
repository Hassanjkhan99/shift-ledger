// Path A read (M4 #16, D10) — the RSC → Prisma initial read for the Today dashboard.
//
// It returns the SAME shape as the #15 GraphQL `occurrencesToday` query (OccurrencesTodayQuery), so the
// page can seed the TanStack Query cache via HydrationBoundary under the graphqlQueryKey and the client
// island (Path B) finds a cache hit on mount — no duplicate fetch (D10).
//
// It is a cheap INDEXED read over materialized task_occurrences (§8.13 Today index), NEVER a runtime
// recurrence computation (§9). F1: per-occurrence relations (current completion, evidence count) are
// batch-loaded, so the whole read is a bounded, constant number of queries (3) regardless of row count.
// Runs inside the caller withTenant() tx, so RLS scopes it to the org (D6); an empty property scope =
// whole org, else limited to the member's in-scope properties.
import type { TenantClient } from "./db";
import type { OccurrencesTodayQuery } from "../generated/graphql";

export type TodayOutletGroups = OccurrencesTodayQuery["occurrencesToday"];

export interface ReadTodayArgs {
  organizationId: string;
  /** Member property scope (empty = whole org). */
  propertyScope: string[];
  /** The local calendar date to read, as UTC-midnight Date (matches occurrence_local_date storage). */
  date: Date;
  /** Optional outlet filter. */
  outletId?: string;
}

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

/**
 * Read today's occurrences grouped by outlet, in the GraphQL query shape. Three bounded queries:
 * the occurrence list (with outlet + template joined), the batched current-completion load, and the
 * batched evidence-count load — no per-row queries (F1).
 */
export async function readTodayOutletGroups(
  tx: TenantClient,
  args: ReadTodayArgs,
): Promise<TodayOutletGroups> {
  const rows = await tx.taskOccurrence.findMany({
    where: {
      organizationId: args.organizationId,
      occurrenceLocalDate: args.date,
      deletedAt: null,
      ...(args.outletId ? { outletId: args.outletId } : {}),
      ...(args.propertyScope.length > 0 ? { propertyId: { in: args.propertyScope } } : {}),
    },
    select: OCCURRENCE_SELECT,
    orderBy: [{ outletId: "asc" }, { dueAt: "asc" }],
  });

  // Batch: current completion per occurrence (1 query).
  const occurrenceIds = rows.map((r) => r.id);
  const completions =
    occurrenceIds.length === 0
      ? []
      : await tx.taskCompletion.findMany({
          where: { taskOccurrenceId: { in: occurrenceIds }, isCurrent: true },
          select: {
            id: true,
            taskOccurrenceId: true,
            result: true,
            isCurrent: true,
            version: true,
            recordedAt: true,
          },
        });
  const completionByOccurrence = new Map(completions.map((c) => [c.taskOccurrenceId, c]));

  // Batch: evidence count per completion (1 grouped query).
  const completionIds = completions.map((c) => c.id);
  const evidenceGroups =
    completionIds.length === 0
      ? []
      : await tx.evidence.groupBy({
          by: ["taskCompletionId"],
          where: { taskCompletionId: { in: completionIds } },
          _count: { _all: true },
        });
  const evidenceCountByCompletion = new Map(
    evidenceGroups.map((g) => [g.taskCompletionId, g._count._all]),
  );

  // Assemble outlet-grouped shape identical to the GraphQL resolver's.
  const groups = new Map<string, TodayOutletGroups[number]>();
  for (const row of rows) {
    let group = groups.get(row.outletId);
    if (!group) {
      group = { outlet: row.outlet, occurrences: [] };
      groups.set(row.outletId, group);
    }
    const completion = completionByOccurrence.get(row.id);
    group.occurrences.push({
      id: row.id,
      outletId: row.outletId,
      status: row.status,
      checkType: row.checkType,
      dueAt: row.dueAt.toISOString(),
      occurrenceLocalDate: row.occurrenceLocalDate.toISOString().slice(0, 10),
      timezone: row.timezone,
      assigneeRole: row.assigneeRole,
      assigneeUserId: row.assigneeUserId,
      configSnapshot: row.configSnapshot,
      template: row.taskTemplate,
      currentCompletion: completion
        ? {
            id: completion.id,
            result: completion.result,
            isCurrent: completion.isCurrent,
            version: completion.version,
            recordedAt: completion.recordedAt.toISOString(),
            evidenceCount: evidenceCountByCompletion.get(completion.id) ?? 0,
          }
        : null,
    });
  }

  return [...groups.values()].sort((a, b) => a.outlet.name.localeCompare(b.outlet.name));
}

/** Today's calendar date at UTC midnight — the default `date` when the caller doesn't supply one. */
export function todayUtcDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
