// POST/GET /api/graphql (#15) — graphql-yoga embedded in a Next.js App Router route handler (ADR-b).
//
// This module may only export HTTP method handlers + config (Next build collects page data by importing
// route modules). The yoga instance + all testable logic live in src/lib/graphql/*. GET serves the
// GraphiQL/landing + introspection in non-prod; POST executes operations. The endpoint is auth- and
// tenant-scoped (D6); F7 hardening (introspection-off in prod, depth/complexity, rate limit) is #19 and
// must land before this is exposed in production.
import { createGraphQLYoga } from "../../../lib/graphql/yoga";

const yoga = createGraphQLYoga({ graphqlEndpoint: "/api/graphql" });

export async function GET(request: Request): Promise<Response> {
  return yoga.fetch(request);
}

export async function POST(request: Request): Promise<Response> {
  return yoga.fetch(request);
}
