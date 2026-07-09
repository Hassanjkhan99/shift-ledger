"use client";
// Exceptions notification badge (M4 #16, Path B) — a client island reading the open-exceptions count
// via the #15 typed GraphQL hook, polling every 60s. Rendered only for triage+ roles (OrgNav gates it),
// so the scope-auth minRole check never rejects it. Keyed with the shared graphqlQueryKey convention.
import { useMemo } from "react";
import { useOpenExceptionsCountQuery } from "@/generated/graphql";
import { createGraphQLClient } from "@/lib/graphql/client";
import { graphqlQueryKey } from "@/lib/graphql/query-keys";

export function NotificationBadge({ org }: { org: string }) {
  const client = useMemo(() => createGraphQLClient({ "x-organization-id": org }), [org]);
  const { data } = useOpenExceptionsCountQuery(
    client,
    {},
    { queryKey: graphqlQueryKey({ org }, "OpenExceptionsCount", {}), refetchInterval: 60_000 },
  );
  const count = data?.openExceptionsCount ?? 0;
  if (count <= 0) return null;
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
      {count}
    </span>
  );
}
