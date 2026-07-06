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

  it("a backdated recorded_at supplied directly (bypassing the helper) is overwritten by the server", async () => {
    // buildCompletionInsert never emits recorded_at, so the only way to attempt a backdate is to
    // bypass it and set recordedAt directly through Prisma — the exact bypass the BEFORE INSERT
    // trigger defends against. The stored value must be ≈ now(), not the year-2000 value supplied.
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const backdated = new Date("2000-01-01T00:00:00Z");
    const before = Date.now();
    const completion = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: {
          ...buildCompletionInsert({
            organizationId: orgAId,
            taskOccurrenceId: occurrenceId,
            clientSubmissionId: randomUUID(),
            result: "pass",
            completedBy: userId,
          }),
          recordedAt: backdated, // forced backdate — trigger must overwrite this
        },
        select: { recordedAt: true },
      }),
    );
    // The trigger overwrites the year-2000 backdate with the server clock (withTenant pins the
    // session to UTC, so the timestamptz decodes as the true instant).
    const recorded = completion.recordedAt.getTime();
    expect(recorded).not.toBe(backdated.getTime());
    expect(recorded).toBeGreaterThanOrEqual(before - 5_000);
    expect(recorded).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("stamps recorded_at at insert time (clock_timestamp), not transaction start", async () => {
    // Two completions inserted in the SAME withTenant transaction must get DISTINCT recorded_at
    // values, with the second strictly later than the first. Under now()/CURRENT_TIMESTAMP (fixed at
    // tx START) both would be identical; clock_timestamp() advances mid-transaction. This proves the
    // F3 "trustworthy when" reflects the real insert instant, not the transaction's opening time.
    const first = await makeOccurrence(orgAId);
    const second = await makeOccurrence(orgAId);
    const [a, b] = await withTenant(orgAId, async (tx) => {
      const rowA = await tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: first.occurrenceId,
          clientSubmissionId: randomUUID(),
          result: "pass",
          completedBy: first.userId,
        }),
        select: { recordedAt: true },
      });
      // Advance the wall clock within the same transaction so clock_timestamp() moves on.
      // ($executeRaw returns a row count; pg_sleep returns void which $queryRaw can't deserialize.)
      await tx.$executeRaw`SELECT pg_sleep(0.01)`;
      const rowB = await tx.taskCompletion.create({
        data: buildCompletionInsert({
          organizationId: orgAId,
          taskOccurrenceId: second.occurrenceId,
          clientSubmissionId: randomUUID(),
          result: "pass",
          completedBy: second.userId,
        }),
        select: { recordedAt: true },
      });
      return [rowA, rowB];
    });
    // Strictly later — would be EQUAL under now(); clock_timestamp() advanced across the two inserts.
    expect(b.recordedAt.getTime()).toBeGreaterThan(a.recordedAt.getTime());
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

describe("versioning invariants (DB CHECK constraints)", () => {
  it("rejects a non-positive version (version >= 1)", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
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
            version: 0, // violates task_completions_version_positive
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a v2 without correction provenance (edit_reason + supersedes_id required)", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
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
            isCurrent: false, // avoid the partial current-guard; this is a provenance test
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a v2 that carries only supersedes_id (edit_reason still required)", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const v1 = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: {
          ...buildCompletionInsert({
            organizationId: orgAId,
            taskOccurrenceId: occurrenceId,
            clientSubmissionId: randomUUID(),
            result: "pass",
            completedBy: userId,
          }),
          isCurrent: false,
        },
        select: { id: true },
      }),
    );
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskCompletion.create({
          data: {
            ...buildCompletionInsert({
              organizationId: orgAId,
              taskOccurrenceId: occurrenceId,
              clientSubmissionId: randomUUID(),
              result: "fail",
              completedBy: userId,
            }),
            version: 2,
            isCurrent: false,
            supersedesId: v1.id, // has supersedes_id but no edit_reason → violates biconditional
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a v1 that carries correction metadata (an original cannot supersede)", async () => {
    // A v1 row is the original: it must carry NEITHER supersedes_id NOR edit_reason. The old
    // `version = 1 OR (...)` form let this through because the v1 branch short-circuited; the
    // biconditional forbids it so an "original" can never falsely claim to supersede another record.
    const first = await makeOccurrence(orgAId);
    const target = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: {
          ...buildCompletionInsert({
            organizationId: orgAId,
            taskOccurrenceId: first.occurrenceId,
            clientSubmissionId: randomUUID(),
            result: "pass",
            completedBy: first.userId,
          }),
          isCurrent: false,
        },
        select: { id: true },
      }),
    );
    const second = await makeOccurrence(orgAId);
    await expect(
      withTenant(orgAId, (tx) =>
        tx.taskCompletion.create({
          data: {
            ...buildCompletionInsert({
              organizationId: orgAId,
              taskOccurrenceId: second.occurrenceId,
              clientSubmissionId: randomUUID(),
              result: "pass",
              completedBy: second.userId,
            }),
            // version defaults to 1 but we supply correction metadata → must be rejected.
            supersedesId: target.id,
            editReason: "an original should not carry this",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("accepts a clean v1 that carries neither supersedes_id nor edit_reason", async () => {
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
        select: { version: true, supersedesId: true, editReason: true },
      }),
    );
    expect(v1.version).toBe(1);
    expect(v1.supersedesId).toBeNull();
    expect(v1.editReason).toBeNull();
  });

  it("accepts a v2 that carries edit_reason + supersedes_id", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    // A valid v1 to supersede; make it non-current so v2 can be the current row.
    const v1 = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: {
          ...buildCompletionInsert({
            organizationId: orgAId,
            taskOccurrenceId: occurrenceId,
            clientSubmissionId: randomUUID(),
            result: "pass",
            completedBy: userId,
          }),
          isCurrent: false,
        },
        select: { id: true },
      }),
    );

    const v2 = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.create({
        data: {
          ...buildCompletionInsert({
            organizationId: orgAId,
            taskOccurrenceId: occurrenceId,
            clientSubmissionId: randomUUID(),
            result: "fail",
            completedBy: userId,
          }),
          version: 2,
          isCurrent: true,
          supersedesId: v1.id,
          editReason: "temperature misread on first entry",
        },
        select: { id: true, version: true },
      }),
    );
    expect(v2.version).toBe(2);
  });
});
