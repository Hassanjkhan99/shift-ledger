import { describe, it, expect } from "vitest";
import { decideAuthGate, sanitizeReturnTo, signInUrl } from "../src/lib/auth-gate";
import type { MemberContext } from "../src/lib/http-auth";

// #131 — route-protection decision logic for the (app)/[org] layout, tested pure (no next/navigation).
const ctx: MemberContext = {
  organizationId: "11111111-1111-1111-1111-111111111111",
  userId: "22222222-2222-2222-2222-222222222222",
  role: "KitchenManager",
  propertyScope: [],
};

describe("decideAuthGate (#131)", () => {
  it("no session -> redirect to sign-in carrying returnTo", () => {
    const gate = decideAuthGate({ hasSession: false, ctx: null, pathname: "/org-slug/today" });
    expect(gate.kind).toBe("sign-in");
    expect(gate).toEqual({ kind: "sign-in", returnTo: "/org-slug/today" });
  });

  it("session but no membership -> not-found (no sign-in loop)", () => {
    const gate = decideAuthGate({ hasSession: true, ctx: null, pathname: "/org-slug/today" });
    expect(gate.kind).toBe("not-found");
  });

  it("session + membership -> allow, carrying the member context", () => {
    const gate = decideAuthGate({ hasSession: true, ctx, pathname: "/org-slug/today" });
    expect(gate).toEqual({ kind: "allow", ctx });
  });
});

describe("sanitizeReturnTo (open-redirect guard, #131)", () => {
  it("keeps a same-origin absolute path", () => {
    expect(sanitizeReturnTo("/org-slug/today")).toBe("/org-slug/today");
  });

  it.each(["//evil.com", "https://evil.com", "http://evil.com", "evil.com", "", null, undefined])(
    "collapses off-site / relative value %p to /",
    (value) => {
      expect(sanitizeReturnTo(value)).toBe("/");
    },
  );

  // #153 — backslash tricks (browsers normalize `\` to `/`, so these bounce off-site).
  it.each(["/\\evil.com", "/\\/evil.com", "\\/evil.com", "/a\\b", "/\\\\evil.com"])(
    "rejects backslash path %p",
    (value) => {
      expect(sanitizeReturnTo(value)).toBe("/");
    },
  );

  // #153 — never redirect back to the auth pages themselves (loop / re-show form).
  it.each(["/sign-in", "/sign-up", "/sign-in?returnTo=/x", "/sign-up#frag"])(
    "collapses self-referential auth path %p to /",
    (value) => {
      expect(sanitizeReturnTo(value)).toBe("/");
    },
  );

  it("normalizes a repeated (array) returnTo to its first element", () => {
    expect(sanitizeReturnTo(["/org-slug/today", "/other"])).toBe("/org-slug/today");
    expect(sanitizeReturnTo(["//evil.com", "/safe"])).toBe("/"); // first element sanitized
    expect(sanitizeReturnTo([])).toBe("/");
  });
});

describe("signInUrl (#131)", () => {
  it("builds an encoded, sanitized sign-in URL", () => {
    expect(signInUrl("/org-slug/today")).toBe("/sign-in?returnTo=%2Forg-slug%2Ftoday");
  });

  it("drops an off-site returnTo before encoding", () => {
    expect(signInUrl("//evil.com")).toBe("/sign-in?returnTo=%2F");
  });
});
