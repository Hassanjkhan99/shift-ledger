import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";

// #94 — tenant-qualified (composite) foreign keys. The M2 cross-row FKs are COMPOSITE on
// (organization_id, <ref_id>) -> parent(organization_id, id), so a child row tagged for org A can
// NEVER resolve its FK to a parent row belonging to org B. Postgres evaluates FK checks as the table
// owner and bypasses RLS, so before this a caller under withTenant(orgA) could persist a child row
// (organization_id = orgA) that referenced an org-B parent id; the composite key closes that hole at
// the constraint level, independent of RLS. These tests prove: (1) the cross-tenant reference is now
// REJECTED, (2) the same-tenant reference still succeeds, (3) a normal same-org insert path is intact.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Build a full property→outlet→template→scheduled_task→occurrence chain in `orgId` and return the
 *  ids. A fresh chain per call (unique template title, random local date) avoids UNIQUE collisions
 *  across tests. All rows are written under withTenant(orgId) so they are legitimately org-owned. */
async function makeChain(orgId: string): Promise<{
  propertyId: string;
  outletId: string;
  templateId: string;
  scheduledTaskId: string;
  occurrenceId: string;
}> {
  return withTenant(orgId, async (tx) => {
    const property = await tx.property.findFirstOrThrow({ where: { deletedAt: null } });
    const outlet = await tx.outlet.findFirstOrThrow({
      where: { deletedAt: null, propertyId: property.id },
    });
    const template = await tx.taskTemplate.create({
      data: { organizationId: orgId, checkType: "temperature", title: `Fridge ${randomUUID()}` },
      select: { id: true },
    });
    const scheduled = await tx.scheduledTask.create({
      data: {
        organizationId: orgId,
        propertyId: property.id,
        outletId: outlet.id,
        taskTemplateId: template.id,
        recurrenceJson: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        recurrenceFreq: "daily",
        timeOfDay: new Date("1970-01-01T06:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
        startsOn: new Date("2026-07-01"),
        isActive: true,
      },
      select: { id: true },
    });
    const occ = await tx.taskOccurrence.create({
      data: {
        organizationId: orgId,
        propertyId: property.id,
        outletId: outlet.id,
        scheduledTaskId: scheduled.id,
        taskTemplateId: template.id,
        checkType: "temperature",
        occurrenceLocalDate: new Date(Date.UTC(2026, 6, Math.floor(Math.random() * 27) + 1)),
        dueAt: new Date("2026-07-03T04:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
      },
      select: { id: true },
    });
    return {
      propertyId: property.id,
      outletId: outlet.id,
      templateId: template.id,
      scheduledTaskId: scheduled.id,
      occurrenceId: occ.id,
    };
  });
}

describe("#94 composite tenant-qualified FKs", () => {
  it("task_occurrence tagged org A cannot reference an org-B property (composite FK rejects)", async () => {
    const orgB = await makeChain(orgBId);
    const orgA = await makeChain(orgAId);

    // organization_id = orgA (RLS WITH CHECK passes), but property_id points at org B's property.
    // The composite FK (org, property_id) -> properties(org, id) has no (orgA, orgB.property) target.
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskOccurrence.create({
          data: {
            organizationId: orgAId,
            propertyId: orgB.propertyId, // cross-tenant parent
            outletId: orgA.outletId,
            scheduledTaskId: orgA.scheduledTaskId,
            taskTemplateId: orgA.templateId,
            checkType: "temperature",
            occurrenceLocalDate: new Date(Date.UTC(2026, 7, 1)),
            dueAt: new Date("2026-08-01T04:00:00Z"),
            timezone: "Europe/Berlin",
            assigneeRole: "KitchenManager",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("exception tagged org A cannot reference an org-B task_occurrence (composite FK rejects)", async () => {
    const orgB = await makeChain(orgBId);
    const orgA = await makeChain(orgAId);

    await expect(
      withTenant(orgAId, (tx) =>
        tx.exception.create({
          data: {
            organizationId: orgAId,
            propertyId: orgA.propertyId,
            outletId: orgA.outletId,
            taskOccurrenceId: orgB.occurrenceId, // cross-tenant parent
            title: "sneaky cross-tenant reference",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("scheduled_task tagged org A cannot reference an org-B outlet (composite FK rejects)", async () => {
    const orgB = await makeChain(orgBId);
    const orgA = await makeChain(orgAId);

    await expect(
      withTenant(orgAId, (tx) =>
        tx.scheduledTask.create({
          data: {
            organizationId: orgAId,
            propertyId: orgA.propertyId,
            outletId: orgB.outletId, // cross-tenant parent
            taskTemplateId: orgA.templateId,
            recurrenceJson: { freq: "daily", interval: 1, timeOfDay: "06:00" },
            recurrenceFreq: "daily",
            timeOfDay: new Date("1970-01-01T06:00:00Z"),
            timezone: "Europe/Berlin",
            assigneeRole: "KitchenManager",
            startsOn: new Date("2026-07-01"),
            isActive: true,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("same-tenant reference still succeeds (composite FK resolves within the org)", async () => {
    const orgA = await makeChain(orgAId);

    const created = await withTenant(orgAId, (tx) =>
      tx.exception.create({
        data: {
          organizationId: orgAId,
          propertyId: orgA.propertyId,
          outletId: orgA.outletId,
          taskOccurrenceId: orgA.occurrenceId,
          title: "legit same-org exception",
        },
        select: { id: true, organizationId: true },
      }),
    );
    expect(created.organizationId).toBe(orgAId);
  });

  it("regression: a normal same-org occurrence chain persists end to end", async () => {
    // makeChain writes property→outlet→template→scheduled_task→occurrence, every cross-row FK
    // resolving inside org A. If any composite FK were wrong (e.g. wrong target columns) this throws.
    const orgA = await makeChain(orgAId);

    const occ = await withTenant(orgAId, (tx) =>
      tx.taskOccurrence.findUniqueOrThrow({
        where: { id: orgA.occurrenceId },
        select: { organizationId: true, propertyId: true, scheduledTaskId: true },
      }),
    );
    expect(occ.organizationId).toBe(orgAId);
    expect(occ.propertyId).toBe(orgA.propertyId);
    expect(occ.scheduledTaskId).toBe(orgA.scheduledTaskId);
  });
});
