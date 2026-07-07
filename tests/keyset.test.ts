import { describe, it, expect, inject, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { withTenant, disconnect } from "../src/lib/db";
import { logActivity } from "../src/lib/transition";
import {
  encodeCursor,
  decodeCursor,
  buildKeysetWhere,
  buildKeysetOrderBy,
  keysetPaginate,
  type KeysetQueryArgs,
  type KeysetPage,
} from "../src/lib/keyset";

// F5 keyset pagination (#55). Four layers of proof:
//  1. Pure units for the cursor codec + query-fragment builders (no DB).
//  2. The paging loop over an in-memory keyset store: no gaps / no dupes / stability.
//  3. A real pass over the append-only activity_log through withTenant() (RLS-scoped).
//  4. A convention guard asserting no OFFSET / Prisma `skip:` leaks into src/ read paths.

const orgAId = inject("orgAId");

afterAll(async () => {
  await disconnect();
});

describe("cursor codec", () => {
  it("round-trips mixed value types losslessly (incl. bigint beyond Number precision)", () => {
    const bigSeq = BigInt("9007199254740993"); // > Number.MAX_SAFE_INTEGER: must survive as a bigint
    const values = [
      "0193f0aa-1111-7abc-8def-000000000001",
      42,
      true,
      bigSeq,
      new Date("2026-07-03T10:20:30.000Z"),
    ];
    const decoded = decodeCursor(encodeCursor(values));
    expect(decoded[0]).toBe(values[0]);
    expect(decoded[1]).toBe(42);
    expect(decoded[2]).toBe(true);
    expect(decoded[3]).toBe(bigSeq);
    expect(decoded[4]).toBeInstanceOf(Date);
    expect((decoded[4] as Date).toISOString()).toBe("2026-07-03T10:20:30.000Z");
  });

  it("produces url-safe opaque strings (base64url alphabet only)", () => {
    expect(encodeCursor([BigInt("12345678901234567890")])).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("throws on a malformed cursor", () => {
    expect(() => decodeCursor("!!! not base64url json")).toThrow();
  });

  it("rejects a well-formed-JSON cursor that is not a tagged scalar (no {lt:{}} into Prisma)", () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    expect(() => decodeCursor(b64([{}]))).toThrow(); // bare object element
    expect(() => decodeCursor(b64([[1, 2]]))).toThrow(); // nested array element
    expect(() => decodeCursor(b64([null]))).toThrow(); // null element
    expect(() => decodeCursor(b64([{ __t: "date", v: "not-a-date" }]))).toThrow(); // invalid tagged date
    expect(() => decodeCursor(b64([{ __t: "bigint", v: "12x" }]))).toThrow(); // invalid tagged bigint
  });
});

describe("keyset query builders", () => {
  it("single desc key -> field lt cursor", () => {
    expect(buildKeysetWhere([{ field: "seq", direction: "desc" }], [100n])).toEqual({
      seq: { lt: 100n },
    });
  });

  it("single asc key -> field gt cursor", () => {
    expect(buildKeysetWhere([{ field: "seq", direction: "asc" }], [100n])).toEqual({
      seq: { gt: 100n },
    });
  });

  it("first page (no cursor) -> empty where", () => {
    expect(buildKeysetWhere([{ field: "seq" }], null)).toEqual({});
  });

  it("composite key -> lexicographic OR expansion", () => {
    const d = new Date("2026-07-03T00:00:00.000Z");
    expect(
      buildKeysetWhere(
        [
          { field: "date", direction: "desc" },
          { field: "id", direction: "desc" },
        ],
        [d, "uuid-x"],
      ),
    ).toEqual({
      OR: [{ date: { lt: d } }, { date: d, id: { lt: "uuid-x" } }],
    });
  });

  it("orderBy mirrors the key columns, defaulting to desc", () => {
    expect(buildKeysetOrderBy([{ field: "date", direction: "asc" }, { field: "id" }])).toEqual([
      { date: "asc" },
      { id: "desc" },
    ]);
  });

  it("rejects a cursor whose arity does not match the key columns", () => {
    expect(() => buildKeysetWhere([{ field: "seq" }], [1n, 2n])).toThrow();
  });
});

// In-memory single-key (seq desc) store that honours the args keysetPaginate emits, so the
// paging loop is provable without a database.
function seqStore(seqs: bigint[]) {
  const rows = seqs.map((seq) => ({ seq, label: `row-${seq}` }));
  return (args: KeysetQueryArgs): Promise<{ seq: bigint; label: string }[]> => {
    const cond = extractSeqCond(args.where);
    let out = rows.filter((r) => (cond?.lt !== undefined ? r.seq < (cond.lt as bigint) : true));
    out = out.sort((a, b) => (a.seq < b.seq ? 1 : a.seq > b.seq ? -1 : 0)); // desc
    return Promise.resolve(out.slice(0, args.take));
  };
}

function extractSeqCond(where: Record<string, unknown>): { lt?: unknown } | undefined {
  if ("seq" in where) return where.seq as { lt?: unknown };
  if ("AND" in where) {
    for (const clause of where.AND as Record<string, unknown>[]) {
      if ("seq" in clause) return clause.seq as { lt?: unknown };
    }
  }
  return undefined;
}

describe("keysetPaginate — paging loop", () => {
  const keys = [{ field: "seq" as const, direction: "desc" as const }];

  it("pages through the full set exactly once: no gaps, no dupes, correct order", async () => {
    const seqs = Array.from({ length: 25 }, (_, i) => BigInt(i + 1)); // 1..25
    const fetch = seqStore(seqs);

    const seen: bigint[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const p: KeysetPage<{ seq: bigint; label: string }> = await keysetPaginate({
        keys,
        params: { cursor, limit: 10 },
        fetch,
      });
      seen.push(...p.items.map((r) => r.seq));
      cursor = p.nextCursor;
    } while (cursor && ++guard < 100);

    expect(seen).toEqual([...seqs].sort((a, b) => (a < b ? 1 : -1))); // 25..1
    expect(new Set(seen.map(String)).size).toBe(25);
  });

  it("returns nextCursor = null once the list is exhausted", async () => {
    const page = await keysetPaginate({
      keys,
      params: { limit: 10 },
      fetch: seqStore([1n, 2n, 3n]),
    });
    expect(page.items.map((r) => r.seq)).toEqual([3n, 2n, 1n]);
    expect(page.nextCursor).toBeNull();
  });

  it("reports a nextCursor when the last page is exactly full but more remain", async () => {
    // 6 rows, limit 3: two full pages; the first must still hand back a cursor.
    const fetch = seqStore([1n, 2n, 3n, 4n, 5n, 6n]);
    const p1 = await keysetPaginate({ keys, params: { limit: 3 }, fetch });
    expect(p1.items.map((r) => r.seq)).toEqual([6n, 5n, 4n]);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await keysetPaginate({ keys, params: { cursor: p1.nextCursor, limit: 3 }, fetch });
    expect(p2.items.map((r) => r.seq)).toEqual([3n, 2n, 1n]);
    expect(p2.nextCursor).toBeNull();
  });

  it("rejects a non-positive or non-integer limit", async () => {
    await expect(
      keysetPaginate({ keys, params: { limit: 0 }, fetch: seqStore([1n]) }),
    ).rejects.toThrow();
    await expect(
      keysetPaginate({ keys, params: { limit: 2.5 }, fetch: seqStore([1n]) }),
    ).rejects.toThrow();
  });

  it("concurrent inserts never shift or duplicate an already-read page (the OFFSET bug keyset fixes)", async () => {
    // Start with 10..1, read the first page, then inject rows AHEAD of the cursor.
    const seqs = Array.from({ length: 10 }, (_, i) => BigInt(10 - i)); // 10..1
    const page1 = await keysetPaginate({ keys, params: { limit: 3 }, fetch: seqStore(seqs) });
    expect(page1.items.map((r) => r.seq)).toEqual([10n, 9n, 8n]);

    // Three new rows arrive (11,12,13) — higher seq, so they land ahead of the cursor.
    const grown = seqStore([...seqs, 11n, 12n, 13n]);
    const page2 = await keysetPaginate({
      keys,
      params: { cursor: page1.nextCursor, limit: 3 },
      fetch: grown,
    });

    // OFFSET would have re-served [10,9,8] (shifted by the inserts). Keyset seeks past 8.
    expect(page2.items.map((r) => r.seq)).toEqual([7n, 6n, 5n]);
    const p1 = new Set(page1.items.map((r) => String(r.seq)));
    for (const r of page2.items) expect(p1.has(String(r.seq))).toBe(false);
  });
});

describe("keyset over activity_log — real RLS-scoped, append-only reads", () => {
  const ACTION = "keyset.pagination.fixture"; // isolates our rows from other test files' log writes

  const insertRows = (n: number) =>
    withTenant(orgAId, async (tx) => {
      for (let i = 0; i < n; i++) {
        // Append via log_activity() (#13); direct app_user inserts are rejected by the guard trigger.
        await logActivity(tx, {
          organizationId: orgAId,
          subjectType: "organization",
          subjectId: orgAId,
          action: ACTION,
          actorLabel: "system:test",
        });
      }
    });

  const page = (cursor: string | null, limit: number): Promise<KeysetPage<{ seq: bigint }>> =>
    withTenant(orgAId, (tx) =>
      keysetPaginate<{ seq: bigint }>({
        keys: [{ field: "seq", direction: "desc" }],
        params: { cursor, limit },
        baseWhere: { organizationId: orgAId, action: ACTION },
        // Our generic `where` is broader than Prisma's typed input, so narrow it here.
        fetch: (args) =>
          tx.activityLog.findMany(args as Parameters<typeof tx.activityLog.findMany>[0]),
      }),
    );

  it("pages the full seeded set with no gaps/dupes, strictly descending by seq", async () => {
    await insertRows(25);

    const all: bigint[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const p = await page(cursor, 10);
      all.push(...p.items.map((r) => r.seq));
      cursor = p.nextCursor;
    } while (cursor && ++guard < 100);

    expect(all.length).toBe(25);
    expect(new Set(all.map(String)).size).toBe(25); // no duplicates
    for (let i = 1; i < all.length; i++) expect(all[i] < all[i - 1]).toBe(true); // strictly desc, no gaps
  });

  it("concurrent inserts do not shift an already-read page (keyset stability)", async () => {
    const page1 = await page(null, 5);
    expect(page1.items.length).toBe(5);
    const smallestRead = page1.items[page1.items.length - 1].seq;

    // Five more log rows land while the caller holds a cursor — they get higher seqs.
    await insertRows(5);

    const page2 = await page(page1.nextCursor, 5);
    const read1 = new Set(page1.items.map((r) => String(r.seq)));
    for (const r of page2.items) {
      expect(read1.has(String(r.seq))).toBe(false); // no row re-served
      expect(r.seq < smallestRead).toBe(true); // strictly older than page 1 — inserts stayed ahead
    }
  });
});

describe("F5 convention guard — no OFFSET pagination in src/ read paths", () => {
  it("src/ contains no raw OFFSET or Prisma `skip:` (keyset only)", () => {
    const offenders: string[] = [];
    scanForOffset(join(process.cwd(), "src"), offenders);
    expect(
      offenders,
      `OFFSET/skip found — use keysetPaginate instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

// Scan src/ (excluding generated Prisma code) for OFFSET pagination. Strips line comments so
// prose that names OFFSET is ignored; an inline `keyset-guard-allow` marker is an escape hatch.
function scanForOffset(dir: string, offenders: string[]): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry !== "generated") scanForOffset(p, offenders);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    readFileSync(p, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.includes("keyset-guard-allow")) return;
        const code = line.split("//")[0]; // drop trailing line comment / pure comment lines
        if (/\bOFFSET\b/i.test(code) || /\bskip\s*:/.test(code)) offenders.push(`${p}:${i + 1}`);
      });
  }
}
