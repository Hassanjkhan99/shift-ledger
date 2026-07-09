import { describe, it, expect, inject, afterAll } from "vitest";
import { withTenant, disconnect } from "../src/lib/db";
import { logActivity } from "../src/lib/transition";

// #13 — activity_log tamper-evident hash chain (F6). Proves: log_activity() assigns a per-org dense
// chain_seq and links prev_hash/row_hash; the chain continues from the org's existing head; the
// SECURITY DEFINER verify function confirms integrity; a DIRECT app_user insert is rejected (the
// function is the sole writer); and each org has an independent chain.
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

const HEX64 = /^[0-9a-f]{64}$/;

async function head(org: string): Promise<string | null> {
  const rows = await withTenant(
    org,
    (tx) => tx.$queryRaw<{ h: string | null }[]>`SELECT activity_chain_head() AS h`,
  );
  return rows[0].h;
}
async function verify(org: string): Promise<boolean> {
  const rows = await withTenant(
    org,
    (tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT verify_activity_chain() AS ok`,
  );
  return rows[0].ok;
}

describe("activity_log hash chain (F6)", () => {
  it("log_activity links each appended row to the prior head with a dense per-org chain_seq", async () => {
    const ACTION = "hashchain.test.link";
    const priorHead = await head(orgAId); // the org's current head before we append (null if none yet)

    await withTenant(orgAId, async (tx) => {
      for (let i = 0; i < 3; i++) {
        await logActivity(tx, {
          organizationId: orgAId,
          subjectType: "organization",
          subjectId: orgAId,
          action: ACTION,
          actorLabel: "system:test",
        });
      }
    });

    const rows = await withTenant(orgAId, (tx) =>
      tx.activityLog.findMany({
        where: { action: ACTION },
        orderBy: { chainSeq: "asc" },
        select: { chainSeq: true, prevHash: true, rowHash: true },
      }),
    );
    expect(rows.length).toBe(3);

    // Dense, strictly +1 chain_seq.
    expect(rows[1].chainSeq).toBe(rows[0].chainSeq! + 1n);
    expect(rows[2].chainSeq).toBe(rows[1].chainSeq! + 1n);

    // Linkage: first row points at the prior org head; each subsequent row points at its predecessor.
    expect(rows[0].prevHash).toBe(priorHead);
    expect(rows[1].prevHash).toBe(rows[0].rowHash);
    expect(rows[2].prevHash).toBe(rows[1].rowHash);

    // Each row_hash is a SHA-256 hex digest.
    for (const r of rows) expect(r.rowHash).toMatch(HEX64);

    // The whole org chain recomputes and verifies intact.
    expect(await verify(orgAId)).toBe(true);
    // Head advanced to the last appended row.
    expect(await head(orgAId)).toBe(rows[2].rowHash);
  });

  it("rejects a direct app_user insert into activity_log (log_activity is the sole writer)", async () => {
    await expect(
      withTenant(orgAId, (tx) =>
        tx.activityLog.create({
          data: {
            organizationId: orgAId,
            subjectType: "organization",
            subjectId: orgAId,
            action: "hashchain.test.forge",
            actorLabel: "attacker",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps each org's chain independent and intact", async () => {
    const beforeB = await head(orgBId);
    await withTenant(orgBId, (tx) =>
      logActivity(tx, {
        organizationId: orgBId,
        subjectType: "organization",
        subjectId: orgBId,
        action: "hashchain.test.orgb",
        actorLabel: "system:test",
      }),
    );
    const afterB = await head(orgBId);
    expect(afterB).not.toBe(beforeB);
    expect(afterB).toMatch(HEX64);
    // Both orgs verify independently.
    expect(await verify(orgBId)).toBe(true);
    expect(await verify(orgAId)).toBe(true);
  });
});
