import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createOrgInput,
  createPropertyInput,
  slugField,
  timezoneField,
} from "../src/lib/site-input";
import { canManageProperties, canManageOutlets } from "../src/lib/permissions";
import { OrgRole } from "../src/generated/prisma/enums";

// #133 — the validation contract the Server Actions enforce (IANA tz, slug shape, country code) and the
// D7 role/scope predicates. Pure functions, no DB — the auth wrapper is exercised via the domain tests.

describe("timezone validation (#133, §9)", () => {
  it("accepts a real IANA zone and rejects a bogus one", () => {
    expect(timezoneField.safeParse("Europe/Berlin").success).toBe(true);
    expect(timezoneField.safeParse("Europe/Amsterdam").success).toBe(true);
    expect(timezoneField.safeParse("Mars/Phobos").success).toBe(false);
    expect(timezoneField.safeParse("not-a-zone").success).toBe(false);
    expect(timezoneField.safeParse("").success).toBe(false);
  });

  it("rejects a property payload whose timezone is not a valid IANA zone", () => {
    const bad = createPropertyInput.safeParse({
      organizationId: randomUUID(),
      name: "Site",
      timezone: "Middle/Earth",
      countryCode: "DE",
    });
    expect(bad.success).toBe(false);
  });

  it("accepts a well-formed property payload and normalizes optional address absence", () => {
    const ok = createPropertyInput.safeParse({
      organizationId: randomUUID(),
      name: "  Main Site  ",
      timezone: "Europe/Berlin",
      countryCode: "de",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.name).toBe("Main Site"); // trimmed
  });
});

describe("slug validation (#133)", () => {
  it("accepts lowercase hyphenated slugs and normalizes case", () => {
    expect(slugField.safeParse("acme-hotel-group").success).toBe(true);
    const upper = slugField.safeParse("Acme-Group");
    expect(upper.success).toBe(true);
    if (upper.success) expect(upper.data).toBe("acme-group");
  });

  it("rejects spaces, leading/trailing/double hyphens, and too-short slugs", () => {
    expect(slugField.safeParse("acme group").success).toBe(false);
    expect(slugField.safeParse("-acme").success).toBe(false);
    expect(slugField.safeParse("acme--group").success).toBe(false);
    expect(slugField.safeParse("a").success).toBe(false);
  });

  it("rejects an org payload with an invalid timezone", () => {
    const bad = createOrgInput.safeParse({
      name: "Acme",
      slug: "acme",
      defaultTimezone: "Nowhere/Void",
      defaultLocale: "de",
    });
    expect(bad.success).toBe(false);
  });
});

describe("D7 site-management permissions (#133)", () => {
  it("only Owner/OrgAdmin may manage properties", () => {
    expect(canManageProperties(OrgRole.Owner)).toBe(true);
    expect(canManageProperties(OrgRole.OrgAdmin)).toBe(true);
    expect(canManageProperties(OrgRole.PropertyManager)).toBe(false);
    expect(canManageProperties(OrgRole.KitchenManager)).toBe(false);
    expect(canManageProperties(OrgRole.Staff)).toBe(false);
  });

  it("PropertyManager may manage outlets only within their property scope", () => {
    const p1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const p2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // Owner/OrgAdmin: any property.
    expect(canManageOutlets(OrgRole.Owner, [], p1)).toBe(true);
    expect(canManageOutlets(OrgRole.OrgAdmin, [p2], p1)).toBe(true);

    // PropertyManager: in-scope yes, out-of-scope no; empty scope = whole org.
    expect(canManageOutlets(OrgRole.PropertyManager, [p1], p1)).toBe(true);
    expect(canManageOutlets(OrgRole.PropertyManager, [p1], p2)).toBe(false);
    expect(canManageOutlets(OrgRole.PropertyManager, [], p1)).toBe(true);

    // Everyone else: never.
    expect(canManageOutlets(OrgRole.KitchenManager, [], p1)).toBe(false);
    expect(canManageOutlets(OrgRole.Staff, [p1], p1)).toBe(false);
  });
});
