import { describe, it, expect } from "vitest";
import { decideEntry } from "../src/lib/app-entry";
import type { MemberOrg } from "../src/lib/member-orgs";

// #132 — pure app-entry redirect matrix (0 / 1 / N orgs, returnTo, no session). No DB: decideEntry is the
// decision logic split out of the root `/` RSC so it is testable without next/navigation.
const orgA: MemberOrg = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Org A",
  slug: "a",
  role: "Owner",
};
const orgB: MemberOrg = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Org B",
  slug: "b",
  role: "Staff",
};

describe("decideEntry (#132)", () => {
  it("no session -> sign-in, carrying a sanitized returnTo", () => {
    expect(decideEntry({ hasSession: false, returnTo: null, orgs: [] })).toEqual({
      kind: "sign-in",
      returnTo: "/",
    });
    expect(decideEntry({ hasSession: false, returnTo: "/x/today", orgs: [] })).toEqual({
      kind: "sign-in",
      returnTo: "/x/today",
    });
  });

  it("no session + off-site returnTo -> sign-in with returnTo collapsed to '/' (no open redirect)", () => {
    expect(decideEntry({ hasSession: false, returnTo: "//evil.com", orgs: [] })).toEqual({
      kind: "sign-in",
      returnTo: "/",
    });
  });

  it("authed + explicit non-root returnTo -> honor it", () => {
    expect(decideEntry({ hasSession: true, returnTo: "/x/today", orgs: [orgA] })).toEqual({
      kind: "redirect",
      path: "/x/today",
    });
  });

  it("authed + off-site returnTo -> sanitized to '/', so falls through to org routing (never off-site)", () => {
    expect(decideEntry({ hasSession: true, returnTo: "https://evil.com", orgs: [orgA] })).toEqual({
      kind: "redirect",
      path: `/${orgA.id}/today`,
    });
  });

  it("authed, no membership -> onboarding", () => {
    expect(decideEntry({ hasSession: true, returnTo: null, orgs: [] })).toEqual({
      kind: "onboarding",
    });
  });

  it("authed, exactly one org -> that org's Today", () => {
    expect(decideEntry({ hasSession: true, returnTo: null, orgs: [orgA] })).toEqual({
      kind: "redirect",
      path: `/${orgA.id}/today`,
    });
  });

  it("authed, multiple orgs -> picker", () => {
    expect(decideEntry({ hasSession: true, returnTo: null, orgs: [orgA, orgB] })).toEqual({
      kind: "picker",
      orgs: [orgA, orgB],
    });
  });
});
