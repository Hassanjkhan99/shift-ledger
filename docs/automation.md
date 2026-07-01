# Shift Ledger — Automation Rules of Engagement

> How the project's automation works and the rules it follows. This is a **$0 setup**: the
> cloud pieces are plain GitHub Actions (no LLM, no API key); the AI work runs locally on an
> existing Claude Code seat. Edit this file to tune behavior.

## Architecture (free)
| Layer | Runs where | Cost | LLM? |
|---|---|---|---|
| **Standup / board report** | GitHub Actions (`standup.yml`) | Free Actions minutes | No |
| **QA evidence** | GitHub Actions (`qa-evidence.yml`) | Free Actions minutes | No |
| **Local AI standup** | Claude Code scheduled task on the dev machine | Existing seat | Yes |
| **Implementation & smart work** | You in Claude Code, locally | Existing seat | Yes |

There is intentionally **no cloud LLM automation** — running Claude in GitHub Actions requires
a paid API key or a Pro/Max token. Autonomous code-writing is therefore a **local, human-run**
activity: open a Claude Code session and ask it to implement a specific issue.

## Non-negotiable rules
1. **Never merge to `main` automatically.** A human merge is the sign-off.
2. **Never auto-close or delete issues.** Closing happens only via a merged PR (CLAUDE.md §4).
3. **Issue-first.** No code that isn't tied to a GitHub issue (CLAUDE.md §1). Findings become
   `proposed` issues — never silently folded in.
4. **Keep `main` green.** Every code change ships with tests. No bug debt.
5. **Stay in scope.** Implement only what the target issue describes. Scope creep → new `proposed` issue.
6. **Respect the architecture guardrails** in CLAUDE.md §6. Do not drift the locked spine.
7. **The RLS cross-tenant leak test (#6) must pass** with any feature work.

## Human sign-off gates
- Nothing in the cloud writes code. Implementation is human-initiated locally.
- QA evidence and the standup are informational / labels only.
- `auto:approved` marks issues you've blessed for implementation (a cue for local Claude Code work).

## Labels used by automation
| Label | Meaning |
|---|---|
| `auto:approved` | You've blessed this issue for implementation (local Claude Code). |
| `proposed` | Suggested issue awaiting a human to accept (remove label = accepted). |
| `automated` | Created/updated by automation. |
| `qa:evidence-attached` | `qa-evidence.yml` confirmed CI passed and attached evidence. |

## Board mapping (from CLAUDE.md §5) — verified accurate 2026-07-02
- Repo: `Hassanjkhan99/shift-ledger` · Project: https://github.com/users/Hassanjkhan99/projects/1
- `PROJECT_ID=PVT_kwHOBDUTYs4BcNe1` · Status field `PVTSSF_lAHOBDUTYs4BcNe1zhW380E`
- Options: Backlog=`425864e0` Ready=`8be49a2d` "In Progress"=`b5fa95d4`
  "In Review"=`f14de456` "QA (evidence)"=`6a19dd7f` Done=`895e4a78`
- The default `GITHUB_TOKEN` cannot touch Projects v2 columns; the keyless workflows operate on
  labels + PR state. A local `gh` token with `project` scope can read/move columns.

## The workflows
1. **`standup.yml`** (weekdays 07:00 UTC + manual) — read-only report to the Actions Step Summary:
   open issues, `auto:approved`, `proposed`, stale (assigned, >2 days idle), open PRs with CI
   status, and TODO/FIXME candidates. No writes.
2. **`qa-evidence.yml`** (after CI succeeds on a PR) — posts passing-CI evidence to the PR and its
   linked issue, adds `qa:evidence-attached`. Idempotent. Never merges/closes.

## Local implementation flow (the "implementer", free)
1. Label the issue `auto:approved` when you're ready.
2. In a Claude Code session in this repo: "Implement issue #<n> per its scope and docs/automation.md."
3. It branches `feat/<#>-<slug>`, implements, adds tests, and runs the gate before opening a PR:
   ```
   npm run lint && npm run typecheck && npm test && npm run build
   ```
4. You review + merge the PR — that merge is the sign-off. `qa-evidence.yml` attaches evidence
   automatically once CI is green.
