---
name: open-pr
description: Finish a Shift Ledger issue and open its PR — run the local gates (typecheck, lint, test), push the feat branch, open a PR that says "Closes #n", and move the board card to In Review. Use when a change is complete and ready for review, or when asked to "open a PR", "raise a PR", "submit for review", or "finish issue #N".
---

# open-pr

Turns a finished feature branch into a reviewable PR without skipping the gates in `CLAUDE.md` §3.5. **Keep `main` green — do not open a PR on red gates.**

## Preflight (stop if these fail)

1. **`gh` installed + authed** (`gh auth status`). If "command not found" right after an install, it's a stale PATH — restart the session or call `"C:\Program Files\GitHub CLI\gh.exe"` on Windows. If genuinely missing: `winget install --id GitHub.cli` → `gh auth login`, then stop.
2. **On a `feat/<n>-<slug>` branch**, not `main`. Confirm with `git branch --show-current` and recover the issue number `<n>` from it.
3. **No workflow files in this diff.** Run `git diff --name-only main...HEAD`. If anything under `.github/workflows/` changed, STOP and warn: GitHub's merge API can silently drop workflow edits, so per `conventions.md` those belong only in a dedicated CI issue. Offer to move them to a separate branch/issue.

## Steps

1. **Run the local gates** (same as CI `build` + `qa`; fix red before continuing):
   ```bash
   npm run typecheck && npm run lint && npm test
   ```
   If tests need the DB, the Vitest global setup spins up ephemeral embedded-postgres automatically. Capture the passing `npm test` tail — **qa-evidence** will need it.

2. **Push the branch:**
   ```bash
   git push -u origin HEAD
   ```

3. **Open the PR** — body MUST contain `Closes #<n>` so merge auto-closes the issue:
   ```bash
   gh pr create --repo Hassanjkhan99/shift-ledger --base main --fill \
     --title "<type>(#<n>): <summary>" \
     --body "Closes #<n>

   ## What
   <one-paragraph summary of the change, scoped to the issue>

   ## Tests
   <what you added / how it's verified — RLS/immutability tests where security-relevant>"
   ```

4. **Wait for CI, then move the card.** Watch the checks:
   ```bash
   gh pr checks --repo Hassanjkhan99/shift-ledger --watch
   ```
   When both **Build gate** and **QA gate** are green, move the board card → **In Review** (option `f14de456`, board-sync block below). If CI is red, fix on the same branch and push again — do **not** advance the card.

5. **Hand off.** Report the PR URL and that CI is green + the card is In Review. Reviewer approval is a human step — never self-approve (§ workflow). After review lands, use the **qa-evidence** skill to reach Done.

## Board sync (mirrors CLAUDE.md §5)

`PROJECT_ID=PVT_kwHOBDUTYs4BcNe1`, `STATUS_FIELD=PVTSSF_lAHOBDUTYs4BcNe1zhW380E`. Option ids: `InReview=f14de456` (and `Backlog=425864e0 Ready=8be49a2d InProgress=b5fa95d4 QA=6a19dd7f Done=895e4a78`).
```bash
ISSUE=<n>; OPT=f14de456   # InReview
ITEM=$(gh project item-list 1 --owner Hassanjkhan99 --format json --limit 200 \
  --jq ".items[] | select(.content.number==$ISSUE) | .id")
gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' \
  -f p=PVT_kwHOBDUTYs4BcNe1 -f i="$ITEM" -f f=PVTSSF_lAHOBDUTYs4BcNe1zhW380E -f o="$OPT"
```
