import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { buildCompletionInsert } from "../src/lib/completions";

// #53 — task_completions + evidence: RLS isolation, DB-level append-only immutability, and the
// F3 guarantee that recorded_at is server-authoritative while client_reported_at is advisory only.
// The idempotency UNIQUE(organization_id, client_submission_id) is exercised here at the constraint
// level; the idempotent-write semantics (duplicate-vs-conflict contract) are #52.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Create a template → scheduled_task → occurrence chain in `orgId` and return the ids to hang a
 *  completion off. A fresh occurrence per call keeps the partial current-completion UNIQUE from
 *  colliding across tests. */
async function makeOccurrence(orgId: string): Promise<{ occurrenceId: string; userId: string }> {
  return withTenant(orgId, async (tx) => {
    const property = await tx.property.findFirstOrThrow();
    const outlet = await tx.outlet.findFirstOrThrow();
    const membership = await tx.membership.findFirstOrThrow();
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
        occurrenceLocalDate: new Date(Date.UTC(2026, 6, 3)),
        dueAt: new Date("2026-07-03T04:00:00Z"),
        timezone: "Europe/Berlin",
      },
      select: { id: true },
    });
    return { occurrenceId: occ.id, userId: membership.userId };
  });
}

describe("task_completions — RLS isolation", () => {
  it("org A cannot see org B completions; cross-tenant insert is denied", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgBId);
    const csid = randomUUID();
    await withTenant(orgBId, (tx) =>
      tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgBId,
          taskOccurrenceId: occurrenceId,
          clientSubmissionId: csid,
          result: "pass",
          completedBy: userId,
        }),
      }),
    );

    // Org A sees none of org B's completions.
    const leaked = await withTenant(orgAId, (tx) => tx.taskCompletion.findMany());
    expect(leaked.every((c) => c.organizationId === orgAId)).toBe(true);

    // Writing a row tagged for org B while in org A context is rejected by RLS WITH CHECK.
    const aOcc = await makeOccurrence(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskCompletion.create({
          data: buildCompletionInsert({
            organizationId: orgBId, // mismatched tenant
            taskOccurrenceId: aOcc.occurrenceId,
            clientSubmissionId: randomUUID(),
            result: "pass",
            completedBy: aOcc.userId,
          }),
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("task_completions + evidence — append-only (DB-enforced)", () => {
  it("rejects UPDATE and DELETE on a completion", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const completion = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: occurrenceId,
          clientSubmissionId: randomUUID(),
          result: "pass",
          completedBy: userId,
        }),
        select: { id: true },
      }),
    );

    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskCompletion.update({ where: { id: completion.id }, data: { result: "fail" } }),
      ),
    ).rejects.toThrow(/append-only/i);

    await expect(
      withTenant(orgAId, (tx) => tx.taskCompletion.delete({ where: { id: completion.id } })),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects UPDATE and DELETE on an evidence row", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const evidence = await withTenant(orgAId, async (tx) => {
      const completion = await tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: occurrenceId,
          clientSubmissionId: randomUUID(),
          result: "pass",
          completedBy: userId,
        }),
        select: { id: true },
      });
      return tx.evidence.create({
        data: {
          organizationId: orgAId,
          taskCompletionId: completion.id,
          type: "temperature",
          valueNumeric: "3.4",
        },
        select: { id: true },
      });
    });

    await expect(
      withTenant(orgAId, (tx) =>
        tx.evidence.update({ where: { id: evidence.id }, data: { valueText: "tampered" } }),
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      withTenant(orgAId, (tx) => tx.evidence.delete({ where: { id: evidence.id } })),
    ).rejects.toThrow(/append-only/i);
  });
});

describe("F3 — recorded_at is server-authoritative, client_reported_at is advisory", () => {
  it("recorded_at is stamped by the server even when no time is supplied", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const before = Date.now();
    const completion = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: occurrenceId,
          clientSubmissionId: randomUUID(),
          result: "pass",
          completedBy: userId,
        }),
        select: { recordedAt: true, clientReportedAt: true },
      }),
    );
    const recorded = completion.recordedAt.getTime();
    expect(recorded).toBeGreaterThanOrEqual(before - 5_000);
    expect(recorded).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(completion.clientReportedAt).toBeNull();
  });

  it("an absurd client_reported_at does not influence the server recorded_at", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const bogusDeviceTime = new Date("2000-01-01T00:00:00Z"); // wrong/backdated device clock
    const before = Date.now();
    const completion = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: occurrenceId,
          clientSubmissionId: randomUUID(),
          result: "pass",
          completedBy: userId,
          clientReportedAt: bogusDeviceTime,
        }),
        select: { recordedAt: true, clientReportedAt: true },
      }),
    );
    // The device's claimed time is stored verbatim (advisory)…
    expect(completion.clientReportedAt?.toISOString()).toBe("2000-01-01T00:00:00.000Z");
    // …but the compliance timestamp is the server's now(), unaffected by it.
    expect(completion.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  });

  it("buildCompletionInsert never emits a recordedAt key (F3 by construction)", () => {
    const data = buildCompletionInsert({
      organizationId: orgAId,
      taskOccurrenceId: randomUUID(),
      clientSubmissionId: randomUUID(),
      result: "pass",
      completedBy: randomUUID(),
      clientReportedAt: new Date(),
    });
    expect("recordedAt" in data).toBe(false);
    expect("recorded_at" in data).toBe(false);
  });
});

describe("idempotency constraint + versioning defaults", () => {
  it("UNIQUE(organization_id, client_submission_id): a duplicate key in the same org is rejected", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const csid = randomUUID();
    await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: occurrenceId,
          clientSubmissionId: csid,
          result: "pass",
          completedBy: userId,
        }),
      }),
    );
    const other = await makeOccurrence(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskCompletion.create({
          data: buildCompletionInsert({
            organizationId: orgAId,
            taskOccurrenceId: other.occurrenceId,
            clientSubmissionId: csid, // same key, same org → violates UNIQUE
            result: "pass",
            completedBy: other.userId,
          }),
        }),
      ),
    ).rejects.toThrow();
  });

  it("the SAME client_submission_id in two different orgs both succeed (org-scoped)", async () => {
    const csid = randomUUID();
    const a = await makeOccurrence(orgAId);
    const b = await makeOccurrence(orgBId);
    const insert = (org: string, occ: string, user: string) =>
      withTenant(org, (tx) =>
        tx.taskCompletion.create({
          data: buildCompletionInsert({
            organizationId: org,
            taskOccurrenceId: occ,
            clientSubmissionId: csid,
            result: "pass",
            completedBy: user,
          }),
          select: { id: true },
        }),
      );
    await expect(insert(orgAId, a.occurrenceId, a.userId)).resolves.toBeTruthy();
    await expect(insert(orgBId, b.occurrenceId, b.userId)).resolves.toBeTruthy();
  });

  it("defaults version=1/is_current=true, and the partial current-guard rejects a second current row", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const v1 = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: occurrenceId,
          clientSubmissionId: randomUUID(),
          result: "pass",
          completedBy: userId,
        }),
        select: { version: true, isCurrent: true },
      }),
    );
    expect(v1.version).toBe(1);
    expect(v1.isCurrent).toBe(true);

    // A second is_current row for the same occurrence (even at a distinct version) violates the
    // partial UNIQUE (task_occurrence_id) WHERE is_current.
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskCompletion.create({
          data: {
            ...buildCompletionInsert({
              organizationId: orgAId,
              taskOccurrenceId: occurrenceId,
              clientSubmissionId: randomUUID(),
              result: "pass",
              completedBy: userId,
            }),
            version: 2,
            isCurrent: true,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
