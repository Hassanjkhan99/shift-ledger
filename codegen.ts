// graphql-codegen config (#15, D10) — turns the SDL (src/generated/schema.graphql, emitted by
// scripts/print-graphql-schema.ts) + the .graphql operation documents into typed TanStack Query v5 hooks
// backed by the graphql-request fetcher. Run `npm run graphql:generate` (schema + codegen) after
// changing the schema or an operation; the output src/generated/graphql.ts is committed.
import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "src/generated/schema.graphql",
  documents: ["src/lib/graphql/operations/**/*.graphql"],
  ignoreNoDocuments: false,
  generates: {
    "src/generated/graphql.ts": {
      // typescript-operations self-contains the base enums + inlines each operation's selection
      // (preResolveTypes), so the standalone `typescript` base plugin is intentionally omitted: pairing
      // the two in this plugin-version mix double-declares every enum (duplicate identifier). This combo
      // emits each enum exactly once plus the operation types the hooks consume.
      plugins: ["typescript-operations", "typescript-react-query"],
      config: {
        // Emit enums as string-union types (not TS `enum`) — erasable, no runtime enum objects
        // (matches isolatedModules) and keeps the read contract as plain string literals.
        enumsAsTypes: true,
        // graphql-request fetcher: generated hooks take a GraphQLClient as their first arg (no Apollo).
        fetcher: "graphql-request",
        reactQueryVersion: 5,
        // getKey helpers on each hook, consumable by invalidateQueries alongside our graphqlQueryKey().
        exposeQueryKeys: true,
        exposeFetcher: true,
        addSuspenseQuery: true,
      },
    },
  },
};

export default config;
