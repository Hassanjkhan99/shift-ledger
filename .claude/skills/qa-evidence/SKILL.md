---
name: qa-evidence
description: Attach or audit dev QA evidence for Shift Ledger issues. SINGLE-ISSUE mode — generate the evidence CI can't (UI screenshot/recording, DB query/policy proof, targeted test output), post it as an issue comment, label it, and move the card to QA (evidence). SWEEP mode (nightly) — scan the board for QA/Done issues missing dev evidence, backfill what it can headlessly, and flag the rest. Use when asked to "attach evidence", "post QA proof", "move to QA", "close out issue #N", "sweep for missing evidence", or on a scheduled nightly run.
---

# qa-evidence

Enforces the Definition of Done in `CLAUDE.md` §4 — **no evidence → not Done** — for the evidence a **human/agent** must produce. It has two modes.

## Division of labor with CI (read this first)

`qa-evidence.yml` already runs on green CI and **auto-posts the "CI passed" proof** (lint · typecheck · test · build) to the PR + linked issue and adds the **`qa:evidence-attached`** label. **This skill does NOT re-post that** — that would double up. This skill owns the evidence CI *cannot* generate, plus the board moves the keyless `GITHUB_TOKEN` *cannot* make (Projects v2 columns need a local `gh` with `project` scope — see `docs/automation.md`).

**Labels (source of truth for the sweep):**

| Label | Set by | Meaning |
|---|---|---|
| `qa:evidence-attached` | `qa-evidence.yml` (CI) | CI gates went green — machine evidence attached |
| `qa:dev-evidence` | **this skill** | Dev evidence attached (screenshot / query-policy proof / targeted test output) |
| `qa:needs-dev-evidence` | **this skill (sweep)** | Done/QA issue that still needs dev evidence the sweep couldn't auto-produce |

## Preflight

1. **`gh` installed + authed** (`gh auth status`). If "command not found" right after an install, it's a stale PATH — restart the session or call `"C:\Program Files\GitHub CLI\gh.exe"` on Windows. If genuinely missing: `winget install --id GitHub.cli` → `gh auth login`, then stop.
2. **Ensure the labels exist** (idempotent — ignore "already exists"):
   ```bash
   gh label create qa:dev-evidence     --repo Hassanjkhan99/shift-ledger --color 0E8A16 --description "Dev-produced QA evidence attached" 2>/dev/null || true
   gh label create qa:needs-dev-evidence --repo Hassanjkhan99/shift-ledger --color D93F0B --description "Done/QA issue still missing dev evidence" 2>/dev/null || true
   ```

## Pick the evidence type (both modes classify the issue first)

- **Logic / backend / any tested code** → **targeted test output.** Run `npm test` and quote the lines that prove *this issue's* acceptance criteria — not the whole log. For the **RLS gate (#6)** the evidence MUST include the cross-tenant leak result (read/write/update/delete denial) and the `activity_log` append-only assertions.
- **Schema / security / RLS policy** → a **query or policy proof**: the SQL / policy definition and its output demonstrating the guarantee (default-deny → zero rows; trigger rejects UPDATE/DELETE).
- **UI work** → a **screenshot or recording** of the behavior. This generally can't be produced headlessly — in a nightly sweep, flag it `qa:needs-dev-evidence` unless a Playwright/preview capture is wired up.

---

## Mode A — single issue (finishing a reviewed PR)

Trigger: `qa-evidence <n>`, or "attach evidence to #N". The issue's PR should be **reviewed** (§3.6) — evidence never substitutes for review.

1. Classify the issue (above) and **generate the proof** — prefer real, reproducible output over prose.
2. **Post it as a comment** (fenced block for logs; reference uploaded images by URL). Long output → `--body-file`:
   ```bash
   gh issue comment <n> --repo Hassanjkhan99/shift-ledger --body "## Dev QA evidence

   \`\`\`
   <targeted test tail / query output>
   \`\`\`

   Verified: <what this proves, tied to the acceptance criteria>. PR: #<pr>"
   ```
3. **Label** the issue `qa:dev-evidence` (`gh issue edit <n> --add-label qa:dev-evidence --repo …`).
4. **Move the card → QA (evidence)** (option `6a19dd7f`, board-sync block below).
5. Report the comment link + card move. Human QA verifies; the merged PR closes the issue → Done. **Never move to Done yourself.**

---

## Mode B — nightly sweep (default when no issue is named)

Trigger: `qa-evidence` with no argument, "sweep for missing evidence", or the scheduled runner. **Audit + backfill; never merge, close, push, or move a card to Done** (`docs/automation.md` non-negotiables).

1. **Find candidates** — board items in QA/Done that lack `qa:dev-evidence`. The status key is top-level `.status` (values: `Backlog` / `Ready` / `In Progress` / `In Review` / `QA (evidence)` / `Done`):
   ```bash
   gh project item-list 1 --owner Hassanjkhan99 --format json --limit 300 \
     --jq '.items[] | select(.status=="QA (evidence)" or .status=="Done")
           | select([.labels[]? ] | index("qa:dev-evidence") | not)
           | {n: .content.number, title: .content.title, status: .status, labels: [.labels[]?]}'
   ```
   (Also worth catching recently-merged issues that skipped QA: `gh issue list --repo Hassanjkhan99/shift-ledger --state closed --search "closed:>=<date>" --json number,title,labels`.)
2. **For each candidate**, classify and act:
   - **First, don't double-post.** Check for prior evidence: `gh issue view <n> --repo Hassanjkhan99/shift-ledger --json comments --jq '[.comments[].body] | join("\n")'`. If the issue already carries an evidence comment (a human's, or `qa-evidence.yml`'s "CI passed" comment), just add the **`qa:dev-evidence`** label to reconcile the taxonomy and move on — **do not re-post**. (On the first sweep after these labels are introduced, most Done issues fall here.)
   - Evidence you **can** produce headlessly (test output, query/policy proof) → generate it, post the comment (as Mode A step 2), add **`qa:dev-evidence`**.
   - Evidence you **can't** (UI screenshot/recording, or anything needing human judgment) → add **`qa:needs-dev-evidence`** and comment exactly what's needed and why the sweep couldn't produce it.
   - If an issue already has `qa:evidence-attached` (CI green) and its only gap is a machine-checkable proof, the targeted test re-run is usually enough → `qa:dev-evidence`.
3. **Do not** touch the board columns in sweep mode (these issues are already at QA/Done), and **do not** close/merge/push anything.
4. **Summarize** at the end: counts of `attached` vs `flagged`, and the per-issue list (`#n — attached | needs: <what>`). The scheduled runner captures this summary to its log.

---

## Board sync (mirrors CLAUDE.md §5)

`PROJECT_ID=PVT_kwHOBDUTYs4BcNe1`, `STATUS_FIELD=PVTSSF_lAHOBDUTYs4BcNe1zhW380E`. Option ids: `QA=6a19dd7f Done=895e4a78` (also `Backlog=425864e0 Ready=8be49a2d InProgress=b5fa95d4 InReview=f14de456`).
```bash
ISSUE=<n>; OPT=6a19dd7f   # QA (evidence)
ITEM=$(gh project item-list 1 --owner Hassanjkhan99 --format json --limit 300 \
  --jq ".items[] | select(.content.number==$ISSUE) | .id")
gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' \
  -f p=PVT_kwHOBDUTYs4BcNe1 -f i="$ITEM" -f f=PVTSSF_lAHOBDUTYs4BcNe1zhW380E -f o="$OPT"
```
