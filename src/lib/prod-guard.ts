// D13 production-safety guard.
//
// Dev conveniences MUST be hard-gated off in production. This asserts that at server
// startup (called from src/instrumentation.ts). If any dev-only shortcut is enabled while
// NODE_ENV=production we FAIL CLOSED by throwing, so a misconfigured deploy never boots —
// rather than silently shipping a dev backdoor.
//
// The flags below are the day-one contract (D13: "never fix later"). The features they
// gate — role impersonation, GraphQL introspection/playground, relaxed rate limits, Prisma
// Studio — arrive in later milestones, but the guard exists now so they cannot silently
// reach production.

/** Env flags that must never be truthy in production. */
const DEV_ONLY_FLAGS = [
  "ALLOW_ROLE_IMPERSONATION", // dev "log in as any role" switcher (M2+)
  "GRAPHQL_INTROSPECTION", // F7: introspection OFF in prod
  "GRAPHQL_PLAYGROUND", // F7: playground OFF in prod
  "DISABLE_RATE_LIMITS", // relaxed limits are dev-only
  "ENABLE_PRISMA_STUDIO", // Prisma Studio never in prod
] as const;

/** Local/dev database credentials (see .env.example) — never valid in production. */
const DEV_DB_PATTERNS: readonly RegExp[] = [
  /app_user:app_user@/i,
  /postgres:postgres@/i,
  /@localhost[:/]/i,
  /@127\.0\.0\.1[:/]/i,
];

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const isEnabled = (value: string | undefined): boolean =>
  value !== undefined && TRUTHY.has(value.trim().toLowerCase());

/**
 * Throw if any dev-only shortcut is active under NODE_ENV=production; no-op otherwise.
 * `env` is injectable for testing and defaults to process.env.
 */
export function assertProductionSafety(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const violations: string[] = [];

  for (const flag of DEV_ONLY_FLAGS) {
    if (isEnabled(env[flag])) {
      violations.push(`${flag} must not be enabled in production`);
    }
  }

  const dbUrl = env.DATABASE_URL;
  if (dbUrl && DEV_DB_PATTERNS.some((re) => re.test(dbUrl))) {
    violations.push("DATABASE_URL uses local/dev credentials or points at localhost");
  }

  // Better Auth (auth.ts) falls back to a hard-coded dev secret when BETTER_AUTH_SECRET is unset.
  // That fallback must never reach production — a guessable session secret lets sessions be forged.
  // Fail closed so a deploy missing the secret refuses to boot instead of silently using the fallback.
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.trim() === "") {
    violations.push("BETTER_AUTH_SECRET must be set in production");
  }

  if (violations.length > 0) {
    throw new Error(
      `Refusing to boot — dev-only shortcut(s) detected in production (D13):\n- ${violations.join(
        "\n- ",
      )}`,
    );
  }
}
