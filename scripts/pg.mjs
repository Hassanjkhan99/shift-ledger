// Shared embedded-postgres helpers for local dev + tests (no Docker, no admin).
// Provides a real PostgreSQL 18 cluster and an idempotent bootstrap that creates the
// non-superuser `app_user` role and the app database owned by it — so the app/runtime
// connection is subject to RLS (superusers bypass RLS even under FORCE).
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { existsSync } from "node:fs";

export const APP_DB = "shift_ledger";
export const APP_USER = "app_user";
export const APP_PASSWORD = "app_user";

export function createEmbeddedPg({ port, dataDir, persistent = true, quiet = true }) {
  return new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent,
    onLog: quiet ? () => {} : (m) => console.log("[pg]", String(m).trim()),
    onError: (e) => {
      const s = typeof e === "string" ? e.trim() : e;
      if (s) console.error("[pg stderr]", s);
    },
  });
}

/** Initialise the cluster only if the data dir is not already initialised, then start. */
export async function startCluster({ port, dataDir, persistent = true, quiet = true }) {
  const cluster = createEmbeddedPg({ port, dataDir, persistent, quiet });
  if (!existsSync(`${dataDir}/PG_VERSION`)) {
    await cluster.initialise();
  }
  await cluster.start();
  return cluster;
}

/** Idempotently ensure the app_user role + app database (owned by app_user) exist. Runs as superuser. */
export async function bootstrapRoleAndDb({ port }) {
  const admin = new pg.Client({
    host: "localhost",
    port,
    user: "postgres",
    password: "postgres",
    database: "postgres",
  });
  await admin.connect();
  try {
    const role = await admin.query("select 1 from pg_roles where rolname = $1", [APP_USER]);
    if (role.rowCount === 0) {
      // Fixed dev constants (not user input). NOSUPERUSER + NOBYPASSRLS are critical so RLS
      // applies. CREATEDB is dev-only: `prisma migrate dev` needs a shadow database. It does
      // NOT affect RLS enforcement. Production uses `migrate deploy` with a role lacking it.
      await admin.query(
        `CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER CREATEDB NOCREATEROLE NOBYPASSRLS`,
      );
    }
    // Idempotent: ensure an already-created role can make the migrate-dev shadow database.
    await admin.query(`ALTER ROLE ${APP_USER} CREATEDB`);
    const db = await admin.query("select 1 from pg_database where datname = $1", [APP_DB]);
    if (db.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${APP_DB} OWNER ${APP_USER}`);
    }
  } finally {
    await admin.end();
  }

  // Give app_user ownership of the public schema so Prisma migrations (run as app_user) can create objects.
  const appdb = new pg.Client({
    host: "localhost",
    port,
    user: "postgres",
    password: "postgres",
    database: APP_DB,
  });
  await appdb.connect();
  try {
    await appdb.query(`ALTER SCHEMA public OWNER TO ${APP_USER}`);
    await appdb.query(`GRANT ALL ON SCHEMA public TO ${APP_USER}`);
    await appdb.query(`GRANT ALL ON DATABASE ${APP_DB} TO ${APP_USER}`);
  } finally {
    await appdb.end();
  }
}
