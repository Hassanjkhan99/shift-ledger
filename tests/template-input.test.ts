import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createTemplateInput } from "../src/lib/template-input";
import { canManageTemplates } from "../src/lib/permissions";
import { OrgRole } from "../src/generated/prisma/enums";

// #135 — template validation contract + the D7 author gate (pure).

describe("template input validation (#135)", () => {
  const base = { organizationId: randomUUID(), title: "T", requiredEvidence: [] as string[] };

  it("requires min+max for a temperature template and enforces min <= max", () => {
    expect(createTemplateInput.safeParse({ ...base, checkType: "temperature" }).success).toBe(
      false,
    );
    expect(
      createTemplateInput.safeParse({ ...base, checkType: "temperature", minC: 5, maxC: 1 })
        .success,
    ).toBe(false);
    expect(
      createTemplateInput.safeParse({ ...base, checkType: "temperature", minC: 0, maxC: 5 })
        .success,
    ).toBe(true);
  });

  it("does not require a threshold for non-temperature types", () => {
    expect(createTemplateInput.safeParse({ ...base, checkType: "cleaning" }).success).toBe(true);
  });

  it("rejects an unknown check type or evidence type", () => {
    expect(createTemplateInput.safeParse({ ...base, checkType: "smell" }).success).toBe(false);
    expect(
      createTemplateInput.safeParse({ ...base, checkType: "generic", requiredEvidence: ["odor"] })
        .success,
    ).toBe(false);
  });

  it("restricts template authoring to org-wide roles (templates are org-wide config, #152)", () => {
    expect(canManageTemplates(OrgRole.Owner)).toBe(true);
    expect(canManageTemplates(OrgRole.OrgAdmin)).toBe(true);
    // Scoped managers no longer author org-wide templates (would affect out-of-scope sites).
    expect(canManageTemplates(OrgRole.PropertyManager)).toBe(false);
    expect(canManageTemplates(OrgRole.KitchenManager)).toBe(false);
    expect(canManageTemplates(OrgRole.Staff)).toBe(false);
  });
});
