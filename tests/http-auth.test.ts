import { describe, it, expect, inject, afterAll } from "vitest";
import { withTenant, disconnect } from "../src/lib/db";
import { getAuth } from "../src/lib/auth";
import { resolveMemberContext } from "../src/lib/http-auth";
import type { OrgRole } from "../src/generated/prisma/enums";

// #114 — Better Auth-backed session resolution. A signed-up user is mapped to an ACTIVE membership via
// email to produce { organizationId, userId, role }; fail-closed on no session / wrong org / inactive.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Sign up a Better Auth user and give them a membership in `orgId`; returns the bearer token. */
async function signUpWithMembership(
  orgId: string,
  role: OrgRole,
  status = "active",
): Promise<string> {
  const email = `authtest-${Math.floor(Math.random() * 1e9)}@example.com`;
  const signUp = await getAuth().api.signUpEmail({
    body: { email, password: "password12345", name: "Auth Test" },
  });
  await withTenant(orgId, async (tx) => {
    const u = await tx.user.create({ data: { email, name: "Auth Test" }, select: { id: true } });
    await tx.membership.create({
      data: { organizationId: orgId, userId: u.id, role, status, propertyScope: [] },
    });
  });
  return (signUp as { token: string }).token;
}

function req(token: string | null, orgId: string | null): Request {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (orgId) headers.set("x-organization-id", orgId);
  return new Request("http://localhost/api/uploads", { headers });
}

describe("resolveMemberContext (#114)", () => {
  it("resolves { organizationId, userId, role } for an active member", async () => {
    const token = await signUpWithMembership(orgAId, "KitchenManager");
    const ctx = await resolveMemberContext(req(token, orgAId));
    expect(ctx).not.toBeNull();
    expect(ctx!.organizationId).toBe(orgAId);
    expect(ctx!.userId).toBeTruthy();
    expect(ctx!.role).toBe("KitchenManager");
  });

  it("carries the read-only Auditor role through (the route gate decides 403)", async () => {
    const token = await signUpWithMembership(orgAId, "Auditor");
    const ctx = await resolveMemberContext(req(token, orgAId));
    expect(ctx!.role).toBe("Auditor");
  });

  it("returns null with no session (fail closed)", async () => {
    expect(await resolveMemberContext(req(null, orgAId))).toBeNull();
  });

  it("returns null with a session but no x-organization-id header", async () => {
    const token = await signUpWithMembership(orgAId, "Staff");
    expect(await resolveMemberContext(req(token, null))).toBeNull();
  });

  it("returns null for an org the user is not a member of (membership check under RLS)", async () => {
    const token = await signUpWithMembership(orgAId, "Staff"); // member of A only
    expect(await resolveMemberContext(req(token, orgBId))).toBeNull();
  });

  it("returns null when the user's membership is inactive", async () => {
    const token = await signUpWithMembership(orgAId, "Staff", "inactive");
    expect(await resolveMemberContext(req(token, orgAId))).toBeNull();
  });
});
