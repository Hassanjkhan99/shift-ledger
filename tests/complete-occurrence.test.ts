import { describe, it, expect, inject, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { completeOccurrence } from "../src/lib/complete-occurrence";
import type { OrgRole, EvidenceType } from "../src/generated/prisma/enums";

// #17 — completion write flow. Exercises the domain orchestrator (complete-occurrence.ts) end-to-end
// against the embedded Postgres: F2 idempotency, F3 server timestamps, F4 audit rows, threshold-forced
// fail + auto-Exception, missing-evidence 422, re-complete 409, and the role gate.
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

interface DueOccurrence {
  occurrenceId: string;
  scheduledTaskId: string;
  templateId: string;
  outletId: string;
  propertyId: string;
}

/**
 * Create a fresh template + scheduled_task + a single `due` occurrence (each test gets its own schedule
 * + template so the fail-path repeated-deviation grouping stays isolated across tests). `configSnapshot`
 * sets the frozen threshold + required-evidence the completion evaluates.
 */
async function makeDueOccurrence(opts?: {
  configSnapshot?: unknown;
  status?: "due" | "overdue" | "pending";
  checkType?: "temperature" | "cleaning" | "generic";
}): Promise<DueOccurrence> {
  const checkType = opts?.checkType ?? "generic";
  return withTenant(orgAId, async (tx) => {
    const tpl = await tx.taskTemplate.create({
      data: { organizationId: orgAId, checkType, title: `#17 tpl ${randomUUID()}` },
      select: { id: true },
    });
    const st = await tx.scheduledTask.create({
      data: {
        organizationId: orgAId,
        propertyId: siteA.propertyId,
        outletId: siteA.outletId,
        taskTemplateId: tpl.id,
        recurrenceJson: { freq: "daily", interval: 1, timeOfDay: "06:00" },
        recurrenceFreq: "daily",
        timeOfDay: new Date("1970-01-01T06:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
        graceMinutes: 15,
        startsOn: new Date(Date.UTC(2026, 0, 1)),
        isActive: true,
      },
      select: { id: true },
    });
    const occ = await tx.taskOccurrence.create({
      data: {
        organizationId: orgAId,
        propertyId: siteA.propertyId,
        outletId: siteA.outletId,
        scheduledTaskId: st.id,
        taskTemplateId: tpl.id,
        checkType,
        configSnapshot: (opts?.configSnapshot ?? {
          targetConfig: null,
          requiredEvidence: [],
        }) as object,
        occurrenceLocalDate: new Date(Date.UTC(2029, 0, 1)),
        dueAt: new Date("2029-01-01T05:00:00Z"),
        timezone: "Europe/Berlin",
        assigneeRole: "KitchenManager",
        status: opts?.status ?? "due",
      },
      select: { id: true },
    });
    return {
      occurrenceId: occ.id,
      scheduledTaskId: st.id,
      templateId: tpl.id,
      outletId: siteA.outletId,
      propertyId: siteA.propertyId,
    };
  });
}

const MANAGER: OrgRole = "KitchenManager";

function baseInput(occurrenceId: string, clientSubmissionId: string) {
  return {
    organizationId: orgAId,
    occurrenceId,
    clientSubmissionId,
    actorUserId: userAId,
    actorRole: MANAGER,
    intent: "complete" as const,
    now: new Date("2029-01-01T06:30:00Z"),
  };
}

// ---- F2 idempotency (primary gate) ----------------------------------------------
describe("completeOccurrence — F2 idempotency", () => {
  it("a retried submit with the same client_submission_id returns the same row, never a duplicate", async () => {
    const occ = await makeDueOccurrence();
    const sub = randomUUID();

    const first = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, baseInput(occ.occurrenceId, sub)),
    );
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    expect(first.idempotentReplay).toBe(false);
    expect(first.occurrenceStatus).toBe("completed");

    // Offline-retry: the ACK was lost, the client re-sends the SAME id.
    const retry = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, baseInput(occ.occurrenceId, sub)),
    );
    expect(retry.status).toBe("ok");
    if (retry.status !== "ok") return;
    expect(retry.idempotentReplay).toBe(true);
    expect(retry.completionId).toBe(first.completionId);

    // Exactly one compliance record after the retry (the one-row proof).
    const count = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.count({ where: { taskOccurrenceId: occ.occurrenceId } }),
    );
    expect(count).toBe(1);
  });

  it("a concurrent double-submit with the same id still yields exactly one completion row", async () => {
    const occ = await makeDueOccurrence();
    const sub = randomUUID();
    const results = await Promise.allSettled([
      withTenant(orgAId, (tx) => completeOccurrence(tx, baseInput(occ.occurrenceId, sub))),
      withTenant(orgAId, (tx) => completeOccurrence(tx, baseInput(occ.occurrenceId, sub))),
    ]);
    // At least one submit succeeds; the unique (org, client_submission_id) constraint prevents a dupe.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const count = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.count({ where: { taskOccurrenceId: occ.occurrenceId } }),
    );
    expect(count).toBe(1);
  });
});

// ---- F3 server-authoritative timestamps -----------------------------------------
describe("completeOccurrence — F3 timestamps", () => {
  it("recorded_at is the server clock; a manipulated client_reported_at is stored but never used", async () => {
    const occ = await makeDueOccurrence();
    const bogusClientTime = new Date("2000-01-01T00:00:00Z"); // wildly wrong device clock
    const before = Date.now();
    const res = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, {
        ...baseInput(occ.occurrenceId, randomUUID()),
        clientReportedAt: bogusClientTime,
      }),
    );
    const after = Date.now();
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;

    const row = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.findUniqueOrThrow({
        where: { id: res.completionId },
        select: { recordedAt: true, clientReportedAt: true },
      }),
    );
    // recorded_at is the trustworthy server "when" — near real time, NOT the bogus client value.
    expect(row.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.recordedAt.getTime()).toBeLessThanOrEqual(after + 1000);
    expect(row.clientReportedAt?.toISOString()).toBe(bogusClientTime.toISOString());
    expect(row.recordedAt.getTime()).not.toBe(bogusClientTime.getTime());
  });
});

// ---- F4 audit rows --------------------------------------------------------------
describe("completeOccurrence — F4 audit trail", () => {
  it("writes the completion.created and occurrence.completed activity_log rows", async () => {
    const occ = await makeDueOccurrence();
    const res = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, baseInput(occ.occurrenceId, randomUUID())),
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;

    const logs = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({
        where: {
          OR: [
            { subjectId: occ.occurrenceId, action: "occurrence.completed" },
            { subjectId: res.completionId, action: "completion.created" },
          ],
        },
        select: { action: true },
      }),
    );
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual(["completion.created", "occurrence.completed"]);
  });

  it("an overdue occurrence completes to completed_late", async () => {
    const occ = await makeDueOccurrence({ status: "overdue" });
    const res = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, baseInput(occ.occurrenceId, randomUUID())),
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.occurrenceStatus).toBe("completed_late");
  });
});

// ---- Threshold auto-evaluation + fail cascade -----------------------------------
describe("completeOccurrence — threshold + fail cascade", () => {
  it("an out-of-threshold temperature via complete is forced to fail and auto-opens an Exception", async () => {
    const occ = await makeDueOccurrence({
      checkType: "temperature",
      configSnapshot: { targetConfig: { minC: 1, maxC: 4 }, requiredEvidence: [] },
    });
    const res = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, {
        ...baseInput(occ.occurrenceId, randomUUID()),
        intent: "complete",
        measuredNumeric: 9, // above maxC → breach
      }),
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.result).toBe("fail");
    expect(res.forcedFail).toBe(true);
    expect(res.occurrenceStatus).toBe("failed");
    expect(res.exceptionId).toBeTruthy();

    // The occurrence.failed transition + the auto-opened exception both exist.
    const exception = await withTenant(orgAId, (tx) =>
      tx.exception.findUniqueOrThrow({
        where: { id: res.exceptionId! },
        select: { taskOccurrenceId: true, status: true, severity: true },
      }),
    );
    expect(exception.taskOccurrenceId).toBe(occ.occurrenceId);
    expect(exception.severity).toBe("critical");
  });

  it("an in-range temperature via complete passes", async () => {
    const occ = await makeDueOccurrence({
      checkType: "temperature",
      configSnapshot: { targetConfig: { minC: 1, maxC: 4 }, requiredEvidence: [] },
    });
    const res = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, { ...baseInput(occ.occurrenceId, randomUUID()), measuredNumeric: 3 }),
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.result).toBe("pass");
    expect(res.occurrenceStatus).toBe("completed");
  });
});

// ---- Semantics: evidence / conflict / not-due / role ----------------------------
describe("completeOccurrence — semantics", () => {
  it("missing required evidence returns missing_evidence and writes no completion", async () => {
    const occ = await makeDueOccurrence({
      configSnapshot: { targetConfig: null, requiredEvidence: ["photo"] },
    });
    const res = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, baseInput(occ.occurrenceId, randomUUID())),
    );
    expect(res.status).toBe("missing_evidence");
    if (res.status !== "missing_evidence") return;
    expect(res.missing).toContain("photo" as EvidenceType);
    const count = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.count({ where: { taskOccurrenceId: occ.occurrenceId } }),
    );
    expect(count).toBe(0);
  });

  it("attaching the required evidence lets the completion through and stores the evidence row", async () => {
    const occ = await makeDueOccurrence({
      configSnapshot: { targetConfig: null, requiredEvidence: ["note"] },
    });
    const res = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, {
        ...baseInput(occ.occurrenceId, randomUUID()),
        evidence: [{ type: "note" as EvidenceType, valueText: "wiped down" }],
      }),
    );
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const evidence = await withTenant(orgAId, (tx) =>
      tx.evidence.count({ where: { taskCompletionId: res.completionId } }),
    );
    expect(evidence).toBe(1);
  });

  it("re-completing a terminal occurrence with a NEW id returns already_completed (409)", async () => {
    const occ = await makeDueOccurrence();
    const first = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, baseInput(occ.occurrenceId, randomUUID())),
    );
    expect(first.status).toBe("ok");

    const second = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, baseInput(occ.occurrenceId, randomUUID())),
    );
    expect(second.status).toBe("already_completed");
    if (second.status !== "already_completed") return;
    expect(second.serverStatus).toBe("completed");
  });

  it("a pending (not-yet-due) occurrence returns not_due and writes nothing", async () => {
    const occ = await makeDueOccurrence({ status: "pending" });
    const res = await withTenant(orgAId, (tx) =>
      completeOccurrence(tx, baseInput(occ.occurrenceId, randomUUID())),
    );
    expect(res.status).toBe("not_due");
    const count = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.count({ where: { taskOccurrenceId: occ.occurrenceId } }),
    );
    expect(count).toBe(0);
  });

  it("a read-only role (Auditor) is rejected by the who-may-trigger guard", async () => {
    const occ = await makeDueOccurrence();
    await expect(
      withTenant(orgAId, (tx) =>
        completeOccurrence(tx, {
          ...baseInput(occ.occurrenceId, randomUUID()),
          actorRole: "Auditor",
        }),
      ),
    ).rejects.toThrow(/may not trigger/);
    const count = await withTenant(orgAId, (tx) =>
      tx.taskCompletion.count({ where: { taskOccurrenceId: occ.occurrenceId } }),
    );
    expect(count).toBe(0);
  });
});
