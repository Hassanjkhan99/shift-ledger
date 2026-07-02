# Shift Ledger — nightly QA dev-evidence sweep (local, $0, no cloud LLM key).
#
# Drives Claude Code headless to run the `qa-evidence` skill in SWEEP mode: audit the
# Projects v2 board for QA/Done issues missing dev evidence, backfill what it can produce
# headlessly (targeted test output, query/policy proof), and flag the rest.
#
# HARD GUARDRAILS (docs/automation.md): it must NEVER merge, close, push, or move a card to
# Done. Those are enforced two ways below — a scoped tool allowlist + explicit prompt rules —
# but note a *local* `gh` token can still do destructive things, so the prompt guardrail is
# soft. For real safety, run this under a gh token scoped to issues:write + project only
# (see the SECURITY note at the bottom).
#
# One-time setup (run these in your interactive Claude Code terminal, NOT here):
#   (Get-Command claude).Source     # confirm the claude CLI path
#   claude --help                    # confirm the -p / --allowedTools / --permission-mode flags below
#
# Wire up the nightly trigger (elevated PowerShell, from the repo root):
#   $repo    = (Get-Location).Path
#   $action  = New-ScheduledTaskAction  -Execute "pwsh" -Argument "-NoProfile -File `"$repo\scripts\qa-evidence-sweep.ps1`""
#   $trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
#   Register-ScheduledTask -TaskName "shift-ledger-qa-sweep" -Action $action -Trigger $trigger `
#     -Description "Nightly QA dev-evidence sweep (Shift Ledger)" -RunLevel Limited
#   # Remove:  Unregister-ScheduledTask -TaskName "shift-ledger-qa-sweep" -Confirm:$false
#   # Test now: Start-ScheduledTask -TaskName "shift-ledger-qa-sweep"

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Join-Path $PSScriptRoot "..")   # repo root

$logDir = Join-Path $PSScriptRoot "..\.logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ("qa-sweep-{0}.log" -f (Get-Date -Format "yyyy-MM-dd"))

# The sweep instruction. Guardrails are stated explicitly and redundantly on purpose.
$prompt = @'
Run the qa-evidence skill in SWEEP mode (see .claude/skills/qa-evidence/SKILL.md, Mode B).

Audit the Projects v2 board for issues in "QA (evidence)" or "Done" that lack the
qa:dev-evidence label. For each candidate:
  - If you can produce the evidence headlessly (targeted test output that proves the
    issue's acceptance criteria, or a DB query/policy proof), do so, post it as an issue
    comment, and add the qa:dev-evidence label.
  - If it needs a UI screenshot/recording or human judgment you cannot produce headlessly,
    add the qa:needs-dev-evidence label and comment exactly what is required.

HARD RULES — do not violate under any circumstance:
  - NEVER merge, close, or delete an issue or PR.
  - NEVER push commits or open PRs.
  - NEVER move a board card to Done.
  - Stay read-only on code: comment + label only. Do not edit files.
Follow docs/automation.md. Finish with a one-paragraph summary: counts attached vs flagged,
then a per-issue list ("#n - attached" or "#n - needs: <what>").
'@

"==== qa-sweep {0} ====" -f (Get-Date -Format o) | Add-Content $log

# NOTE: verify these flags against `claude --help` on your machine before scheduling.
#   -p / --print   : headless (non-interactive) run
#   --allowedTools : pre-approve ONLY the tools the sweep needs. Anything not listed prompts
#                    (and in headless mode is denied), so the guardrail holds by construction.
# The gh allowlist is granular ON PURPOSE — read + comment + label only. It excludes
# `gh pr merge`, `gh issue/pr close`, `git push`, and even `gh api graphql` (sweep mode never
# moves board columns), and there is no Edit/Write, so the sweep cannot mutate code or state.
& claude -p $prompt `
    --output-format text `
    --allowedTools `
      "Bash(gh auth status)" "Bash(gh label create:*)" "Bash(gh project item-list:*)" `
      "Bash(gh issue view:*)" "Bash(gh issue list:*)" "Bash(gh issue comment:*)" "Bash(gh issue edit:*)" `
      "Bash(gh pr view:*)" "Bash(gh pr list:*)" `
      "Bash(npm test)" "Bash(npm run test:*)" "Read" "Grep" "Glob" "Skill" `
    2>&1 | Tee-Object -FilePath $log -Append

"==== qa-sweep done exit=$LASTEXITCODE {0} ====" -f (Get-Date -Format o) | Add-Content $log

# SECURITY: the allowlist above is the primary guardrail. As defence-in-depth, a local gh
# token could still be misused via a command shape not on the list; the strongest fix is to
# run this under a SEPARATE gh token scoped to issues:write + repository-projects:write only
# (a machine account), exported as GH_TOKEN for this task — then destructive actions are
# impossible regardless of what any command tries.
