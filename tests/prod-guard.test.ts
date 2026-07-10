import { describe, it, expect } from "vitest";
import { assertProductionSafety } from "../src/lib/prod-guard";

// Unit test for the D13 production-safety guard. Passes explicit env objects, so it does
// not depend on the embedded-postgres global setup or the process environment.
const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("assertProductionSafety (D13 prod guard)", () => {
  it("is a no-op outside production, even with dev shortcuts set", () => {
    expect(() =>
      assertProductionSafety({
        NODE_ENV: "development",
        GRAPHQL_INTROSPECTION: "true",
        DATABASE_URL: "postgresql://app_user:app_user@localhost:5432/shift_ledger",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it("passes in production with no dev shortcuts and a remote DB", () => {
    expect(() =>
      assertProductionSafety({
        ...PROD,
        DATABASE_URL: "postgresql://app:secret@ep-neon-eu.neon.tech/shift_ledger",
        BETTER_AUTH_SECRET: "a-real-production-secret",
        LOG_LEVEL: "info",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it.each(["", "   ", undefined])(
    "throws in production when BETTER_AUTH_SECRET is missing/blank (%p)",
    (secret) => {
      expect(() =>
        assertProductionSafety({
          ...PROD,
          DATABASE_URL: "postgresql://app:secret@ep-neon-eu.neon.tech/shift_ledger",
          ...(secret === undefined ? {} : { BETTER_AUTH_SECRET: secret }),
        } as NodeJS.ProcessEnv),
      ).toThrow(/BETTER_AUTH_SECRET/);
    },
  );

  it("does not require BETTER_AUTH_SECRET outside production", () => {
    expect(() =>
      assertProductionSafety({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it.each([
    "ALLOW_ROLE_IMPERSONATION",
    "GRAPHQL_INTROSPECTION",
    "GRAPHQL_PLAYGROUND",
    "DISABLE_RATE_LIMITS",
    "ENABLE_PRISMA_STUDIO",
  ])("throws in production when %s is enabled", (flag) => {
    expect(() => assertProductionSafety({ ...PROD, [flag]: "true" } as NodeJS.ProcessEnv)).toThrow(
      /D13/,
    );
  });

  it("treats various truthy spellings as enabled", () => {
    for (const value of ["1", "TRUE", "Yes", "on"]) {
      expect(() =>
        assertProductionSafety({ ...PROD, ENABLE_PRISMA_STUDIO: value } as NodeJS.ProcessEnv),
      ).toThrow();
    }
  });

  it("ignores falsy or unset flag values", () => {
    expect(() =>
      assertProductionSafety({
        ...PROD,
        GRAPHQL_INTROSPECTION: "false",
        BETTER_AUTH_SECRET: "a-real-production-secret",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it.each([
    "postgresql://app_user:app_user@localhost:5432/shift_ledger",
    "postgresql://postgres:postgres@localhost:5432/shift_ledger",
    "postgresql://app:secret@127.0.0.1:5432/db",
  ])("throws in production when DATABASE_URL is local/dev (%s)", (url) => {
    expect(() =>
      assertProductionSafety({ ...PROD, DATABASE_URL: url } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });
});
