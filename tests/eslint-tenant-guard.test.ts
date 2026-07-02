import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";

// Regression test for issue #70 — the static tenant-isolation guard. Runs the project's
// real ESLint flat config (eslint.config.mjs) over code snippets to prove that direct
// `prisma` access outside the sanctioned withTenant() wrapper fails `npm run lint`, while
// the allowlisted paths and the documented escape hatch stay clean. This does not touch
// the DB, so it is independent of the embedded-postgres setup.
const eslint = new ESLint();

async function ruleErrors(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  // Count only our guard's violations, ignore any unrelated lint noise in the snippet.
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax").length;
}

const DIRECT_CALL = `import { prisma } from "@/lib/db";
export const count = () => prisma.organization.count();
`;

const NEW_CLIENT = `import { PrismaClient } from "@/generated/prisma/client";
export const client = new PrismaClient();
`;

const COMPLIANT = `import { withTenant } from "@/lib/db";
export const list = (org: string) => withTenant(org, (tx) => tx.property.findMany());
`;

describe("no-direct-prisma guard (#70)", () => {
  it("flags a direct prisma.* call outside the wrapper", async () => {
    expect(await ruleErrors(DIRECT_CALL, "src/app/leaky.ts")).toBeGreaterThan(0);
  });

  it("flags instantiating a raw PrismaClient", async () => {
    expect(await ruleErrors(NEW_CLIENT, "src/app/rogue-client.ts")).toBeGreaterThan(0);
  });

  it("passes compliant code that goes through withTenant()", async () => {
    expect(await ruleErrors(COMPLIANT, "src/app/ok.ts")).toBe(0);
  });

  it("does not flag the sanctioned wrapper module (allowlist)", async () => {
    expect(await ruleErrors(DIRECT_CALL, "src/lib/db.ts")).toBe(0);
  });

  it("does not flag allowlisted seed/test paths", async () => {
    expect(await ruleErrors(DIRECT_CALL, "prisma/seed.ts")).toBe(0);
    expect(await ruleErrors(DIRECT_CALL, "tests/foundation.test.ts")).toBe(0);
  });

  it("honours an inline eslint-disable escape hatch with a reason", async () => {
    const code = `import { prisma } from "@/lib/db";
// eslint-disable-next-line no-restricted-syntax -- auth org resolver reads memberships across orgs pre-tenant
export const count = () => prisma.membership.count();
`;
    expect(await ruleErrors(code, "src/lib/auth-context.ts")).toBe(0);
  });
});
