import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// F4 codebase-wide guarantee (#10). The design invariant: it must be structurally impossible to
// change an occurrence / exception / corrective-action `status` without an activity_log row written
// in the same transaction (F4, §8.20). transition() is the only path that pairs a status write with
// the audit insert, and only three "sanctioned" services flip a status — always via transition().
//
// This guard STATICALLY scans EVERY src/** file (the sanctioned services INCLUDED) and asserts:
//   1. No status write bypasses transition(). A `status` key inside a Prisma `.update(...)` /
//      `.updateMany(...)` / `.create(...)` / `.createMany(...)` data object is a direct status
//      mutation — creates included, because the audited machines cover the initial
//      `(none) → pending/open` transition, so a `create` with a `status` and no activity_log is just
//      as much a bypass as an `update`. The key is matched quoted or unquoted (`status:`,
//      `"status":`, `'status':`). In a NON-sanctioned file any such write is always an F4 bypass. In
//      a sanctioned service it is allowed ONLY when the offending line carries an explicit
//      `f4-guard-allow` marker — the escape hatch reserved for the transition()-wrapped / logActivity-
//      paired writes those services legitimately issue. Any UNMARKED status write, even inside a
//      sanctioned file, is flagged. Crucially the marker is honoured ONLY inside sanctioned paths:
//      a marker in a non-sanctioned file does NOT self-suppress the finding, so a bypass there cannot
//      hide behind the marker. (Earlier this guard `continue`d past the sanctioned files without
//      scanning them — a false negative — AND honoured the marker anywhere — a loophole. Both closed.)
//   2. Each sanctioned service DOES import `transition` (so its status writes route through F4).
//
// WHAT IT DOES cover: literal `.update(...)`/`.updateMany(...)`/`.create(...)`/`.createMany(...)`
// calls whose `data:` value (object `{ … }`, or an array `[ … ]` for createMany) contains a
// `status:` key (quoted or unquoted), in hand-written src (excluding generated Prisma code and any
// `.claude` worktrees). The balanced-delimiter matcher is string/comment-aware, so a `(`/`{` that
// appears only inside a string literal or comment (e.g. `data: { note: ')' }`) does not truncate the
// call span and hide the real `data` block. WHAT IT DOES NOT cover: raw SQL UPDATEs, dynamically-
// built data objects, a status write smuggled through a helper that hides the literal key, and
// delimiters inside template-literal `${ … }` interpolations or regex literals (see matchDelimiter) —
// those are caught by review + the DB-backed tests, not this static scan. An inline `f4-guard-allow`
// marker on the flagged line is the escape hatch (mirrors the F5 `keyset-guard-allow` convention); it
// is honoured ONLY inside the sanctioned services' paths, where it flags their transition()-wrapped /
// audited writes.

// The sanctioned services — the ONLY files allowed to flip an occurrence/exception/CA status, and
// only through a transition()-wrapped, `f4-guard-allow`-marked write. Matched by EXACT repo-relative
// path (normalized to '/'), not by basename suffix: a differently located file that merely shares one
// of these basenames (e.g. src/app/api/occurrences.ts) is NOT sanctioned — its status writes are
// flagged unconditionally (the marker is only honoured inside these paths), so a real bypass there
// cannot slip past this guard.
const SANCTIONED = ["src/lib/transition.ts", "src/lib/occurrences.ts", "src/lib/exceptions.ts"];

/** Repo-relative, forward-slash-normalized path for `file` (an absolute path under process.cwd()). */
function relPath(file: string): string {
  return file.slice(process.cwd().length + 1).replace(/\\/g, "/");
}

interface Offender {
  file: string;
  line: number;
}

/**
 * Scan a TypeScript source string for a `status:` key written inside a Prisma
 * `.update(...)`/`.updateMany(...)`/`.create(...)`/`.createMany(...)` data object. Returns the
 * 1-based line numbers of offenders.
 *
 * Creates are scanned too: the audited state machines include the initial `(none) → pending/open`
 * transitions, so a non-sanctioned file could `create` an occurrence/exception/CA with a `status`
 * and no activity_log — that is just as much an F4 bypass as a direct `.update`. For `createMany`
 * the `data:` may be an ARRAY of objects; we still detect a top-level `status:` key anywhere inside
 * the balanced `[ … ]`/`{ … }` after `data:`.
 *
 * The `status:` key is matched quoted or unquoted: `status:`, `"status":`, and `'status':`.
 *
 * The `f4-guard-allow` escape hatch is honoured ONLY when `allowMarkers` is true — the caller passes
 * true exclusively for the sanctioned services (matched by exact path). A marker in a NON-sanctioned
 * file therefore does NOT self-suppress a finding, so a real bypass there cannot hide behind the
 * marker. (Callers that pass no flag — the fixtures — default to honouring markers, so the standalone
 * fixture assertions below still exercise the marker directly.)
 *
 * Strategy: find each `.update(`/`.updateMany(`/`.create(`/`.createMany(` call, take the balanced
 * `( … )` argument (string/comment-aware so a delimiter inside a literal doesn't end it early),
 * locate its `data:` value (the balanced `{ … }` or `[ … ]` after `data:`), and flag a `status:` key
 * inside it.
 */
function scanSource(code: string, allowMarkers = true): number[] {
  const lines = code.split("\n");
  const lineStartOffsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    lineStartOffsets.push(acc);
    acc += line.length + 1; // + '\n'
  }
  const lineOf = (off: number): number => {
    let n = 0;
    for (let i = 0; i < lineStartOffsets.length; i++) {
      if (lineStartOffsets[i] <= off) n = i;
      else break;
    }
    return n;
  };

  const offenderLines: number[] = [];
  const callRe = /\.(update|updateMany|create|createMany)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(code)) !== null) {
    const argStart = m.index + m[0].length - 1; // position of the opening '('
    const argEnd = matchDelimiter(code, argStart, "(", ")");
    if (argEnd === -1) continue;
    const arg = code.slice(argStart + 1, argEnd);

    const dataIdx = arg.search(/\bdata\s*:/);
    if (dataIdx === -1) continue;
    // The data VALUE is either an object `{ … }` (update/create) or an array of objects `[ … ]`
    // (createMany). Take whichever delimiter opens first after `data:` and balance it (string/comment
    // aware). A top-level `status:` key anywhere inside that span is a status write. For an array we
    // scan the whole `[ … ]` body — a `status:` inside any element object is still detected.
    const braceStart = arg.indexOf("{", dataIdx);
    const bracketStart = arg.indexOf("[", dataIdx);
    let open: number;
    let openCh: string;
    let closeCh: string;
    if (bracketStart !== -1 && (braceStart === -1 || bracketStart < braceStart)) {
      open = bracketStart;
      openCh = "[";
      closeCh = "]";
    } else if (braceStart !== -1) {
      open = braceStart;
      openCh = "{";
      closeCh = "}";
    } else {
      continue;
    }
    const end = matchDelimiter(arg, open, openCh, closeCh);
    if (end === -1) continue;
    const dataObj = arg.slice(open + 1, end);

    // Not a status write → not our concern. Match quoted or unquoted key: status:, "status":,
    // 'status':. The optional quote may directly follow a delimiter/start.
    if (!/(^|[\s,{[])["']?status["']?\s*:/.test(dataObj)) continue;

    // Honour an `f4-guard-allow` marker placed ANYWHERE on the lines this call spans — the call
    // line, any line inside the `({ … })`, the closing-paren line, or a trailing comment just after
    // it. Checking the whole span (not just the call line) makes the escape hatch robust to
    // formatter reflow (Prettier moves a trailing `({ // marker` comment onto the next line). Markers
    // are ONLY honoured when allowMarkers is set — the caller sets it exclusively for sanctioned
    // paths, so a marker in a non-sanctioned file cannot self-suppress a finding.
    const startLine = lineOf(m.index);
    const endLine = Math.min(lineOf(argEnd) + 1, lines.length - 1);
    let marked = false;
    if (allowMarkers) {
      for (let i = startLine; i <= endLine; i++) {
        if (lines[i].includes("f4-guard-allow")) {
          marked = true;
          break;
        }
      }
    }
    if (!marked) offenderLines.push(startLine + 1);
  }
  return offenderLines;
}

/**
 * Return the index of the delimiter that closes the one opened at `open`, or -1 if unbalanced.
 *
 * String/comment awareness (best-effort): while counting `openCh`/`closeCh` we SKIP over the bodies
 * of single-quoted ('…'), double-quoted ("…") and template (`…`) string literals, `//` line
 * comments, and `/* … *␟/` block comments, so a brace/paren that appears only as text — e.g.
 * `update({ where: { note: ')' }, data: { status: 'x' } })` — does not prematurely close the span
 * and hide the trailing `data` block. Escaped quotes (\') inside a string are honoured so the string
 * is not closed early.
 *
 * What it does NOT cover: template-literal `${ … }` interpolations (their contents are treated as
 * opaque string body, so real delimiters inside an interpolation are ignored — acceptable, since a
 * Prisma `.update` call is not written inside a template interpolation), and regex literals (a `/`
 * that begins a regex is not distinguished from a division operator; regexes do not appear inside the
 * data objects this guard inspects). These are the same trade-offs a lightweight lexer accepts.
 */
function matchDelimiter(s: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const ch = s[i];
    // Skip string literals (single/double/backtick). Consume until the matching unescaped quote.
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < s.length) {
        if (s[i] === "\\") {
          i += 2; // skip the escaped char (e.g. \' \" \\)
          continue;
        }
        if (s[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Skip a // line comment to end-of-line.
    if (ch === "/" && s[i + 1] === "/") {
      i += 2;
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    // Skip a /* … */ block comment.
    if (ch === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2; // consume the closing */
      continue;
    }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Recursively collect .ts/.tsx files under `dir`, skipping generated code and .claude worktrees. */
function collectSourceFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "generated" || entry === ".claude" || entry === "node_modules") continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      collectSourceFiles(p, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(p);
    }
  }
}

describe("F4 assertion — no status write bypasses transition()", () => {
  const srcRoot = join(process.cwd(), "src");

  it("no UNMARKED direct Prisma status write anywhere in src/ (sanctioned files scanned + marker-gated)", () => {
    const files: string[] = [];
    collectSourceFiles(srcRoot, files);

    // Scan EVERY file — the sanctioned services included. An `f4-guard-allow` marker suppresses a
    // flagged write ONLY inside a sanctioned file (allowMarkers = the file is in SANCTIONED): those
    // services' transition()-wrapped CAS / audited create writes are marked and pass, while an
    // UNMARKED status write in ANY file — sanctioned or not — is reported. In a NON-sanctioned file
    // the marker is NOT honoured, so a bypass there cannot self-suppress. This closes both the earlier
    // false negative (sanctioned files skipped wholesale) AND the marker-anywhere loophole.
    const offenders: Offender[] = [];
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      const allowMarkers = SANCTIONED.includes(relPath(file));
      for (const line of scanSource(code, allowMarkers)) offenders.push({ file, line });
    }

    expect(
      offenders,
      `Unmarked direct status write — route it through transition() (and, inside a sanctioned ` +
        `service, add an f4-guard-allow marker to the wrapped write):\n${offenders
          .map((o) => `${o.file}:${o.line}`)
          .join("\n")}`,
    ).toEqual([]);
  });

  it("each sanctioned service imports transition (its status writes go through F4)", () => {
    for (const relative of SANCTIONED) {
      const code = readFileSync(join(process.cwd(), relative), "utf8");
      // transition.ts defines transition(); the others must import it.
      if (relative.endsWith("transition.ts")) {
        expect(code).toMatch(/export\s+async\s+function\s+transition\b/);
      } else {
        expect(code, `${relative} must import transition`).toMatch(
          /import\s*\{[^}]*\btransition\b[^}]*\}\s*from\s*["']\.\/transition["']/,
        );
      }
    }
  });

  it("NEGATIVE fixture: the scan catches a deliberate direct status write", () => {
    // A hand-written bypass that does NOT route through transition(). The scan must flag it.
    const bypass = `
      export async function sneaky(tx) {
        return tx.taskOccurrence.update({
          where: { id: someId },
          data: { status: "completed", completedAt: new Date() },
        });
      }
    `;
    expect(scanSource(bypass).length).toBe(1);

    // updateMany form is also caught.
    const bypassMany = `tx.exception.updateMany({ where: { organizationId }, data: { status: "verified" } });`;
    expect(scanSource(bypassMany).length).toBe(1);

    // create form is caught too — the (none)→open/pending initial transition is audited, so a create
    // with a status and no activity_log is an F4 bypass.
    const bypassCreate = `tx.exception.create({ data: { organizationId, status: "open" } });`;
    expect(scanSource(bypassCreate).length).toBe(1);

    // createMany with an ARRAY of objects: a top-level status: inside an element is still detected.
    const bypassCreateMany = `tx.taskOccurrence.createMany({ data: [{ organizationId, status: "pending" }] });`;
    expect(scanSource(bypassCreateMany).length).toBe(1);

    // A quoted status key ("status": / 'status':) is matched just like the unquoted form.
    const bypassQuoted = `tx.taskOccurrence.update({ where: { id }, data: { "status": "completed" } });`;
    expect(scanSource(bypassQuoted).length).toBe(1);
    const bypassSingleQuoted = `tx.taskOccurrence.create({ data: { 'status': 'open' } });`;
    expect(scanSource(bypassSingleQuoted).length).toBe(1);

    // The f4-guard-allow escape hatch suppresses a flagged line (markers honoured by default).
    const allowed = `tx.taskOccurrence.update({ where: { id }, data: { status: "due" } }); // f4-guard-allow: system sweep`;
    expect(scanSource(allowed).length).toBe(0);

    // A crafted `)` / `}` hidden inside a string literal or comment must NOT truncate the call span
    // and hide the trailing data block — the string/comment-aware delimiter matcher still finds it.
    const bypassStringDecoy = `tx.taskOccurrence.update({ where: { note: ')' }, data: { status: 'x' } });`;
    expect(scanSource(bypassStringDecoy).length).toBe(1);
  });

  it("path-restricted marker: an f4-guard-allow marker does NOT suppress in a NON-sanctioned file", () => {
    // With allowMarkers=false (how the top-level loop scans every non-sanctioned file) a marker on a
    // status write is IGNORED, so a bypass in a non-sanctioned src/** file cannot self-suppress by
    // adding the marker. The exact same source, scanned WITH markers honoured (sanctioned path), passes.
    const marked = `tx.taskOccurrence.update({ where: { id }, data: { status: "due" } }); // f4-guard-allow: fake`;
    expect(scanSource(marked, false).length).toBe(1); // non-sanctioned: marker ignored → flagged
    expect(scanSource(marked, true).length).toBe(0); // sanctioned: marker honoured → suppressed
  });

  it("NEGATIVE fixture: a shared-basename file in a DIFFERENT location is NOT exempt", () => {
    // A bypass living at src/app/api/occurrences.ts shares the basename of a sanctioned file but
    // is NOT the sanctioned src/lib/occurrences.ts, so its direct status write must still be flagged.
    const impostor = join(process.cwd(), "src", "app", "api", "occurrences.ts");
    expect(SANCTIONED.includes(relPath(impostor))).toBe(false);

    const bypass = `tx.taskOccurrence.update({ where: { id }, data: { status: "completed" } });`;
    // The scan flags the write; since this UNMARKED write lives at a non-sanctioned path, no marker
    // suppresses it and the top-level assertion would report it.
    expect(scanSource(bypass).length).toBe(1);

    // Sanity: the genuine sanctioned path IS in the allowlist (its marked writes are the only ones
    // allowed to carry a status write; the marker is honoured inside these paths).
    const genuine = join(process.cwd(), "src", "lib", "occurrences.ts");
    expect(SANCTIONED.includes(relPath(genuine))).toBe(true);
  });

  it("POSITIVE fixture: an UNMARKED status write inside a sanctioned file IS flagged (regression guard)", () => {
    // The whole point of scanning the sanctioned services: a NEW direct status write added there,
    // WITHOUT an f4-guard-allow marker, must be caught — the false negative this fix closes. A bare
    // updateMany with no marker is flagged; the same line WITH the marker is suppressed. This is what
    // the top-level assertion relies on when it now scans src/lib/occurrences.ts et al.
    const unmarked = `tx.taskOccurrence.updateMany({ where: { id, status }, data: { status: "due" } });`;
    expect(scanSource(unmarked).length).toBe(1);
    const marked = `${unmarked} // f4-guard-allow: transition()-wrapped CAS`;
    expect(scanSource(marked).length).toBe(0);

    // Stronger proof against the REAL files: strip the f4-guard-allow markers from each sanctioned
    // service and re-scan. Every one of them then reports ≥1 unmarked status write — i.e. the guard
    // is genuinely watching those files, and only the markers are keeping them green. This now covers
    // the audited CREATE writes too: occurrences.ts's (none)→pending createMany and exceptions.ts's
    // two (none)→open creates are marked, so they pass today and surface once the markers are stripped.
    for (const relative of SANCTIONED) {
      const code = readFileSync(join(process.cwd(), relative), "utf8");
      const stripped = code
        .split("\n")
        .map((l) => l.replace(/f4-guard-allow/g, ""))
        .join("\n");
      const before = scanSource(code).length; // marked writes are suppressed
      const after = scanSource(stripped).length; // markers gone → they surface
      if (relative.endsWith("transition.ts")) {
        // transition.ts writes no status column directly (callers' mutate callbacks do), so it has
        // no marked status writes to unmask.
        expect(before).toBe(0);
        expect(after).toBe(0);
      } else {
        expect(before).toBe(0); // all real status writes here are marked → green today
        expect(after).toBeGreaterThan(0); // remove the markers and the guard fires
      }
    }
  });

  it("NEGATIVE fixture: a status key OUTSIDE an update data object is NOT flagged", () => {
    // A select / where / return-shape `status:` is not a mutation and must not trip the guard.
    const benign = `
      const r = await tx.taskOccurrence.findUnique({ where: { id }, select: { status: true } });
      const dto = { status: "ok", completionId: id };
      await tx.taskOccurrence.update({ where: { id }, data: { completedAt: new Date() } });
    `;
    expect(scanSource(benign)).toEqual([]);
  });
});
