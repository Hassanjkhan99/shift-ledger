"use client";
// Today live list (M4 #16, Path B, §12.3/§12.8) — a client island reading occurrencesToday via the #15
// typed GraphQL hook, polling every 45s (D10 Option 1; swapping to a subscription later is a document
// change, not a refactor). Completing a task is OPTIMISTIC: onMutate flips the row locally with no
// spinner, onError rolls back + toasts, onSettled invalidates the shared scope key so #17's write and
// this cache reconcile. The row grouping + optimistic transform are the pure, unit-tested helpers in
// today-optimistic.ts.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useOccurrencesTodayQuery,
  type OccurrencesTodayQuery,
  type OccurrencesTodayQueryVariables,
} from "@/generated/graphql";
import { createGraphQLClient } from "@/lib/graphql/client";
import { graphqlQueryKey, graphqlScopeKey } from "@/lib/graphql/query-keys";
import {
  partitionSections,
  applyOptimisticComplete,
  remainingCount,
  type TodayOccurrence,
} from "@/lib/today-optimistic";
import { completeTaskAction } from "@/app/actions/occurrences";

// A task needs the detail form (not one-click complete) when it takes a temperature reading or requires
// any evidence — quick-complete would otherwise record it with no reading/evidence (#159).
function needsInput(occ: TodayOccurrence): boolean {
  return occ.checkType === "temperature" || (occ.template.requiredEvidence?.length ?? 0) > 0;
}

export function TodayList({
  org,
  variables,
}: {
  org: string;
  variables: OccurrencesTodayQueryVariables;
}) {
  const client = useMemo(() => createGraphQLClient({ "x-organization-id": org }), [org]);
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => graphqlQueryKey({ org }, "OccurrencesToday", variables),
    [org, variables],
  );
  const [toast, setToast] = useState<string | null>(null);

  const query = useOccurrencesTodayQuery(client, variables, { queryKey, refetchInterval: 45_000 });

  const complete = useMutation({
    mutationFn: async (vars: { occurrenceId: string; outletId: string }) => {
      const res = await completeTaskAction({
        organizationId: org,
        occurrenceId: vars.occurrenceId,
        outletId: vars.outletId,
        clientSubmissionId: crypto.randomUUID(),
        intent: "complete",
      });
      // Non-ok outcomes (409/422/403) are thrown so onError reverts the optimistic flip + toasts.
      if (res.status !== "ok") {
        throw new Error(res.status === "forbidden" ? res.message : res.status);
      }
      return res;
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<OccurrencesTodayQuery>(queryKey);
      if (previous) {
        queryClient.setQueryData(queryKey, applyOptimisticComplete(previous, vars.occurrenceId));
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      setToast(`Couldn't complete task (${error.message}) — reverted`);
    },
    onSettled: () => {
      // Reconcile against the server (and #17's own invalidation) via the shared scope prefix.
      void queryClient.invalidateQueries({ queryKey: graphqlScopeKey({ org }) });
    },
  });

  const data = query.data;
  if (!data) return null;

  const sections = partitionSections(data.occurrencesToday);
  const remaining = remainingCount(data.occurrencesToday);
  const hasAny = data.occurrencesToday.some((g) => g.occurrences.length > 0);

  if (!hasAny) {
    return <EmptyState message="No tasks scheduled for today." />;
  }

  return (
    <div>
      {remaining === 0 && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          No tasks left today — everything&apos;s done.
        </div>
      )}

      {sections.map((section) => (
        <section key={section.outlet.id} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {section.outlet.name}
          </h2>
          <SectionGroup
            org={org}
            label="Overdue"
            tone="overdue"
            items={section.overdue}
            onComplete={(occ) =>
              complete.mutate({ occurrenceId: occ.id, outletId: section.outlet.id })
            }
            pendingId={complete.isPending ? complete.variables?.occurrenceId : undefined}
          />
          <SectionGroup
            org={org}
            label="Due"
            tone="due"
            items={section.due}
            onComplete={(occ) =>
              complete.mutate({ occurrenceId: occ.id, outletId: section.outlet.id })
            }
            pendingId={complete.isPending ? complete.variables?.occurrenceId : undefined}
          />
          <SectionGroup org={org} label="Done" tone="done" items={section.done} />
        </section>
      ))}

      {toast && (
        <div
          role="alert"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg md:bottom-8 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function SectionGroup({
  org,
  label,
  tone,
  items,
  onComplete,
  pendingId,
}: {
  org: string;
  label: string;
  tone: "due" | "overdue" | "done";
  items: TodayOccurrence[];
  onComplete?: (occ: TodayOccurrence) => void;
  pendingId?: string;
}) {
  if (items.length === 0) return null;
  const toneClass =
    tone === "overdue"
      ? "border-amber-300 dark:border-amber-800"
      : tone === "done"
        ? "border-zinc-200 opacity-70 dark:border-zinc-800"
        : "border-zinc-200 dark:border-zinc-800";
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <ul className="space-y-2">
        {items.map((occ) => (
          <li
            key={occ.id}
            className={`flex items-center justify-between rounded-lg border bg-white p-3 dark:bg-zinc-950 ${toneClass}`}
          >
            <Link href={`/${org}/occurrences/${occ.id}`} className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                {occ.template.title}
              </div>
              <div className="text-xs text-zinc-500">{occ.checkType}</div>
            </Link>
            {onComplete && !needsInput(occ) ? (
              <button
                type="button"
                disabled={pendingId === occ.id}
                onClick={() => onComplete(occ)}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Complete
              </button>
            ) : onComplete ? (
              // A reading/evidence task can't be one-click completed — open the detail form (#159).
              <Link
                href={`/${org}/occurrences/${occ.id}`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Open
              </Link>
            ) : (
              <span className="text-xs font-medium text-zinc-500">{occ.status}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      {message}
    </div>
  );
}
