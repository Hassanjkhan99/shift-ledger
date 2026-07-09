// Apply the elevated (superuser) SQL steps that Prisma migrations cannot create as the non-superuser
// app_user (SECURITY DEFINER functions owned by a superuser + the sole-writer guard trigger, #13).
//
// Runs every prisma/superuser/*.sql (sorted) against SUPERUSER_DATABASE_URL. Idempotent (the SQL uses
// CREATE OR REPLACE / DROP TRIGGER IF EXISTS). In prod this runs as a deploy step AFTER
// `prisma migrate deploy`; tests invoke applySuperuser() from tests/global-setup.ts.
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SUPERUSER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "superuser");

/** Apply all superuser SQL files in order. `connectionString` overrides SUPERUSER_DATABASE_URL. */
export async function applySuperuser(connectionString) {
  const url = connectionString ?? process.env.SUPERUSER_DATABASE_URL;
  if (!url) throw new Error("applySuperuser: no connection string (set SUPERUSER_DATABASE_URL)");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const files = readdirSync(SUPERUSER_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of files) {
      await client.query(readFileSync(join(SUPERUSER_DIR, f), "utf8"));
    }
    return files;
  } finally {
    await client.end();
  }
}

// CLI: `node scripts/apply-superuser.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applySuperuser()
    .then((files) => console.log(`[superuser] applied: ${files.join(", ")}`))
    .catch((e) => {
      console.error("[superuser] failed:", e);
      process.exit(1);
    });
}
