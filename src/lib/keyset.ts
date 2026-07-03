// Keyset (seek) pagination — the F5 primitive and repo convention (issue #55, design §162).
//
// WHY keyset, never OFFSET: compliance lists only grow (activity_log, occurrence history,
// notifications, exceptions; retention is 1095 days, D5). OFFSET pagination degrades
// linearly as the list grows AND — because it counts rows by position — silently skips or
// repeats rows when a concurrent write shifts everything after the offset. For an
// append-only audit stream that is a correctness bug, not a slow query. Keyset seeks from
// the last row's sort key (`WHERE (org, key) < cursor ORDER BY key DESC LIMIT n`): rows a
// caller has already read never shift, because monotonic keys (per-org `seq`, or UUIDv7
// time-ordered `id`) mean concurrent inserts always land AHEAD of the cursor.
//
// The utility is deliberately query-engine-agnostic: it builds the Prisma `where`/`orderBy`
// fragments and computes the opaque cursor, but the actual fetch is injected. That keeps it
// unit-testable without a database and lets every list read path — Prisma-in-RSC today,
// GraphQL connections in M4 — adopt the same primitive. Switching a list off OFFSET later is
// an API-breaking change, so the convention is established here on day one.

/** Sort direction for a keyset column. Growing lists default to newest-first (`desc`). */
export type SortDirection = "asc" | "desc";

/** A value that can participate in a keyset sort key. Encoded losslessly into the cursor. */
export type CursorValue = string | number | boolean | bigint | Date;

/**
 * One column of the keyset sort key, in most-significant-first order. A single-column key
 * (e.g. `seq` for activity_log, or a UUIDv7 `id`) is the common case; multiple columns
 * express a composite order such as `(occurrence_local_date, id) DESC` for occurrence
 * history, where the trailing UUIDv7 `id` is a stable tiebreaker.
 */
export interface KeyColumn {
  field: string;
  direction?: SortDirection; // default: "desc"
}

/** Caller-supplied paging params. A null/absent cursor means "first page". */
export interface KeysetParams {
  cursor?: string | null;
  /** Page size (n). Must be a positive integer. */
  limit: number;
}

/** A page of results plus the opaque cursor for the next page (null when the list is exhausted). */
export interface KeysetPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** The query fragment the utility hands to the injected fetcher. Shape matches Prisma `findMany`. */
export interface KeysetQueryArgs {
  where: Record<string, unknown>;
  orderBy: Record<string, SortDirection>[];
  take: number;
}

// --- Cursor codec ----------------------------------------------------------------
// The cursor is opaque to callers: base64url(JSON(taggedValues)). It is NOT secret and NOT
// tamper-proof — it only encodes a position, and RLS still scopes every query to the
// caller's org, so a forged cursor cannot cross tenants or read anything the caller can't.
// JSON has no native bigint/Date, so those are tagged and restored losslessly.

type TaggedValue = CursorValue | { __t: "bigint"; v: string } | { __t: "date"; v: string };

function tag(value: CursorValue): TaggedValue {
  if (typeof value === "bigint") return { __t: "bigint", v: value.toString() };
  if (value instanceof Date) return { __t: "date", v: value.toISOString() };
  return value;
}

function untag(value: TaggedValue): CursorValue {
  if (value !== null && typeof value === "object" && "__t" in value) {
    return value.__t === "bigint" ? BigInt(value.v) : new Date(value.v);
  }
  return value;
}

/** Encode the sort-key values of the last row on a page into an opaque cursor string. */
export function encodeCursor(values: CursorValue[]): string {
  return Buffer.from(JSON.stringify(values.map(tag))).toString("base64url");
}

/** Decode an opaque cursor back into its sort-key values. Throws on a malformed cursor. */
export function decodeCursor(cursor: string): CursorValue[] {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as TaggedValue[];
  if (!Array.isArray(parsed)) throw new Error("Invalid keyset cursor");
  return parsed.map(untag);
}

// --- Query-fragment builders -----------------------------------------------------

function comparator(direction: SortDirection): "lt" | "gt" {
  return direction === "desc" ? "lt" : "gt";
}

/**
 * Build the keyset `where` fragment for a (possibly composite) key. For a single column this
 * is `{ field: { lt: cursor } }`. For a composite key `[a, b]` descending it expands to the
 * standard lexicographic seek `(a < ca) OR (a = ca AND b < cb)` — expressed as a Prisma `OR`
 * of equality-prefixed clauses so it works without row-value-tuple support. Returns `{}` for
 * the first page (no cursor).
 */
export function buildKeysetWhere(
  keys: KeyColumn[],
  cursorValues: CursorValue[] | null,
): Record<string, unknown> {
  if (!cursorValues) return {};
  if (cursorValues.length !== keys.length) {
    throw new Error("Keyset cursor does not match the configured key columns");
  }
  const clauses = keys.map((key, i) => {
    const clause: Record<string, unknown> = {};
    for (let j = 0; j < i; j++) clause[keys[j].field] = cursorValues[j]; // equality on more-significant keys
    clause[key.field] = { [comparator(key.direction ?? "desc")]: cursorValues[i] };
    return clause;
  });
  return clauses.length === 1 ? clauses[0] : { OR: clauses };
}

/** Build the keyset `orderBy` — one entry per key column, in significance order. */
export function buildKeysetOrderBy(keys: KeyColumn[]): Record<string, SortDirection>[] {
  return keys.map((key) => ({ [key.field]: key.direction ?? "desc" }));
}

function combineWhere(
  base: Record<string, unknown> | undefined,
  keyset: Record<string, unknown>,
): Record<string, unknown> {
  const hasBase = base && Object.keys(base).length > 0;
  const hasKeyset = Object.keys(keyset).length > 0;
  if (hasBase && hasKeyset) return { AND: [base, keyset] };
  if (hasBase) return base;
  return keyset;
}

// --- The primitive ---------------------------------------------------------------

/**
 * Fetch one keyset page. Fetches `limit + 1` rows to detect whether a further page exists,
 * returns the first `limit`, and derives `nextCursor` from the last returned row's sort key
 * (null when the list is exhausted). The `fetch` callback receives ready-to-use Prisma args
 * — wire it to a tenant-scoped model, e.g.:
 *
 *   await keysetPaginate({
 *     keys: [{ field: "seq", direction: "desc" }],
 *     params: { cursor, limit: 50 },
 *     baseWhere: { organizationId },              // matches the documented (org, seq) shape
 *     fetch: (args) => tx.activityLog.findMany(args),
 *   });
 *
 * `extractKey` defaults to reading each key column off the row by field name; supply it only
 * when the sort column is not a plain own-property of the returned row.
 */
export async function keysetPaginate<T>(opts: {
  keys: KeyColumn[];
  params: KeysetParams;
  fetch: (args: KeysetQueryArgs) => Promise<T[]>;
  baseWhere?: Record<string, unknown>;
  extractKey?: (row: T) => CursorValue[];
}): Promise<KeysetPage<T>> {
  const { keys, params, fetch, baseWhere } = opts;
  if (!Number.isInteger(params.limit) || params.limit < 1) {
    throw new Error("Keyset limit must be a positive integer");
  }
  if (keys.length === 0) throw new Error("Keyset requires at least one key column");

  const extractKey =
    opts.extractKey ?? ((row: T) => keys.map((k) => (row as Record<string, CursorValue>)[k.field]));

  const cursorValues = params.cursor ? decodeCursor(params.cursor) : null;
  const rows = await fetch({
    where: combineWhere(baseWhere, buildKeysetWhere(keys, cursorValues)),
    orderBy: buildKeysetOrderBy(keys),
    take: params.limit + 1, // one extra row tells us whether another page exists
  });

  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? encodeCursor(extractKey(items[items.length - 1])) : null;
  return { items, nextCursor };
}
