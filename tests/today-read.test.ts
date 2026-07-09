import { describe, it, expect, inject, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect, type TenantClient } from "../src/lib/db";
import { readTodayOutletGroups } from "../src/lib/today-read";

// #16 — Path A RSC read. Proves F1 (bounded query count, no N+1), D6 property-scope filtering, and that
// the read produces the GraphQL query shape (currentCompletion + evidenceCount) for hydration.
const orgAId = inject("orgAId");

afterAll(async () => {
  await disconnect();
});

let userAId: string;
let siteA: { propertyId: string; outletId: string };

beforeAll(async () => {
  userAId = await withTenant(orgAId, (tx) =>
    tx.membership.findFirstOrThrow({ select: { userId: true } }).then((m) => m.userId),
  );
  siteA = await withTenant(orgAId, async (tx) => {
    const property = await tx.property.findFirstOrThrow({ where: { deletedAt: null } });
    const outlet = await tx.outlet.findFirstOrThrow({
      where: { deletedAt: null, propertyId: property.id },
    });
    return { propertyId: property.id, outletId: outlet.id };
  });
});

// Count every Prisma MODEL operation issued through the tx (the F1 probe); $-prefixed GUC statements
// from withTenant are not counted.
function wrapCounting(tx: TenantClient, counter: { n: number }): TenantClient {
  return new Proxy(tx as object, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (
        typeof prop === "string" &&
        !prop.startsWith("$") &&
        value !== null &&
        typeof value === "object"
      ) {
        return new Proxy(value as object, {
          get(model, mProp) {
            const mValue = (model as Record<string | symbol, unknown>)[mProp];
            if (typeof mValue === "function") {
              return (...args: unknown[]) => {
                counter.n += 1;
                return (mValue as (...a: unknown[]) => unknown).apply(model, args);
              };
            }
            return mValue;
          },
        });
      }
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as TenantClient;
}

/** Seed `n` occurrences on `localDate` (each under its own schedule), all with a current completion +
 *  one evidence row, so the read exercises the completion + evidence batch queries. */
async function seed(localDate: string, n: number): Promise<void> {
  const scheduleIds = Array.from({ length: n }, () => randomUUID());
  const occurrenceIds = Array.from({ length: n }, () => randomUUID());
  const dateObj = new Date(`${localDate}T00:00:00.000Z`);
  await withTenant(orgAId, async (tx) => {
    const tpl = await tx.taskTemplate.create({
      data: { organizationId: orgAId, checkType: "temperature", title: `#16 tpl ${randomUUID()}` },
      select: { id: true },
    });
    await tx.scheduledTask.createMany({
      data: scheduleIds.map((id) => ({
        id,
        organizationId: orgAId,
        propertyId: siteA.propertyId,
        outletId: siteA.outletId,
        taskTemplateId: tpl.id,
        recurrenceJson: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        recurrenceFreq: "daily" as const,
        timeOfDay: new Date("1970-01-01T06:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager" as const,
        graceMinutes: 15,
        startsOn: new Date(Date.UTC(2026, 0, 1)),
        isActive: true,
      })),
    });
    await tx.taskOccurrence.createMany({
      data: occurrenceIds.map((id, i) => ({
        id,
        organizationId: orgAId,
        propertyId: siteA.propertyId,
        outletId: siteA.outletId,
        scheduledTaskId: scheduleIds[i],
        taskTemplateId: tpl.id,
        checkType: "temperature" as const,
        occurrenceLocalDate: dateObj,
        dueAt: new Date(`${localDate}T05:00:00Z`),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager" as const,
        status: "completed" as const,
      })),
    });
    const completionIds = occurrenceIds.map(() => randomUUID());
    await tx.taskCompletion.createMany({
      data: occurrenceIds.map((occId, i) => ({
        id: completionIds[i],
        organizationId: orgAId,
        taskOccurrenceId: occId,
        clientSubmissionId: randomUUID(),
        result: "pass" as const,
        completedBy: userAId,
      })),
    });
    await tx.evidence.createMany({
      data: completionIds.map((cId) => ({
        organizationId: orgAId,
        taskCompletionId: cId,
        type: "note" as const,
        valueText: "ok",
      })),
    });
  });
}

describe("readTodayOutletGroups — F1 bounded query count", () => {
  it("issues a constant (<=3) number of queries for 1 vs 200 occurrences", async () => {
    await seed("2030-01-01", 1);
    const c1 = { n: 0 };
    const g1 = await withTenant(orgAId, (tx) =>
      readTodayOutletGroups(wrapCounting(tx, c1), {
        organizationId: orgAId,
        propertyScope: [],
        date: new Date(Date.UTC(2030, 0, 1)),
      }),
    );
    expect(g1.reduce((s, grp) => s + grp.occurrences.length, 0)).toBe(1);

    await seed("2030-02-01", 200);
    const c200 = { n: 0 };
    const g200 = await withTenant(orgAId, (tx) =>
      readTodayOutletGroups(wrapCounting(tx, c200), {
        organizationId: orgAId,
        propertyScope: [],
        date: new Date(Date.UTC(2030, 1, 1)),
      }),
    );
    expect(g200.reduce((s, grp) => s + grp.occurrences.length, 0)).toBe(200);

    // Bounded + constant: occurrence list + batched completion load + batched evidence-count load.
    expect(c200.n).toBe(c1.n);
    expect(c1.n).toBe(3);
  });
});

describe("readTodayOutletGroups — shape + scope", () => {
  it("produces the GraphQL shape with currentCompletion + evidenceCount", async () => {
    await seed("2030-03-01", 1);
    const g = await withTenant(orgAId, (tx) =>
      readTodayOutletGroups(tx, {
        organizationId: orgAId,
        propertyScope: [],
        date: new Date(Date.UTC(2030, 2, 1)),
      }),
    );
    const occurrence = g.flatMap((grp) => grp.occurrences)[0];
    expect(occurrence.outletId).toBe(siteA.outletId);
    expect(occurrence.dueAt).toBe("2030-03-01T05:00:00.000Z");
    expect(occurrence.occurrenceLocalDate).toBe("2030-03-01");
    expect(occurrence.currentCompletion).not.toBeNull();
    expect(occurrence.currentCompletion?.evidenceCount).toBe(1);
  });

  it("property scope limits the read to in-scope properties (D6)", async () => {
    await seed("2030-04-01", 2);
    const date = new Date(Date.UTC(2030, 3, 1));

    // A scope covering the seeded property sees the rows.
    const inScope = await withTenant(orgAId, (tx) =>
      readTodayOutletGroups(tx, {
        organizationId: orgAId,
        propertyScope: [siteA.propertyId],
        date,
      }),
    );
    expect(inScope.reduce((s, grp) => s + grp.occurrences.length, 0)).toBe(2);

    // A scope for some OTHER property sees none.
    const outOfScope = await withTenant(orgAId, (tx) =>
      readTodayOutletGroups(tx, {
        organizationId: orgAId,
        propertyScope: [randomUUID()],
        date,
      }),
    );
    expect(outOfScope).toHaveLength(0);
  });
});
