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
//      `.updateMany(...)` data object is a direct status mutation. In a NON-sanctioned file that is
//      always an F4 bypass. In a sanctioned service it is allowed ONLY when the offending line
//      carries an explicit `f4-guard-allow` marker — the escape hatch reserved for the
//      transition()-wrapped compare-and-set / mutate writes those services legitimately issue.
//      Any UNMARKED status write, even inside a sanctioned file, is flagged. (Earlier this guard
//      `continue`d past the sanctioned files without scanning them, so a NEW direct status write
//      added there would have slipped past — a false negative. It now scans them and gates on the
//      marker instead of exempting the whole file.)
//   2. Each sanctioned service DOES import `transition` (so its status writes route through F4).
//
// WHAT IT DOES cover: literal `.update(...)`/`.updateMany(...)` calls whose `data: { … }` object
// contains a `status:` key, in hand-written src (excluding generated Prisma code and any `.claude`
// worktrees). WHAT IT DOES NOT cover: raw SQL UPDATEs, dynamically-built data objects, or a status
// write smuggled through a helper that hides the literal key — those are caught by review + the
// DB-backed tests, not this static scan. An inline `f4-guard-allow` marker on the flagged line is
// the escape hatch (mirrors the F5 `keyset-guard-allow` convention); it is honoured everywhere but
// is only EXPECTED on the sanctioned services' transition()-wrapped writes.

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
 * `.update(...)`/`.updateMany(...)` data object. Returns the 1-based line numbers of offenders.
 * Comment-only lines and any line carrying `f4-guard-allow` are ignored.
 *
 * Strategy: find each `.update(`/`.updateMany(` call, take the balanced `( … )` argument, locate its
 * `data:` object (the balanced `{ … }` after `data:`), and flag a top-level `status:` key in it.
 */
function scanSource(code: string): number[] {
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
  const callRe = /\.(update|updateMany)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(code)) !== null) {
    const argStart = m.index + m[0].length - 1; // position of the opening '('
    const argEnd = matchDelimiter(code, argStart, "(", ")");
    if (argEnd === -1) continue;
    const arg = code.slice(argStart + 1, argEnd);

    const dataIdx = arg.search(/\bdata\s*:/);
    if (dataIdx === -1) continue;
    const braceStart = arg.indexOf("{", dataIdx);
    if (braceStart === -1) continue;
    const braceEnd = matchDelimiter(arg, braceStart, "{", "}");
    if (braceEnd === -1) continue;
    const dataObj = arg.slice(braceStart + 1, braceEnd);

    // Not a status write → not our concern.
    if (!/(^|[\s,{])status\s*:/.test(dataObj)) continue;

    // Honour an `f4-guard-allow` marker placed ANYWHERE on the lines this call spans — the call
    // line, any line inside the `({ … })`, the closing-paren line, or a trailing comment just after
    // it. Checking the whole span (not just the call line) makes the escape hatch robust to
    // formatter reflow (Prettier moves a trailing `({ // marker` comment onto the next line).
    const startLine = lineOf(m.index);
    const endLine = Math.min(lineOf(argEnd) + 1, lines.length - 1);
    let marked = false;
    for (let i = startLine; i <= endLine; i++) {
      if (lines[i].includes("f4-guard-allow")) {
        marked = true;
        break;
      }
    }
    if (!marked) offenderLines.push(startLine + 1);
  }
  return offenderLines;
}

/** Return the index of the delimiter that closes the one opened at `open`, or -1 if unbalanced. */
function matchDelimiter(s: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === openCh) depth++;
    else if (s[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
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

    // Scan EVERY file — the sanctioned services included. scanSource() already suppresses any line
    // carrying an `f4-guard-allow` marker, so the sanctioned services' transition()-wrapped CAS
    // writes (which are marked) pass, while an UNMARKED status write in ANY file — sanctioned or not
    // — is reported. This closes the earlier false negative where the sanctioned files were skipped
    // wholesale (a new direct status write there would not have been caught).
    const offenders: Offender[] = [];
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      for (const line of scanSource(code)) offenders.push({ file, line });
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

    // The f4-guard-allow escape hatch suppresses a flagged line.
    const allowed = `tx.taskOccurrence.update({ where: { id }, data: { status: "due" } }); // f4-guard-allow: system sweep`;
    expect(scanSource(allowed).length).toBe(0);
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
    // is genuinely watching those files, and only the markers are keeping them green.
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
