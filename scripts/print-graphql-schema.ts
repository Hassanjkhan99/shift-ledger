// Emit the Pothos code-first schema to SDL (#15). The schema is built in code (no hand-maintained SDL,
// ADR-b); graphql-codegen reads the printed SDL as its `schema` input. Run via `npm run graphql:schema`.
// Building the schema does not touch the database (the prisma client + auth are lazy), so this runs with
// no DATABASE_URL.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { printSchema } from "graphql";
import { schema } from "../src/lib/graphql/schema";

const outPath = "src/generated/schema.graphql";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${printSchema(schema)}\n`, "utf8");
console.log(`Wrote ${outPath}`);
