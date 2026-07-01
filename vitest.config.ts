import { defineConfig } from "vitest/config";

// Tests run against an ephemeral embedded-postgres (PG18) started in tests/global-setup.ts
// on port 5433. The app client connects as the non-superuser app_user so RLS is enforced.
export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL: "postgresql://app_user:app_user@localhost:5433/shift_ledger?schema=public",
      SUPERUSER_DATABASE_URL: "postgresql://postgres:postgres@localhost:5433/shift_ledger?schema=public",
      NODE_ENV: "test",
    },
    // Serialize test files so they share the single embedded Postgres cluster.
    fileParallelism: false,
    hookTimeout: 180_000, // binary download + cluster start + migrate + seed (esp. in CI)
    testTimeout: 60_000,
  },
});
