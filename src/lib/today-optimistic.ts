// Today dashboard pure view-logic (M4 #16) — the optimistic cache transform + section partition the
// client island uses. Kept as pure functions (no React) so the behavior is unit-tested in node: the
// TanStack Query onMutate flips the cache via applyOptimisticComplete(), onError restores the snapshot,
// and the render groups each outlet's occurrences into due / overdue / done via partitionSections().
import type { OccurrencesTodayQuery, OccurrenceStatus } from "../generated/graphql";

export type TodayOutletGroups = OccurrencesTodayQuery["occurrencesToday"];
export type TodayOccurrence = TodayOutletGroups[number]["occurrences"][number];

/** Terminal statuses that render under the "done" section (§12.8). */
const DONE_STATUSES: ReadonlySet<OccurrenceStatus> = new Set<OccurrenceStatus>([
  "completed",
  "completed_late",
  "failed",
  "skipped",
  "cancelled",
]);

export function isDone(status: OccurrenceStatus): boolean {
  return DONE_STATUSES.has(status);
}

export interface OutletSections {
  outlet: TodayOutletGroups[number]["outlet"];
  due: TodayOccurrence[];
  overdue: TodayOccurrence[];
  done: TodayOccurrence[];
}

/**
 * Partition each outlet group's occurrences into the due / overdue / done sections (§12.8). `overdue`
 * is its own status; everything terminal is `done`; pending + due render under `due` (the actionable
 * bucket). Pure — the same input always yields the same grouping.
 */
export function partitionSections(groups: TodayOutletGroups): OutletSections[] {
  return groups.map((group) => {
    const sections: OutletSections = { outlet: group.outlet, due: [], overdue: [], done: [] };
    for (const occ of group.occurrences) {
      if (occ.status === "overdue") sections.overdue.push(occ);
      else if (isDone(occ.status)) sections.done.push(occ);
      else sections.due.push(occ);
    }
    return sections;
  });
}

/** Count of not-yet-done (actionable) occurrences across all groups — drives the "all done" empty state. */
export function remainingCount(groups: TodayOutletGroups): number {
  let n = 0;
  for (const group of groups) {
    for (const occ of group.occurrences) if (!isDone(occ.status)) n += 1;
  }
  return n;
}

/**
 * Optimistically flip one occurrence to `completed` in a cached OccurrencesTodayQuery, immutably (for
 * TanStack Query onMutate). Returns a new object; the original is untouched so onError can restore it.
 * The server reconciles the exact terminal (completed / completed_late / failed) on settle.
 */
export function applyOptimisticComplete(
  data: OccurrencesTodayQuery,
  occurrenceId: string,
  optimisticStatus: OccurrenceStatus = "completed",
): OccurrencesTodayQuery {
  return {
    occurrencesToday: data.occurrencesToday.map((group) => ({
      ...group,
      occurrences: group.occurrences.map((occ) =>
        occ.id === occurrenceId ? { ...occ, status: optimisticStatus } : occ,
      ),
    })),
  };
}
