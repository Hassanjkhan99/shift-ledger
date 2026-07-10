import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { listExceptions, getExceptionDetail } from "../src/lib/exceptions-read";
import { openException } from "../src/lib/exceptions";
import { createTemplate } from "../src/lib/templates";
import { createSchedule, generateNow } from "../src/lib/schedules";

// #138 — the exceptions read layer: keyset list (F5, no OFFSET), status filter, detail, cross-tenant
// isolation. The triage/CA WRITE cascades are covered by exceptions.test behind the domain edges.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

async function seedException(title: string): Promise<string> {
  const actorUserId = await withTenant(orgAId, async (tx) => {
    const u = await tx.user.create({
      data: { email: `exc-${randomUUID()}@example.com`, name: "Exc" },
      select: { id: true },
    });
    return u.id;
  });
  const outlet = await withTenant(orgAId, (tx) =>
    tx.outlet.findFirst({
      where: { deletedAt: null, property: { deletedAt: null } },
      select: { id: true, propertyId: true },
    }),
  );
  const templateId = await withTenant(orgAId, (tx) =>
    createTemplate(tx, {
      organizationId: orgAId,
      actorUserId,
      title: `Exc Tpl ${randomUUID().slice(0, 6)}`,
      checkType: "generic",
      requiredEvidence: [],
    }).then((r) => r.templateId),
  );
  const scheduleId = await withTenant(orgAId, (tx) =>
    createSchedule(tx, {
      organizationId: orgAId,
      actorUserId,
      outletId: outlet!.id,
      taskTemplateId: templateId,
      recurrence: { freq: "daily", interval: 1, timeOfDay: "06:00" },
      timezone: "Europe/Berlin",
      graceMinutes: 15,
      assigneeRole: "KitchenManager",
      startsOn: new Date().toISOString().slice(0, 10),
    }).then((r) => (r.status === "ok" ? r.scheduleId : "")),
  );
  await withTenant(orgAId, (tx) => generateNow(tx, { organizationId: orgAId, now: new Date() }));
  const occ = await withTenant(orgAId, (tx) =>
    tx.taskOccurrence.findFirst({ where: { scheduledTaskId: scheduleId }, select: { id: true } }),
  );
  const exc = await withTenant(orgAId, (tx) =>
    openException(
      tx,
      {
        organizationId: orgAId,
        propertyId: outlet!.propertyId,
        outletId: outlet!.id,
        taskOccurrenceId: occ!.id,
        title,
      },
      { actorLabel: "system:test" },
    ),
  );
  return exc.id;
}

describe("exceptions read (#138)", () => {
  it("lists exceptions newest-first and paginates by keyset (no OFFSET)", async () => {
    await seedException(`A ${randomUUID().slice(0, 6)}`);
    await seedException(`B ${randomUUID().slice(0, 6)}`);

    const page1 = await withTenant(orgAId, (tx) => listExceptions(tx, { limit: 1 }));
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await withTenant(orgAId, (tx) =>
      listExceptions(tx, { limit: 1, cursor: page1.nextCursor }),
    );
    expect(page2.items).toHaveLength(1);
    // Distinct rows across pages (keyset advanced).
    expect(page2.items[0].id).not.toBe(page1.items[0].id);
  });

  it("filters by status", async () => {
    await seedException(`Open ${randomUUID().slice(0, 6)}`);
    const open = await withTenant(orgAId, (tx) =>
      listExceptions(tx, { status: "open", limit: 50 }),
    );
    expect(open.items.every((e) => e.status === "open")).toBe(true);
    const verified = await withTenant(orgAId, (tx) =>
      listExceptions(tx, { status: "verified", limit: 50 }),
    );
    // Freshly-seeded exceptions are `open`, so none should show under `verified`.
    expect(verified.items.every((e) => e.status === "verified")).toBe(true);
  });

  it("returns detail with corrective actions and isolates across tenants (D6)", async () => {
    const id = await seedException(`Detail ${randomUUID().slice(0, 6)}`);
    const detail = await withTenant(orgAId, (tx) => getExceptionDetail(tx, id));
    expect(detail).not.toBeNull();
    expect(detail!.correctiveActions).toEqual([]);
    expect(detail!.status).toBe("open");

    const fromB = await withTenant(orgBId, (tx) => getExceptionDetail(tx, id));
    expect(fromB).toBeNull();
  });

  it("scopes list + detail to the member's properties (#152)", async () => {
    const id = await seedException(`Scoped ${randomUUID().slice(0, 6)}`);
    const propertyId = await withTenant(orgAId, (tx) =>
      tx.exception
        .findUniqueOrThrow({ where: { id }, select: { propertyId: true } })
        .then((e) => e.propertyId),
    );

    // Out-of-scope: list excludes it and detail is null.
    const outList = await withTenant(orgAId, (tx) =>
      listExceptions(tx, { limit: 100, propertyScope: [randomUUID()] }),
    );
    expect(outList.items.find((e) => e.id === id)).toBeUndefined();
    const outDetail = await withTenant(orgAId, (tx) => getExceptionDetail(tx, id, [randomUUID()]));
    expect(outDetail).toBeNull();

    // In-scope: both resolve.
    const inList = await withTenant(orgAId, (tx) =>
      listExceptions(tx, { limit: 100, propertyScope: [propertyId] }),
    );
    expect(inList.items.find((e) => e.id === id)).toBeDefined();
    const inDetail = await withTenant(orgAId, (tx) => getExceptionDetail(tx, id, [propertyId]));
    expect(inDetail).not.toBeNull();
  });
});
