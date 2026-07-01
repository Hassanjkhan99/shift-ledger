# Shift Ledger — Working Agreement

**Read this before doing anything in this repo.** It governs how every agent and human works here, and overrides convenience.

Product: **Shift Ledger** — a daily operational-proof command center for HACCP-style hotel-kitchen food safety (EU/GDPR). It is an operational-proof / documentation tool, **not** legal-compliance certification — never claim otherwise.

## 1. Golden rule — issue-first
- **No code is written that is not tied to a GitHub issue.** No issue -> create one first, then start.
- One issue = one small, independently **testable** unit of work.
- Bigger than one testable unit? Split into sub-issues before coding.
- Find a bug or a missing task mid-stream? Open an issue for it — do not silently fold it in.

## 2. The board
Project: https://github.com/users/Hassanjkhan99/projects/1
Status pipeline: `Backlog -> Ready -> In Progress -> In Review -> QA (evidence) -> Done`
- **Backlog** recorded, not ready · **Ready** scoped + unblocked · **In Progress** actively being built · **In Review** PR open, tests green · **QA (evidence)** being verified, evidence required · **Done** verified + closed.

## 3. Per-issue protocol (keep the board in sync)
1. Pick a **Ready** issue -> move it to **In Progress**, assign yourself.
2. Branch: `git checkout -b feat/<issue#>-<slug>`.
3. Implement **only** what the issue describes. Scope creep -> new issue.
4. **Test as you go.** Every issue ships with tests. We keep `main` green and bug-free — no bug debt.
5. Open a PR with `Closes #<issue>`. CI green -> move to **In Review**.
6. After review -> move to **QA (evidence)**.

## 4. Definition of Done (QA + evidence gate)
An issue reaches **Done** only when QA has verified it **and evidence is attached as a comment on the issue**:
- Passing test output (for the RLS gate #6: the cross-tenant leak-test result).
- Screenshot / recording for UI work.
- Query or policy proof for schema & security items.
No evidence -> not Done. Closing happens via the merged PR.

## 5. Board-sync helpers (gh)
```bash
export GH_REPO=Hassanjkhan99/shift-ledger
PROJECT_ID=PVT_kwHOBDUTYs4BcNe1
STATUS_FIELD=PVTSSF_lAHOBDUTYs4BcNe1zhW380E
# option ids: Backlog=425864e0 Ready=8be49a2d InProgress=b5fa95d4 InReview=f14de456 QA=6a19dd7f Done=895e4a78

set_status () {  # usage: set_status <issue#> <option-id>
  local item=$(gh project item-list 1 --owner Hassanjkhan99 --format json --limit 200 \
    | jq -r ".items[] | select(.content.number==$1) | .id")
  gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' \
    -f p=$PROJECT_ID -f i=$item -f f=$STATUS_FIELD -f o=$2
}
```
(Or just drag the card in the board UI.)

## 6. Architecture guardrails (do not drift)
Locked spine: Next.js 15 App Router monolith on Vercel · TypeScript · reads = RSC, writes = Server Actions, thin REST only for uploads/exports/cron/webhooks · **no tRPC** · Postgres on Neon (EU) + Prisma + UUIDv7 · tenancy = `organization_id` on every row + Postgres RLS · **Better Auth** · Cloudflare R2 · Inngest · @react-pdf/renderer · Resend · Sentry + pino · client reads via GraphQL (yoga + Pothos + DataLoader) + TanStack Query, **no Apollo Client**.

Binding decisions (highlights):
- **D1** occurrence enum: pending -> due -> overdue -> completed | completed_late | failed | skipped | cancelled. **D3** grace 15 min.
- **D6** RLS via transaction-local `set_config('app.current_org_id', ..., true)` (Neon-pooling safe). **Prove with the cross-tenant leak test (#6) BEFORE any feature work.**
- **D5** retention 1095 days, per-org + legal hold — must be legally validated per customer.
- **F1** no N+1 (DataLoader) · **F2** idempotency keys · **F3** server-authoritative timestamps · **F4** single state-transition choke point -> activity_log · **F5** keyset pagination · **F6** evidence SHA-256 hash chain · **F7** GraphQL hardening · **F8** schema reconciled to D1/D2/D3/D5.

**Refused for MVP:** AI, IoT/sensors, inventory, procurement, POS/PMS, recipe mgmt, full offline-first (D9: IndexedDB write-queue only). Config via templates only.

Full 23-section design doc lives with the team's founding architecture notes.