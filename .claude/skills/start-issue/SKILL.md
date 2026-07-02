---
name: start-issue
description: Start work on a Shift Ledger GitHub issue — verify it is scoped and Ready, move its board card to In Progress, assign it to you, and cut the feat/<n>-<slug> branch off an up-to-date main. Use when beginning work on an issue, picking up a Ready ticket, or when asked to "start", "pick up", or "work on" issue #N.
---

# start-issue

Kicks off the per-issue protocol from `CLAUDE.md` §3 so no step is skipped. **Golden rule: no code without an issue.**

## Preflight (stop if these fail)

1. **`gh` installed + authed.** Run `gh auth status`. If it errors with "command not found" but `gh` was recently installed, it's just not on this shell's PATH yet — restart the session, or on Windows invoke it directly as `"C:\Program Files\GitHub CLI\gh.exe"`. If genuinely not installed: `winget install --id GitHub.cli` then `gh auth login`, and stop — offer to walk the board move by hand in the [project board](https://github.com/users/Hassanjkhan99/projects/1) meanwhile.
2. **Issue exists.** If the user didn't name an issue, ask for the number or create one first (`gh issue create`). Never branch or code without one.
3. **Clean working tree.** `git status --porcelain` must be empty. If not, stop and surface it.

## Steps

1. **Read the issue and confirm scope:**
   ```bash
   gh issue view <n> --repo Hassanjkhan99/shift-ledger
   ```
   It must be **one small, independently testable unit** and in **Ready**. If it's an epic or spans multiple units, split into sub-issues *before* coding (per §1). If it's still in Backlog, confirm it's actually scoped + unblocked first.

2. **Sync main and branch** (slug = short kebab-case of the issue title):
   ```bash
   git switch main && git pull --ff-only
   git switch -c feat/<n>-<slug>
   ```

3. **Assign yourself:**
   ```bash
   gh issue edit <n> --add-assignee @me --repo Hassanjkhan99/shift-ledger
   ```

4. **Move the board card → In Progress** (see Board sync below, option `b5fa95d4`).

5. **Confirm and hand off.** Report the branch name and that the card moved to In Progress, then implement **only** what the issue describes. Any scope creep → open a new issue (`mcp__ccd_session__spawn_task` or `gh issue create`), don't fold it in. Ship tests with the change (§3.4). When done, use the **open-pr** skill.

## Board sync (mirrors CLAUDE.md §5)

Constants: repo `Hassanjkhan99/shift-ledger`, project `1` (owner `Hassanjkhan99`), `PROJECT_ID=PVT_kwHOBDUTYs4BcNe1`, `STATUS_FIELD=PVTSSF_lAHOBDUTYs4BcNe1zhW380E`.
Status option ids: `Backlog=425864e0 Ready=8be49a2d InProgress=b5fa95d4 InReview=f14de456 QA=6a19dd7f Done=895e4a78`.

Set an issue's status (self-contained; uses gh's built-in `--jq`, so no standalone `jq` needed):
```bash
ISSUE=<n>; OPT=b5fa95d4   # InProgress
ITEM=$(gh project item-list 1 --owner Hassanjkhan99 --format json --limit 200 \
  --jq ".items[] | select(.content.number==$ISSUE) | .id")
gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' \
  -f p=PVT_kwHOBDUTYs4BcNe1 -f i="$ITEM" -f f=PVTSSF_lAHOBDUTYs4BcNe1zhW380E -f o="$OPT"
```
If the issue isn't on the board yet, add it: `gh project item-add 1 --owner Hassanjkhan99 --url <issue-url>`, then re-run. If your `gh` rejects `--jq` on `project item-list`, drag the card in the board UI instead.
