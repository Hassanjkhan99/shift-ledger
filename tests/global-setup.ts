// Vitest global setup: bring up an ephemeral PostgreSQL 18 cluster (no Docker), bootstrap
// the app_user role + database, apply migrations as app_user, seed two orgs, and expose
// their ids to tests via provide/inject. Torn down (and data deleted) after the run.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import {
  startCluster,
  bootstrapRoleAndDb,
  APP_DB,
  APP_USER,
  APP_PASSWORD,
} from "../scripts/pg.mjs";
import { seed } from "../prisma/seed";

const PORT = 5433;
const DATA_DIR = "./.pgdata-test";

const APP_URL = `postgresql://${APP_USER}:${APP_PASSWORD}@localhost:${PORT}/${APP_DB}?schema=public`;
const SUPER_URL = `postgresql://postgres:postgres@localhost:${PORT}/${APP_DB}?schema=public`;

export default async function setup({
  provide,
}: {
  provide: (key: "orgAId" | "orgBId", value: string) => void;
}) {
  // Always start from a clean cluster (a prior crashed run may have left the dir behind).
  rmSync(DATA_DIR, { recursive: true, force: true });

  const cluster = await startCluster({
    port: PORT,
    dataDir: DATA_DIR,
    persistent: false,
    quiet: true,
  });
  await bootstrapRoleAndDb({ port: PORT });

  // Apply migrations as app_user (the schema owner). migrate deploy needs no shadow DB.
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, DATABASE_URL: APP_URL },
  });

  const ids = await seed(SUPER_URL);
  provide("orgAId", ids.orgAId);
  provide("orgBId", ids.orgBId);

  return async () => {
    await cluster.stop().catch(() => {});
  };
}

declare module "vitest" {
  interface ProvidedContext {
    orgAId: string;
    orgBId: string;
  }
}
