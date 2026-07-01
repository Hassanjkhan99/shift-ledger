import { describe, it, expect } from "vitest";
import { GET } from "../src/app/api/health/route";

// Unit test for the liveness route. Does not touch the DB, so it's independent of the
// embedded-postgres global setup.
describe("GET /api/health", () => {
  it("returns 200 with { status: 'ok' }", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});
