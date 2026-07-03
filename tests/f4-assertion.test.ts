import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// F4 codebase-wide guarantee (#10). The design invariant: it must be structurally impossible to
// change an occurrence / exception / corrective-action `status` without an activity_log row written
// in the same transaction (F4, §8.20). transition() is the only path that pairs a status write with
// the audit insert, and only three "sanctioned" services flip a status — always via transition().
//
// This guard STATICALLY scans src/** and asserts:
//   1. No file OUTSIDE the sanctioned services writes a `status` key inside a Prisma
//      `.update(...)` / `.updateMany(...)` data object (a direct status mutation = an F4 bypass).
//   2. Each sanctioned service DOES import `transition` (so its status writes route through F4).
//
// WHAT IT DOES cover: literal `.update(...)`/`.updateMany(...)` calls whose `data: { … }` object
// contains a `status:` key, in hand-written src (excluding generated Prisma code and any `.claude`
// worktrees). WHAT IT DOES NOT cover: raw SQL UPDATEs, dynamically-built data objects, or a status
// write smuggled through a helper that hides the literal key — those are caught by review + the
// DB-backed tests, not this static scan. An inline `f4-guard-allow` marker on the offending line is
// an escape hatch (mirrors the F5 `keyset-guard-allow` convention).

// The ONLY files allowed to flip an occurrence/exception/CA status — and only through transition().
const SANCTIONED = ["transition.ts", "occurrences.ts", "exceptions.ts"];

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
  const offenderOffsets: number[] = [];
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

    // A top-level `status:` key inside the data object is a direct status write.
    if (/(^|[\s,{])status\s*:/.test(dataObj)) {
      offenderOffsets.push(argStart);
    }
  }

  // Map offending offsets to 1-based line numbers, honouring the f4-guard-allow escape hatch.
  const lines = code.split("\n");
  const lineStartOffsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    lineStartOffsets.push(acc);
    acc += line.length + 1; // + '\n'
  }
  const offenderLines: number[] = [];
  for (const off of offenderOffsets) {
    let lineNo = 0;
    for (let i = 0; i < lineStartOffsets.length; i++) {
      if (lineStartOffsets[i] <= off) lineNo = i;
      else break;
    }
    if (lines[lineNo].includes("f4-guard-allow")) continue;
    offenderLines.push(lineNo + 1);
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

  it("no direct Prisma status write in src/ outside the sanctioned services", () => {
    const files: string[] = [];
    collectSourceFiles(srcRoot, files);

    const offenders: Offender[] = [];
    for (const file of files) {
      if (SANCTIONED.some((name) => file.endsWith(name))) continue;
      const code = readFileSync(file, "utf8");
      for (const line of scanSource(code)) offenders.push({ file, line });
    }

    expect(
      offenders,
      `Direct status write outside transition() — route it through transition():\n${offenders
        .map((o) => `${o.file}:${o.line}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("each sanctioned service imports transition (its status writes go through F4)", () => {
    for (const name of SANCTIONED) {
      const code = readFileSync(join(srcRoot, "lib", name), "utf8");
      // transition.ts defines transition(); the others must import it.
      if (name === "transition.ts") {
        expect(code).toMatch(/export\s+async\s+function\s+transition\b/);
      } else {
        expect(code, `${name} must import transition`).toMatch(
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
