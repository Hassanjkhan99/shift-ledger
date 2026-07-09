// Query-key convention (#15, D10) — the SHARED CONTRACT between the read layer and the write layer.
//
// Every client GraphQL read is cached in TanStack Query under a key of the shape:
//   [org, property?, outlet?, 'graphql', operationName, variables]
// The org is always the most-significant segment; property/outlet are included only when the read is
// scoped to one (so a whole-org read and an outlet-scoped read never collide). The 'graphql' literal
// namespaces these keys away from any non-GraphQL cache entries.
//
// This is exactly the prefix Server Actions (#17) will target with queryClient.invalidateQueries on a
// successful write — e.g. invalidating [org, property, outlet, 'graphql'] drops every cached GraphQL
// read for that outlet. Because TanStack matches queryKeys by PREFIX, callers can invalidate at any
// granularity (whole org, one property, one outlet, or one specific operation+variables).

/** The tenant scope a read belongs to. `property`/`outlet` narrow the cache key when the read is scoped. */
export interface GraphQLQueryScope {
  org: string;
  property?: string;
  outlet?: string;
}

/**
 * Build the canonical TanStack Query key for a GraphQL operation.
 *
 *   graphqlQueryKey({ org }, 'OccurrencesToday', { date })
 *     -> [org, 'graphql', 'OccurrencesToday', { date }]
 *   graphqlQueryKey({ org, property, outlet }, 'OccurrencesToday', { date })
 *     -> [org, property, outlet, 'graphql', 'OccurrencesToday', { date }]
 */
export function graphqlQueryKey(
  scope: GraphQLQueryScope,
  operationName: string,
  variables?: Record<string, unknown>,
): unknown[] {
  const key: unknown[] = [scope.org];
  if (scope.property) key.push(scope.property);
  if (scope.outlet) key.push(scope.outlet);
  key.push("graphql", operationName, variables ?? {});
  return key;
}

/**
 * The invalidation PREFIX for a scope (no operation) — hand to invalidateQueries to drop every cached
 * GraphQL read at that granularity. #17 uses this after a successful write.
 */
export function graphqlScopeKey(scope: GraphQLQueryScope): unknown[] {
  const key: unknown[] = [scope.org];
  if (scope.property) key.push(scope.property);
  if (scope.outlet) key.push(scope.outlet);
  key.push("graphql");
  return key;
}
