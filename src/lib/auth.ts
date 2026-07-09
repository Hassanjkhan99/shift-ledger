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

function buildAuth() {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-insecure-secret-change-me",
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
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
