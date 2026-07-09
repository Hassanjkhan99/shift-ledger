// The graphql-yoga instance (#15) — the executable read endpoint, embedded in the Next.js App Router
// route handler (src/app/api/graphql/route.ts) per ADR-b (thin non-REST exception for the typed read
// surface). Kept in lib (not the route module) so it is unit-testable via yoga.fetch and so the route
// file only exports HTTP handlers (Next build "collect page data" requirement).
//
// PRODUCTION GATE: this ships the AUTH + TENANT-SCOPED read surface only. F7 endpoint hardening —
// depth/complexity limits, introspection-off-in-prod, rate limiting, persisted operations — is #19 and
// MUST land before this endpoint is exposed in production.
import { createYoga } from "graphql-yoga";
import { schema } from "./schema";
import { buildContext, type ContextDeps } from "./context";

export interface YogaDeps extends ContextDeps {
  /** GraphQL endpoint path. Must match the route location. */
  graphqlEndpoint?: string;
}

/** Create a configured yoga instance. Deps are injectable so tests can stub auth + the tenant runner. */
export function createGraphQLYoga(deps: YogaDeps = {}) {
  return createYoga<{ request: Request }>({
    schema,
    graphqlEndpoint: deps.graphqlEndpoint ?? "/api/graphql",
    // Yoga's Response is the Fetch API Response the App Router route returns directly.
    fetchAPI: { Response },
    context: ({ request }) => buildContext(request, deps),
  });
}
