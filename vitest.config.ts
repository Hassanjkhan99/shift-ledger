import { defineConfig, configDefaults } from "vitest/config";

// Tests run against an ephemeral embedded-postgres (PG18) started in tests/global-setup.ts
// on port 5433. The app client connects as the non-superuser app_user so RLS is enforced.
export default defineConfig({
  // Force a SINGLE instance of graphql. Vite otherwise externalizes Pothos/yoga (Node CJS graphql)
  // while the test imports Vite's ESM graphql — two module realms, so the Pothos-built schema fails
  // graphql()'s cross-realm instanceOf guard (#15). Inlining the schema/execution libs routes their
  // graphql import through Vite's graph so every consumer shares one instance; dedupe pins the version.
  resolve: { dedupe: ["graphql", "@pothos/core"] },
  test: {
    server: {
      deps: {
        inline: [/@pothos\//, /graphql-yoga/, /@graphql-yoga\//, /@graphql-tools\//],
      },
    },
    // Ephemeral agent git worktrees under .claude/ carry full repo copies (their own tests/) — never
    // run them: they collide on the single embedded-postgres port. (Not present in CI's fresh checkout.)
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: "postgresql://app_user:app_user@localhost:5433/shift_ledger?schema=public",
      SUPERUSER_DATABASE_URL:
        "postgresql://postgres:postgres@localhost:5433/shift_ledger?schema=public",
      NODE_ENV: "test",
    },
    // Serialize test files so they share the single embedded Postgres cluster.
    fileParallelism: false,
    hookTimeout: 180_000, // binary download + cluster start + migrate + seed (esp. in CI)
    testTimeout: 60_000,
  },
});
