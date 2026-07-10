// Better Auth (#114) — the authentication provider: identity + credential + session management.
//
// Better Auth manages its OWN tables via the Prisma adapter: AuthUser/AuthSession/AuthAccount/
// AuthVerification (mapped to auth_* tables in the 20260709150000_better_auth migration). They are
// global (not tenant-scoped, no RLS) like our existing `users` table, and are named distinctly to avoid
// colliding with our domain models. We deliberately do NOT use Better Auth's organization plugin:
// tenancy stays in our organizations/memberships schema. Better Auth answers "who is this?";
// resolveMemberContext() (http-auth.ts) maps the authenticated email to an ACTIVE membership to get
// { organizationId, userId, role } for RLS + authorization.
//
// LAZY init (mirrors db.ts): building the instance at module load would break `next build` page-data
// collection (no DATABASE_URL there). getAuth() builds it once on first use.
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";

/**
 * Resolve Better Auth's baseURL + trustedOrigins from the environment (#164). Better Auth rejects a
 * request whose Origin matches neither baseURL nor a trusted origin (INVALID_ORIGIN), which breaks
 * sign-in/up on the deployed app when BETTER_AUTH_URL isn't hand-set to the exact serving origin.
 *
 * Vercel injects VERCEL_PROJECT_PRODUCTION_URL (the stable production alias, e.g.
 * shift-ledger-weld.vercel.app) and VERCEL_URL (the current deployment's URL) — hostnames without a
 * scheme. We trust both (plus an explicit BETTER_AUTH_URL), so the production alias AND preview
 * deployments work with no per-URL configuration. baseURL prefers the explicit env, then the production
 * alias, then the deployment URL, then localhost for dev.
 */
export function resolveAuthOrigins(env: Record<string, string | undefined> = process.env): {
  baseURL: string;
  trustedOrigins: string[];
} {
  const https = (host: string | undefined): string | undefined =>
    host ? `https://${host}` : undefined;
  const explicit = env.BETTER_AUTH_URL;
  const production = https(env.VERCEL_PROJECT_PRODUCTION_URL);
  const deployment = https(env.VERCEL_URL);
  const baseURL = explicit ?? production ?? deployment ?? "http://localhost:3000";
  const trustedOrigins = [
    ...new Set([explicit, production, deployment].filter(Boolean) as string[]),
  ];
  return { baseURL, trustedOrigins };
}

function buildAuth() {
  const { baseURL, trustedOrigins } = resolveAuthOrigins();
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-insecure-secret-change-me",
    baseURL,
    trustedOrigins,
    emailAndPassword: { enabled: true },
    // Map Better Auth's core models onto our distinctly-named Prisma models (avoids clashing with the
    // domain `User`/`users`). The Prisma accessor is the camelCase model name.
    user: { modelName: "authUser" },
    session: { modelName: "authSession" },
    account: { modelName: "authAccount" },
    verification: { modelName: "authVerification" },
    // bearer: lets non-browser clients (and tests) carry the session as `Authorization: Bearer <token>`
    // in addition to the default cookie.
    plugins: [bearer()],
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!instance) instance = buildAuth();
  return instance;
}
