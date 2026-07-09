// The client-side GraphQL fetcher (#15, D10) — graphql-request over native fetch. This is the ONLY
// sanctioned client transport: no Apollo Client, no axios/ky. The generated typed hooks
// (src/generated/graphql.ts, via @graphql-codegen/typescript-react-query) take a GraphQLClient as their
// first argument; createGraphQLClient() builds the shared instance the client islands (#16) pass in.
import { GraphQLClient } from "graphql-request";

/** The single GraphQL endpoint (ADR-b). Client reads only — writes stay Server Actions (#17). */
export const GRAPHQL_ENDPOINT = "/api/graphql";

/**
 * Build a GraphQLClient bound to the endpoint. Sends the session cookie same-origin by default; pass
 * `headers` to carry the active-organization header (x-organization-id) the tenant resolver reads (#16).
 */
export function createGraphQLClient(headers?: Record<string, string>): GraphQLClient {
  return new GraphQLClient(GRAPHQL_ENDPOINT, { credentials: "same-origin", headers });
}
