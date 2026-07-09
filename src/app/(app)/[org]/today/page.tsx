// Today command center (M4 #16, §12.8) — the default landing. Path A: an RSC → Prisma read over the
// materialized task_occurrences (never a recurrence computation, §8.13/§9), tenant-scoped (D6) and
// bounded (F1, readTodayOutletGroups). The result seeds the TanStack Query cache under the shared
// graphqlQueryKey via HydrationBoundary, so the client TodayList island (Path B) finds a cache hit on
// mount — no duplicate fetch (D10). The read shape is identical to the #15 GraphQL query shape.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { HydrationBoundary, QueryClient, dehydrate } from "@tanstack/react-query";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { readTodayOutletGroups, todayUtcDate } from "@/lib/today-read";
import { graphqlQueryKey } from "@/lib/graphql/query-keys";
import type { OccurrencesTodayQueryVariables } from "@/generated/graphql";
import { TodayList } from "./TodayList";

export default async function TodayPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx) notFound();

  const date = todayUtcDate();
  const variables: OccurrencesTodayQueryVariables = { date: date.toISOString().slice(0, 10) };

  const groups = await withTenant(ctx.organizationId, (tx) =>
    readTodayOutletGroups(tx, {
      organizationId: ctx.organizationId,
      propertyScope: ctx.propertyScope,
      date,
    }),
  );

  // Seed the cache under the SAME key the client hook uses, in the GraphQL query shape (no dup fetch).
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    graphqlQueryKey({ org: ctx.organizationId }, "OccurrencesToday", variables),
    {
      occurrencesToday: groups,
    },
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Today
      </h1>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <TodayList org={ctx.organizationId} variables={variables} />
      </HydrationBoundary>
    </div>
  );
}
