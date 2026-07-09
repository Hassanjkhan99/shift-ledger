import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import {
  createTemplate,
  updateTemplate,
  setTemplateActive,
  getTemplate,
  listTemplates,
} from "../src/lib/templates";
import { evaluateThresholdPass, missingRequiredEvidence } from "../src/lib/complete-occurrence";

// #135 — template CRUD + the SHAPE CONTRACT with #8/#17: the stored targetConfigJson, wrapped into a
// config_snapshot the way generation does, must drive evaluateThresholdPass / missingRequiredEvidence.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

async function actor(orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const u = await tx.user.create({
      data: { email: `tpl-${randomUUID()}@example.com`, name: "Tpl" },
      select: { id: true },
    });
    return u.id;
  });
}

/** Rebuild the config_snapshot exactly as the generator (occurrences.ts) freezes it onto occurrences. */
function snapshotOf(t: {
  targetConfig: { minC?: number; maxC?: number } | null;
  requiredEvidence: string[];
}) {
  return { targetConfig: t.targetConfig, requiredEvidence: t.requiredEvidence };
}

describe("task templates (#135)", () => {
  it("creates a temperature template whose config drives evaluateThresholdPass", async () => {
    const actorUserId = await actor(orgAId);
    const res = await withTenant(orgAId, (tx) =>
      createTemplate(tx, {
        organizationId: orgAId,
        actorUserId,
        title: `Fridge ${randomUUID().slice(0, 6)}`,
        checkType: "temperature",
        requiredEvidence: ["photo", "temperature"],
        targetConfig: { minC: 0, maxC: 5 },
      }),
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;

    const t = await withTenant(orgAId, (tx) => getTemplate(tx, res.templateId));
    expect(t!.targetConfig).toEqual({ minC: 0, maxC: 5 });
    expect(t!.requiredEvidence).toEqual(["photo", "temperature"]);

    const snap = snapshotOf(t!);
    // In-range passes, out-of-range forces fail — proving the stored shape is what #17 reads.
    expect(evaluateThresholdPass("temperature", snap, 3)).toBe(true);
    expect(evaluateThresholdPass("temperature", snap, 9)).toBe(false);
    expect(evaluateThresholdPass("temperature", snap, -1)).toBe(false);
    // Required-evidence contract: a completion with only a photo is still missing the temperature reading.
    expect(missingRequiredEvidence(snap, [{ type: "photo" }])).toEqual(["temperature"]);
    expect(missingRequiredEvidence(snap, [{ type: "photo" }, { type: "temperature" }])).toEqual([]);

    // Audit row written.
    const audit = await withTenant(orgAId, (tx) =>
      tx.activityLog.findFirst({
        where: { subjectId: res.templateId, action: "template.created" },
      }),
    );
    expect(audit).not.toBeNull();
  });

  it("stores no targetConfig for a non-temperature template", async () => {
    const actorUserId = await actor(orgAId);
    const res = await withTenant(orgAId, (tx) =>
      createTemplate(tx, {
        organizationId: orgAId,
        actorUserId,
        title: `Cleaning ${randomUUID().slice(0, 6)}`,
        checkType: "cleaning",
        requiredEvidence: ["checkbox"],
        targetConfig: null,
      }),
    );
    if (res.status !== "ok") throw new Error("setup failed");
    const t = await withTenant(orgAId, (tx) => getTemplate(tx, res.templateId));
    expect(t!.targetConfig).toBeNull();
    // Non-temperature never force-fails on a numeric.
    expect(evaluateThresholdPass("cleaning", snapshotOf(t!), 999)).toBe(true);
  });

  it("edits a template", async () => {
    const actorUserId = await actor(orgAId);
    const res = await withTenant(orgAId, (tx) =>
      createTemplate(tx, {
        organizationId: orgAId,
        actorUserId,
        title: `Edit ${randomUUID().slice(0, 6)}`,
        checkType: "temperature",
        requiredEvidence: ["temperature"],
        targetConfig: { minC: 1, maxC: 4 },
      }),
    );
    if (res.status !== "ok") throw new Error("setup failed");

    const upd = await withTenant(orgAId, (tx) =>
      updateTemplate(tx, {
        organizationId: orgAId,
        actorUserId,
        templateId: res.templateId,
        title: "Edited title",
        checkType: "temperature",
        requiredEvidence: ["temperature", "photo"],
        targetConfig: { minC: 2, maxC: 8 },
      }),
    );
    expect(upd.status).toBe("ok");
    const t = await withTenant(orgAId, (tx) => getTemplate(tx, res.templateId));
    expect(t!.title).toBe("Edited title");
    expect(t!.targetConfig).toEqual({ minC: 2, maxC: 8 });
  });

  it("deactivation hides a template from the active (picker) list", async () => {
    const actorUserId = await actor(orgAId);
    const res = await withTenant(orgAId, (tx) =>
      createTemplate(tx, {
        organizationId: orgAId,
        actorUserId,
        title: `Deact ${randomUUID().slice(0, 6)}`,
        checkType: "generic",
        requiredEvidence: [],
      }),
    );
    if (res.status !== "ok") throw new Error("setup failed");

    await withTenant(orgAId, (tx) =>
      setTemplateActive(tx, {
        organizationId: orgAId,
        actorUserId,
        templateId: res.templateId,
        active: false,
      }),
    );

    const activeIds = await withTenant(orgAId, (tx) =>
      listTemplates(tx).then((ts) => ts.map((t) => t.id)),
    );
    expect(activeIds).not.toContain(res.templateId);
    const allIds = await withTenant(orgAId, (tx) =>
      listTemplates(tx, { includeInactive: true }).then((ts) => ts.map((t) => t.id)),
    );
    expect(allIds).toContain(res.templateId);
  });

  it("does not leak an org A template into org B (RLS, D6)", async () => {
    const actorUserId = await actor(orgAId);
    const res = await withTenant(orgAId, (tx) =>
      createTemplate(tx, {
        organizationId: orgAId,
        actorUserId,
        title: `Tenant ${randomUUID().slice(0, 6)}`,
        checkType: "generic",
        requiredEvidence: [],
      }),
    );
    if (res.status !== "ok") throw new Error("setup failed");
    const fromB = await withTenant(orgBId, (tx) => getTemplate(tx, res.templateId));
    expect(fromB).toBeNull();
  });
});
