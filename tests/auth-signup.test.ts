import { describe, it, expect, afterAll } from "vitest";
import { getAuth } from "../src/lib/auth";
import { prisma, disconnect } from "../src/lib/db";
import { resolveMemberForOrg } from "../src/lib/http-auth";

// #131 — sign-up establishes a Better Auth session. Mirrors tests/http-auth.test.ts: exercises the same
// signUpEmail path the client form drives, and asserts it creates an auth_user + a usable session, and
// that the fresh user has NO membership yet (domain linkage is onboarding/invite, separate issues).
afterAll(async () => {
  await disconnect();
});

const NIL_ORG = "00000000-0000-0000-0000-000000000000";

describe("Better Auth sign-up (#131)", () => {
  it("creates an auth_user and returns a session token", async () => {
    const email = `signup-${Math.floor(Math.random() * 1e9)}@example.com`;
    const result = await getAuth().api.signUpEmail({
      body: { email, password: "password12345", name: "New User" },
    });

    expect((result as { token: string }).token).toBeTruthy();

    const authUser = await prisma.authUser.findFirst({ where: { email } });
    expect(authUser).not.toBeNull();
    expect(authUser!.email).toBe(email);
  });

  it("rejects a duplicate email (surfaced as an inline error in the UI)", async () => {
    const email = `dup-${Math.floor(Math.random() * 1e9)}@example.com`;
    const body = { email, password: "password12345", name: "Dup User" };
    await getAuth().api.signUpEmail({ body });
    await expect(getAuth().api.signUpEmail({ body })).rejects.toThrow();
  });

  it("leaves the fresh user without a domain membership (fail-closed until onboarded)", async () => {
    const email = `nomember-${Math.floor(Math.random() * 1e9)}@example.com`;
    const signUp = await getAuth().api.signUpEmail({
      body: { email, password: "password12345", name: "No Member" },
    });
    const token = (signUp as { token: string }).token;

    const headers = new Headers({ authorization: `Bearer ${token}` });
    // A session exists, but no membership anywhere -> resolveMemberForOrg is null (the layout would 404,
    // not loop to sign-in).
    expect(await resolveMemberForOrg(headers, NIL_ORG)).toBeNull();
  });
});
