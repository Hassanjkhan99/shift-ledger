import { describe, it, expect } from "vitest";
import { resolveAuthOrigins } from "../src/lib/auth";

// #164 — Better Auth baseURL + trustedOrigins resolution. Vercel injects VERCEL_PROJECT_PRODUCTION_URL
// (stable alias) and VERCEL_URL (per-deployment) as bare hostnames; both must be trusted so sign-in/up
// doesn't INVALID_ORIGIN on the deployed app without hand-set BETTER_AUTH_URL.

describe("resolveAuthOrigins (#164)", () => {
  it("prefers an explicit BETTER_AUTH_URL for baseURL and trusts it", () => {
    const r = resolveAuthOrigins({ BETTER_AUTH_URL: "https://app.example.com" });
    expect(r.baseURL).toBe("https://app.example.com");
    expect(r.trustedOrigins).toContain("https://app.example.com");
  });

  it("derives baseURL + trusts the Vercel production alias when no explicit URL", () => {
    const r = resolveAuthOrigins({
      VERCEL_PROJECT_PRODUCTION_URL: "shift-ledger-weld.vercel.app",
    });
    expect(r.baseURL).toBe("https://shift-ledger-weld.vercel.app");
    expect(r.trustedOrigins).toContain("https://shift-ledger-weld.vercel.app");
  });

  it("trusts both the production alias and the current deployment URL (preview support)", () => {
    const r = resolveAuthOrigins({
      VERCEL_PROJECT_PRODUCTION_URL: "shift-ledger-weld.vercel.app",
      VERCEL_URL: "shift-ledger-abc123.vercel.app",
    });
    expect(r.trustedOrigins).toEqual(
      expect.arrayContaining([
        "https://shift-ledger-weld.vercel.app",
        "https://shift-ledger-abc123.vercel.app",
      ]),
    );
    // Explicit env still wins for baseURL when present.
    const withExplicit = resolveAuthOrigins({
      BETTER_AUTH_URL: "https://custom.example.com",
      VERCEL_PROJECT_PRODUCTION_URL: "shift-ledger-weld.vercel.app",
    });
    expect(withExplicit.baseURL).toBe("https://custom.example.com");
  });

  it("falls back to localhost with no trusted origins in a bare dev env", () => {
    const r = resolveAuthOrigins({});
    expect(r.baseURL).toBe("http://localhost:3000");
    expect(r.trustedOrigins).toEqual([]);
  });

  it("de-duplicates when the production alias equals the deployment URL", () => {
    const r = resolveAuthOrigins({
      VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app",
      VERCEL_URL: "x.vercel.app",
    });
    expect(r.trustedOrigins).toEqual(["https://x.vercel.app"]);
  });
});
