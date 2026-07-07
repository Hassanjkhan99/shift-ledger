// Prisma client (Prisma 7 + pg driver adapter) and the tenant-scoped access wrapper.
//
// The app connects as the NON-superuser `app_user`, so Postgres RLS is enforced. All
// tenant-scoped reads/writes MUST go through withTenant(), which opens a transaction and
// sets the transaction-local GUC `app.current_org_id` that the RLS policies read.
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// Own the pg Pool explicitly so it can be closed cleanly (a Prisma 7 driver adapter does
// not close a pool it was handed; leaving it open keeps the process alive).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pgPool?: Pool };

// LAZY init: the client/pool are created on FIRST use, not at module load. `next build` imports every
// API route module to collect page data, and those routes import this file — but the build environment
// has no DATABASE_URL. Throwing at import time would fail the build; deferring it means importing db.ts
// is side-effect-free and DATABASE_URL is only required when a query actually runs (request/test time).
let poolInstance: Pool | undefined;
let prismaInstance: PrismaClient | undefined;

function client(): PrismaClient {
  if (prismaInstance) return prismaInstance;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  poolInstance = globalForPrisma.pgPool ?? new Pool({ connectionString });
  prismaInstance =
    globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg(poolInstance) });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prismaInstance;
    globalForPrisma.pgPool = poolInstance;
  }
  return prismaInstance;
}

/**
 * The Prisma client. A lazy Proxy: importing it is side-effect-free (safe at `next build`), and the
 * real client + pool are created on the first property access (when DATABASE_URL is available).
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client() as unknown as Record<string | symbol, unknown>;
    const value = c[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(c) : value;
  },
});

/** Close the Prisma client and the underlying pg pool (used by tests / graceful shutdown). */
export async function disconnect(): Promise<void> {
  await prismaInstance?.$disconnect().catch(() => {});
  await poolInstance?.end().catch(() => {});
}

export type TenantClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Run tenant-scoped work inside a transaction with the RLS GUC set transaction-locally.
 *
 * Every query issued via the provided `tx` client is constrained to `organizationId` by
 * Postgres Row-Level Security. `set_config(..., true)` scopes the setting to THIS
 * transaction only, so it cannot leak across pooled connections (CTO decision D6).
 *
 * A query issued outside withTenant() runs with no GUC set and therefore sees zero rows
 * (default-deny).
 */
export function withTenant<T>(
  organizationId: string,
  fn: (tx: TenantClient) => Promise<T>,
): Promise<T> {
  return client().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    // Pin the session timezone to UTC for this transaction. All compliance timestamps are stored
    // and compared as UTC instants (F3); without this, a server-set timestamptz (e.g. a BEFORE
    // INSERT trigger stamping recorded_at) is rendered in the connection's host offset and can be
    // mis-decoded by the driver adapter on a non-UTC machine. SET LOCAL is transaction-scoped, so
    // it is safe under transaction-mode connection pooling (Neon/PgBouncer) — unlike a startup
    // `options` parameter, which the pooler can reject.
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    return fn(tx);
  });
}
