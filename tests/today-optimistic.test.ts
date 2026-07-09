import { describe, it, expect } from "vitest";
import {
  partitionSections,
  applyOptimisticComplete,
  remainingCount,
  isDone,
  type TodayOutletGroups,
} from "../src/lib/today-optimistic";
import { graphqlQueryKey } from "../src/lib/graphql/query-keys";
import type { OccurrenceStatus } from "../src/generated/graphql";

// #16 — pure Today view-logic (no DB, no React): section partition, optimistic transform, and the
// hydration key contract the RSC page + client island share.

function occ(
  id: string,
  status: OccurrenceStatus,
): TodayOutletGroups[number]["occurrences"][number] {
  return {
    id,
    outletId: "outlet-1",
    status,
    checkType: "generic",
    dueAt: "2029-01-01T05:00:00.000Z",
    occurrenceLocalDate: "2029-01-01",
    timezone: "Europe/Berlin",
    assigneeRole: "KitchenManager",
    assigneeUserId: null,
    configSnapshot: null,
    template: { id: "tpl-1", title: `Task ${id}`, checkType: "generic", requiredEvidence: [] },
    currentCompletion: null,
  };
}

function groups(...statuses: OccurrenceStatus[]): TodayOutletGroups {
  return [
    {
      outlet: { id: "outlet-1", name: "Main Kitchen", propertyId: "prop-1" },
      occurrences: statuses.map((s, i) => occ(`occ-${i}`, s)),
    },
  ];
}

describe("partitionSections", () => {
  it("splits an outlet's occurrences into overdue / due / done buckets (§12.8)", () => {
    const sections = partitionSections(
      groups("due", "overdue", "completed", "completed_late", "failed", "skipped", "pending"),
    );
    expect(sections).toHaveLength(1);
    const s = sections[0];
    expect(s.overdue.map((o) => o.status)).toEqual(["overdue"]);
    // pending + due are actionable → the `due` bucket.
    expect(s.due.map((o) => o.status).sort()).toEqual(["due", "pending"]);
    // every terminal status is `done`.
    expect(s.done.map((o) => o.status).sort()).toEqual(
      ["completed", "completed_late", "failed", "skipped"].sort(),
    );
  });
});

describe("isDone / remainingCount", () => {
  it("counts only not-yet-done occurrences", () => {
    expect(isDone("completed")).toBe(true);
    expect(isDone("due")).toBe(false);
    expect(remainingCount(groups("due", "overdue", "completed", "skipped"))).toBe(2);
    expect(remainingCount(groups("completed", "failed", "skipped"))).toBe(0);
  });
});

describe("applyOptimisticComplete", () => {
  it("flips the target occurrence to completed and leaves the original untouched (immutable)", () => {
    const before = { occurrencesToday: groups("due", "due") };
    const targetId = before.occurrencesToday[0].occurrences[1].id;

    const after = applyOptimisticComplete(before, targetId);

    // Target flipped in the new tree.
    expect(after.occurrencesToday[0].occurrences[1].status).toBe("completed");
    expect(after.occurrencesToday[0].occurrences[0].status).toBe("due");
    // Original snapshot is untouched, so onError can restore it verbatim.
    expect(before.occurrencesToday[0].occurrences[1].status).toBe("due");
    expect(after).not.toBe(before);
    expect(after.occurrencesToday[0]).not.toBe(before.occurrencesToday[0]);
  });

  it("is a no-op for an unknown occurrence id", () => {
    const before = { occurrencesToday: groups("due") };
    const after = applyOptimisticComplete(before, "does-not-exist");
    expect(after.occurrencesToday[0].occurrences[0].status).toBe("due");
  });
});

describe("hydration key contract (D10)", () => {
  it("the RSC seed key and the client hook key are identical for the same scope + variables", () => {
    // Both the page (setQueryData) and TodayList (useOccurrencesTodayQuery queryKey) derive the key
    // this way; identical inputs → identical key → a cache hit on mount (no duplicate fetch).
    const variables = { date: "2029-01-01" };
    const seedKey = graphqlQueryKey({ org: "org-1" }, "OccurrencesToday", variables);
    const hookKey = graphqlQueryKey({ org: "org-1" }, "OccurrencesToday", variables);
    expect(hookKey).toEqual(seedKey);
    expect(seedKey).toEqual(["org-1", "graphql", "OccurrencesToday", { date: "2029-01-01" }]);
  });
});
