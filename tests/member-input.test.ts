import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { inviteInput, updateMemberInput } from "../src/lib/member-input";
import { canManageMembers, canAssignMembership } from "../src/lib/permissions";
import { OrgRole } from "../src/generated/prisma/enums";

// #134 — invite/update validation contract + the D7 member-management predicates (pure).

describe("member input validation (#134)", () => {
  it("accepts a valid invite and normalizes the email", () => {
    const ok = inviteInput.safeParse({
      organizationId: randomUUID(),
      email: "  New.Person@Example.COM ",
      role: OrgRole.Staff,
      propertyScope: [],
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.email).toBe("new.person@example.com");
  });

  it("rejects a bad email and a non-role", () => {
    expect(
      inviteInput.safeParse({ organizationId: randomUUID(), email: "nope", role: OrgRole.Staff })
        .success,
    ).toBe(false);
    expect(
      inviteInput.safeParse({ organizationId: randomUUID(), email: "a@b.co", role: "Wizard" })
        .success,
    ).toBe(false);
  });

  it("defaults propertyScope to an empty array", () => {
    const ok = updateMemberInput.safeParse({
      organizationId: randomUUID(),
      membershipId: randomUUID(),
      role: OrgRole.ShiftLeader,
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.propertyScope).toEqual([]);
  });
});

describe("D7 member-management permissions (#134)", () => {
  const p1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const p2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("only Owner/OrgAdmin/PropertyManager reach member management", () => {
    expect(canManageMembers(OrgRole.Owner)).toBe(true);
    expect(canManageMembers(OrgRole.OrgAdmin)).toBe(true);
    expect(canManageMembers(OrgRole.PropertyManager)).toBe(true);
    expect(canManageMembers(OrgRole.KitchenManager)).toBe(false);
    expect(canManageMembers(OrgRole.Staff)).toBe(false);
  });

  it("Owner/OrgAdmin may grant any role + scope", () => {
    expect(canAssignMembership(OrgRole.Owner, [], OrgRole.OrgAdmin, [])).toBe(true);
    expect(canAssignMembership(OrgRole.OrgAdmin, [], OrgRole.Owner, [p1])).toBe(true);
  });

  it("PropertyManager cannot grant admin/manager roles", () => {
    expect(canAssignMembership(OrgRole.PropertyManager, [p1], OrgRole.Owner, [p1])).toBe(false);
    expect(canAssignMembership(OrgRole.PropertyManager, [p1], OrgRole.OrgAdmin, [p1])).toBe(false);
    expect(canAssignMembership(OrgRole.PropertyManager, [p1], OrgRole.PropertyManager, [p1])).toBe(
      false,
    );
  });

  it("PropertyManager may grant a non-admin role only within their scope", () => {
    expect(canAssignMembership(OrgRole.PropertyManager, [p1], OrgRole.Staff, [p1])).toBe(true);
    expect(canAssignMembership(OrgRole.PropertyManager, [p1], OrgRole.Staff, [p2])).toBe(false);
    // must be a concrete (non-empty) scope
    expect(canAssignMembership(OrgRole.PropertyManager, [p1], OrgRole.Staff, [])).toBe(false);
    // whole-org PM (empty scope) may grant any non-admin scope
    expect(canAssignMembership(OrgRole.PropertyManager, [], OrgRole.Staff, [p2])).toBe(true);
  });

  it("other roles can never assign", () => {
    expect(canAssignMembership(OrgRole.KitchenManager, [], OrgRole.Staff, [p1])).toBe(false);
  });
});
