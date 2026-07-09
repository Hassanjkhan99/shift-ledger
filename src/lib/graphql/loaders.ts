// DataLoader batch functions (#15, F1) — the anti-N+1 core of the Today read.
//
// The Today list resolves N occurrences; each one exposes its current completion and that completion's
// evidence count. Resolved naively that is 1 + 2N queries. Instead each per-row relation is loaded
// through a per-request DataLoader whose batch function below collapses ALL sibling loads into a SINGLE
// tenant-scoped query, so the whole Today read stays a constant, bounded number of round-trips
// regardless of row count. Code review rejects any per-row query in a list path (F1).
//
// Every batch runs through ctx.run (withTenant) so RLS scopes it to the caller's org (D6). A DataLoader
// batch function MUST return one result per input key, in key order — the maps below re-key the batched
// rows back onto the requested ids (missing => null / 0).
import type { GraphQLContext } from "./context";

/** The current-completion projection the Today card renders (§8.14). */
export interface CurrentCompletionRow {
  id: string;
  taskOccurrenceId: string;
  result: string;
  isCurrent: boolean;
  version: number;
  recordedAt: Date;
}

/**
 * Batch-load the CURRENT completion (is_current = true) for a set of occurrence ids in one query.
 * Returns null for an occurrence with no completion yet (pending/due/overdue), aligned by key order.
 */
export async function loadCurrentCompletions(
  occurrenceIds: readonly string[],
  ctx: GraphQLContext,
): Promise<(CurrentCompletionRow | null)[]> {
  if (!ctx.member) return occurrenceIds.map(() => null);
  const org = ctx.member.organizationId;
  const rows = await ctx.run(org, (tx) =>
    tx.taskCompletion.findMany({
      where: { taskOccurrenceId: { in: [...occurrenceIds] }, isCurrent: true },
      select: {
        id: true,
        taskOccurrenceId: true,
        result: true,
        isCurrent: true,
        version: true,
        recordedAt: true,
      },
    }),
  );
  const byOccurrence = new Map(rows.map((r) => [r.taskOccurrenceId, r]));
  return occurrenceIds.map((id) => byOccurrence.get(id) ?? null);
}

/**
 * Batch-count evidence rows per completion id in one grouped query. Returns 0 for a completion with no
 * evidence, aligned by key order.
 */
export async function loadEvidenceCounts(
  completionIds: readonly string[],
  ctx: GraphQLContext,
): Promise<number[]> {
  if (!ctx.member) return completionIds.map(() => 0);
  const org = ctx.member.organizationId;
  const groups = await ctx.run(org, (tx) =>
    tx.evidence.groupBy({
      by: ["taskCompletionId"],
      where: { taskCompletionId: { in: [...completionIds] } },
      _count: { _all: true },
    }),
  );
  const byCompletion = new Map(groups.map((g) => [g.taskCompletionId, g._count._all]));
  return completionIds.map((id) => byCompletion.get(id) ?? 0);
}
