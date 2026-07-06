import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { submitCompletion } from "../src/lib/completion-write";

// #52 — F2 idempotent completion-write semantics: the duplicate-vs-conflict contract that makes the
// D9 offline queue (#20) safe to replay. DB-backed; reuses the occurrence-fixture pattern from
// tests/completions.test.ts.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

/** Create a template → scheduled_task → occurrence chain in `orgId` and return ids to complete. */
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

/** Count completion rows for an occurrence. */
function completionCount(orgId: string, occurrenceId: string): Promise<number> {
  return withTenant(orgId, (tx) =>
    tx.taskCompletion.count({ where: { taskOccurrenceId: occurrenceId } }),
  );
}

/** Count `completion.created` activity_log rows for a given completion id. */
function createdLogCount(orgId: string, completionId: string): Promise<number> {
  return withTenant(orgId, (tx) =>
    tx.activityLog.count({
      where: {
        subjectType: "taskCompletion",
        subjectId: completionId,
        action: "completion.created",
      },
    }),
  );
}

describe("submitCompletion — F2 idempotent write semantics", () => {
  it("fresh write: returns ok/idempotentReplay=false, one row, one completion.created log", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const csid = randomUUID();

    const res = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: userId,
      }),
    );

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.idempotentReplay).toBe(false);
    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
    expect(await createdLogCount(orgAId, res.completionId)).toBe(1);
  });

  it("double-submit same key: exactly one row, same id, replay flag, no duplicate log", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const csid = randomUUID();
    const input = {
      organizationId: orgAId,
      taskOccurrenceId: occurrenceId,
      clientSubmissionId: csid,
      result: "pass" as const,
      completedBy: userId,
    };

    const first = await withTenant(orgAId, (tx) => submitCompletion(tx, input));
    const second = await withTenant(orgAId, (tx) => submitCompletion(tx, input));

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;
    expect(second.completionId).toBe(first.completionId);
    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);

    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
    // The replay wrote no second activity_log row.
    expect(await createdLogCount(orgAId, first.completionId)).toBe(1);
  });

  it("concurrency: two simultaneous submits with the same key → one row, both resolve to same id", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const csid = randomUUID();
    const input = {
      organizationId: orgAId,
      taskOccurrenceId: occurrenceId,
      clientSubmissionId: csid,
      result: "pass" as const,
      completedBy: userId,
    };

    const [a, b] = await Promise.all([
      withTenant(orgAId, (tx) => submitCompletion(tx, input)),
      withTenant(orgAId, (tx) => submitCompletion(tx, input)),
    ]);

    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;
    // No unique-violation surfaced; both resolve to the same row.
    expect(a.completionId).toBe(b.completionId);
    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
    // Exactly one genuine insert → exactly one creation log.
    expect(await createdLogCount(orgAId, a.completionId)).toBe(1);
  });

  it("payload mismatch: same key, different result → no new row, no mutation, mismatch signal", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const csid = randomUUID();

    const first = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: userId,
        measuredNumeric: "3.4",
      }),
    );
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;

    // Same key, materially different payload (result + reading).
    const mismatch = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "fail",
        completedBy: userId,
        measuredNumeric: "9.9",
      }),
    );

    expect(mismatch.status).toBe("idempotency_payload_mismatch");
    if (mismatch.status !== "idempotency_payload_mismatch") return;
    expect(mismatch.completionId).toBe(first.completionId);

    // No new row and the existing row is untouched.
    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
    const row = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.findUniqueOrThrow({
        where: { id: first.completionId },
        select: { result: true, measuredNumeric: true },
      }),
    );
    expect(row.result).toBe("pass");
    expect(row.measuredNumeric?.toString()).toBe("3.4");
  });

  it("semantic conflict: different key, occurrence already has a current completion → conflict, no write", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);

    const first = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: randomUUID(),
        result: "pass",
        completedBy: userId,
      }),
    );
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;

    const conflict = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: randomUUID(), // DIFFERENT key, same occurrence
        result: "fail",
        completedBy: userId,
      }),
    );

    expect(conflict.status).toBe("conflict");
    if (conflict.status !== "conflict") return;
    expect(conflict.reason).toBe("current-completion-exists");
    expect(conflict.occurrenceId).toBe(occurrenceId);
    expect(conflict.existingCompletionId).toBe(first.completionId);

    // No second completion and no second creation log.
    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
    expect(await createdLogCount(orgAId, first.completionId)).toBe(1);
  });

  it("tenant guard: occurrence id from another org → occurrence_not_found, no row", async () => {
    // Occurrence lives in org B; org A submits against it. RLS scopes the lookup so it is invisible.
    const foreign = await makeOccurrence(orgBId);
    const { userId } = await makeOccurrence(orgAId);

    const res = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: foreign.occurrenceId, // another org's occurrence
        clientSubmissionId: randomUUID(),
        result: "pass",
        completedBy: userId,
      }),
    );

    expect(res.status).toBe("occurrence_not_found");
    if (res.status !== "occurrence_not_found") return;
    expect(res.occurrenceId).toBe(foreign.occurrenceId);
    // No row created in either org for this occurrence.
    expect(await completionCount(orgAId, foreign.occurrenceId)).toBe(0);
    expect(await completionCount(orgBId, foreign.occurrenceId)).toBe(0);
  });

  it("numeric canonicalization: same key, reading '3.40' then '3.4' → ok idempotent replay", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const csid = randomUUID();

    const first = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: userId,
        measuredNumeric: "3.40",
      }),
    );
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;

    // Exact retry with an equivalent numeric form (string "3.4" and number 3.4 both canonicalize).
    const retryStr = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: userId,
        measuredNumeric: "3.4",
      }),
    );
    expect(retryStr.status).toBe("ok");
    if (retryStr.status !== "ok") return;
    expect(retryStr.idempotentReplay).toBe(true);
    expect(retryStr.completionId).toBe(first.completionId);

    const retryNum = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: userId,
        measuredNumeric: 3.4,
      }),
    );
    expect(retryNum.status).toBe("ok");

    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
    expect(await createdLogCount(orgAId, first.completionId)).toBe(1);
  });

  it("actorConfirmationMethod: same key, different method → idempotency_payload_mismatch", async () => {
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const csid = randomUUID();

    const first = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: userId,
        actorConfirmationMethod: "pin",
      }),
    );
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;

    // Same key, same everything except the actor confirmation method (pin → session).
    const mismatch = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: userId,
        actorConfirmationMethod: "session",
      }),
    );
    expect(mismatch.status).toBe("idempotency_payload_mismatch");
    if (mismatch.status !== "idempotency_payload_mismatch") return;
    expect(mismatch.completionId).toBe(first.completionId);
    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
  });

  it("race (a): different keys, pre-inserted winner → loser gets conflict, not a thrown error", async () => {
    // Simulate the concurrent race deterministically: a DIFFERENT client's completion is already the
    // current row, so our createMany(skipDuplicates) skips on the (task_occurrence_id) WHERE is_current
    // index and the count===0 branch must re-read the conflict rather than findUniqueOrThrow on our key.
    const { occurrenceId, userId } = await makeOccurrence(orgAId);

    const winner = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: randomUUID(),
        result: "pass",
        completedBy: userId,
      }),
    );
    expect(winner.status).toBe("ok");
    if (winner.status !== "ok") return;

    const loser = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: randomUUID(), // different key racing the same occurrence
        result: "fail",
        completedBy: userId,
      }),
    );

    expect(loser.status).toBe("conflict");
    if (loser.status !== "conflict") return;
    expect(loser.reason).toBe("current-completion-exists");
    expect(loser.occurrenceId).toBe(occurrenceId);
    expect(loser.existingCompletionId).toBe(winner.completionId);
    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
    expect(await createdLogCount(orgAId, winner.completionId)).toBe(1);
  });

  it("race (b): same key, different payload winner pre-inserted → loser gets payload_mismatch", async () => {
    // The count===0 branch's same-key path must compare the winning row's payload, not blindly return
    // ok. Pre-insert the winner under our key, then submit the SAME key with a different payload.
    const { occurrenceId, userId } = await makeOccurrence(orgAId);
    const csid = randomUUID();

    const winner = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: userId,
        measuredNumeric: "3.4",
      }),
    );
    expect(winner.status).toBe("ok");
    if (winner.status !== "ok") return;

    // Same key, materially different payload. The up-front same-key lookup already catches this, but
    // this exercises the same payload comparison the count===0 branch reuses.
    const loser = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: occurrenceId,
        clientSubmissionId: csid,
        result: "fail",
        completedBy: userId,
        measuredNumeric: "9.9",
      }),
    );

    expect(loser.status).toBe("idempotency_payload_mismatch");
    if (loser.status !== "idempotency_payload_mismatch") return;
    expect(loser.completionId).toBe(winner.completionId);
    expect(await completionCount(orgAId, occurrenceId)).toBe(1);
    expect(await createdLogCount(orgAId, winner.completionId)).toBe(1);
  });

  it("cross-org: identical client_submission_id in two orgs → both succeed, each its own row", async () => {
    const csid = randomUUID();
    const a = await makeOccurrence(orgAId);
    const b = await makeOccurrence(orgBId);

    const resA = await withTenant(orgAId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgAId,
        taskOccurrenceId: a.occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: a.userId,
      }),
    );
    const resB = await withTenant(orgBId, (tx) =>
      submitCompletion(tx, {
        organizationId: orgBId,
        taskOccurrenceId: b.occurrenceId,
        clientSubmissionId: csid,
        result: "pass",
        completedBy: b.userId,
      }),
    );

    expect(resA.status).toBe("ok");
    expect(resB.status).toBe("ok");
    if (resA.status !== "ok" || resB.status !== "ok") return;
    expect(resA.idempotentReplay).toBe(false);
    expect(resB.idempotentReplay).toBe(false);
    expect(resA.completionId).not.toBe(resB.completionId);
    expect(await completionCount(orgAId, a.occurrenceId)).toBe(1);
    expect(await completionCount(orgBId, b.occurrenceId)).toBe(1);
  });
});
