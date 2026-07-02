import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Tenant-isolation guard (issue #70) — the compile-time complement to the runtime RLS
// gate (#6). D6 tenancy safety depends on EVERY tenant-scoped DB access going through
// `withTenant(orgId, tx => …)` in src/lib/db.ts, which sets the transaction-local
// `app.current_org_id` GUC that RLS reads. A direct `prisma.<model>.<op>()` outside that
// wrapper runs with no tenant context, so RLS default-denies (zero rows) — a silent bug
// that bypasses the intended path. This rule fails `npm run lint` (already run by the
// Build CI gate) when the raw Prisma client is touched outside the sanctioned wrapper.
const noDirectPrisma = {
  "no-restricted-syntax": [
    "error",
    {
      // Any member access on the exported `prisma` client: prisma.property.findMany(),
      // prisma.$transaction(), prisma["organization"].count(), etc.
      selector: "MemberExpression[object.name='prisma']",
      message:
        "Direct `prisma` access is banned outside the tenant wrapper (#70). Tenant-scoped DB access MUST go through withTenant(orgId, tx => …) from src/lib/db.ts so Postgres RLS sees app.current_org_id. Legit exceptions: add the file to the allowlist in eslint.config.mjs, or add an inline `// eslint-disable-next-line no-restricted-syntax -- <reason>`.",
    },
    {
      // Instantiating a second raw client sidesteps the single sanctioned client too.
      selector: "NewExpression[callee.name='PrismaClient']",
      message:
        "Do not instantiate PrismaClient directly (#70). Import the shared `prisma` / `withTenant` from src/lib/db.ts; that module owns the only client and the RLS-scoped wrapper.",
    },
  ],
};

// NARROW allowlist — files where touching the raw client is correct by design. Prefer an
// inline `eslint-disable-next-line no-restricted-syntax -- <reason>` for one-off reads
// (e.g. an auth membership/org resolver that must read a user's memberships ACROSS orgs
// before a tenant context exists) over widening this list.
const directPrismaAllowlist = [
  "src/lib/db.ts", // Defines `prisma` + withTenant — the sanctioned entry point itself.
  "src/lib/auth.ts", // Better Auth adapter/config: user/session/account/verification are
  //                     GLOBAL identity tables (not tenant-scoped, no RLS). (#39–42)
  "prisma/**", // seed.ts runs as the superuser and bypasses RLS by design; migrations too.
  "scripts/**", // Dev/ops + migration scripts run with an elevated / no-tenant context.
  "tests/**", // foundation.test.ts intentionally queries prisma OUTSIDE withTenant to
  //              PROVE the RLS default-deny (the cross-tenant leak test, #6).
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    name: "shift-ledger/no-direct-prisma",
    rules: noDirectPrisma,
  },
  {
    name: "shift-ledger/no-direct-prisma-allowlist",
    files: directPrismaAllowlist,
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
