# Shift Ledger — Project Flow Log

A running, high-level log of what has been built and decided, so any agent or human can
catch up fast. Detail lives in [`docs/architecture.md`](docs/architecture.md) (full 23-section
design + decisions D1–D13, F1–F8), [`SECURITY.md`](SECURITY.md), and [`CLAUDE.md`](CLAUDE.md)
(working agreement). Update this at the end of each working session.

_Last updated: 2026-07-03._

## Status snapshot

| Milestone | Status | Notes |
|---|---|---|
| **M0 — Design sprint** | ✅ complete (QA gate pending) | 49 components, 14 screens, light + dark. #27 in QA (evidence); #24/#25/#26 done — human sign-off closes #1 parent epic. |
| **M1 — Backend Foundation** | ✅ merged to `main` | Schema + RLS gate + seed + CI + scaffold + Better Auth + Prisma tenant-guard. |
| **M1 — Neon EU** | 🔴 human-gated | #34 / #3 — credentials needed; Vercel env slots have placeholders. |
| **M2 — Feature layer** | 🟡 in progress | #55 (F5 keyset pagination) first — dependency-corrected order (see below). Occurrence lifecycle, exceptions, state machines, F2–F5 correctness. |

## What's on `main`
**Foundation (M1):**
- Next.js 16 (App Router, TS) + Tailwind v4, shadcn-ready · pino logger · Sentry hook (no-op without DSN).
- Prisma 7 on PostgreSQL 18 (local: `embedded-postgres`, no Docker; prod: Neon EU via `DATABASE_URL`).
- Schema: organizations, users (global), memberships, invitations, properties, outlets, activity_log. UUIDv7 PKs, canonical enums (D1/D2/F8), `organization_id` on every tenant table.
- **Security spine:** RLS enabled + FORCED; app connects as non-superuser `app_user`; transaction-local `set_config('app.current_org_id', …, true)` via `withTenant()`; cross-tenant read/write/update/delete all denied; default-deny with no context; `activity_log` append-only (DB trigger rejects UPDATE/DELETE/TRUNCATE).
- Dev seed (2 orgs + users/memberships/properties/outlets).

**Scaffold / infra / tooling merged since M1:**
- **CI (3 attributable gates)** — Build (typecheck+lint+`next build`), QA (Vitest: RLS leak + immutability, embedded PG18), Format (`prettier --check`). **25 tests green.** (#58, #72)
- **Prettier + Husky pre-commit** (lint-staged) (#29) · **conventions doc** (#30) · **`/api/health` liveness route** + smoke test (#33).
- **Keyless GitHub Actions automation** — weekday standup + qa-evidence (no paid LLM key) (#63).
- **Vercel (#31):** project `shift-ledger`, **EU function region `fra1`** (Frankfurt, data residency), Preview + Production env tiers. Env slots `DATABASE_URL` / `SUPERUSER_DATABASE_URL` / `LOG_LEVEL` wired (DB URLs are **placeholders** until Neon lands — #34/#3). **D13 prod-guard** (`src/lib/prod-guard.ts`, via `instrumentation.ts`) fails closed on dev shortcuts / dev DB creds under `NODE_ENV=production`. Production deploy verified **● Ready in `fra1`**.
- **`.gitattributes`** `* text=auto eol=lf` (#72) — repo is LF everywhere; local `format:check` now matches CI.

**Better Auth — all sub-issues merged to `main` (#39–#42, epic #4):**
- #39 Install & configure Better Auth · #40 Sign-up/in/out flows · #41 Org-aware session (`active_organization_id` → RLS GUC) · #42 Role model + permission checks (D7).

**CI tenant-guard — merged to `main` (PR #77, issue #70):**
- ESLint rule rejecting raw `prisma.*` calls outside `withTenant()`. Enforces D6 at the static-analysis layer before CI runs.

## Key decisions / deviations (recorded in SECURITY.md)
- Docker unavailable on dev machine → **embedded-postgres (PG18)**; prod unchanged (Neon EU). PG18 gives native `uuidv7()`.
- **Next.js 16** and **Prisma 7** (current stable) — App Router + driver-adapter patterns unchanged.
- RLS gate bug: rolled-back transaction-local GUC resets to `''` (not NULL) → policies use `NULLIF(current_setting('app.current_org_id', true), '')` (fail-closed).
- **Vercel region:** Hamburg isn't a Vercel region → **`fra1` (Frankfurt)** is the German/EU choice.
- **Vercel build:** the generated Prisma client is gitignored, so Vercel needs `buildCommand: "prisma generate && next build"` (in `vercel.json`).
- **Vercel author check:** Vercel only builds previews for commits whose author maps to a known GitHub account — commits are authored as the repo owner so previews build.
- **Format "debt" was a mirage:** committed blobs were already LF; the ~13 files `format:check` flagged locally were a Windows `autocrlf` (CRLF working-tree) artifact. Fix = Format gate + `.gitattributes`, no content reformatting.

## Workflow & board
- Repo: Hassanjkhan99/shift-ledger · Board: Projects v2, pipeline `Backlog → Ready → In Progress → In Review → QA (evidence) → Done`.
- Issue-first; one issue → one branch → one PR → one QA-evidence comment; agent never self-approves. See [`CLAUDE.md`](CLAUDE.md).
- **CI/workflow changes go in a dedicated CI issue** and **merge via the GitHub web UI** — the merge API can silently drop `.github/workflows/*`.
- Recently moved to **Done:** #29, #30, #33, #58, #63, #31, #72, #56, #70, #75 + all M1 sub-issues (#28, #32, #35–#51).

## Milestone → open issues map

### M0 — Design sprint (QA gate)
| Issue | Title | Status |
|---|---|---|
| #1 | M0 parent epic | open (closes when #27 Done) |
| #24 | Hi-fi designs: 14 screens | done, human sign-off pending |
| #25 | 6 core user flows | done, human sign-off pending |
| #26 | Component inventory + design tokens | done, human sign-off pending |
| #27 | Design review & approval | **QA (evidence)** — evidence posted 2026-07-03 |

### M1 — Foundation (human-gated remainder)
| Issue | Title | Status |
|---|---|---|
| #2 | Scaffold Next.js monolith | done — close manually |
| #3 | Provision Neon + Prisma + UUIDv7 | Prisma/UUIDv7 done; Neon blocked on #34 |
| #4 | Integrate Better Auth (epic) | done — sub-issues #39–42 all closed; close manually |
| #7 | F1–F8 correctness principles | F6/F7/F8 done; F2–F5 are M2 issues (#52–55) |
| #34 | Provision Neon EU + pooled connection | 🔴 **human action** — credentials + Vercel env swap |

### M2 — Feature layer (in progress)
**Dependency-corrected order** (the original `#52→#53→#54→#55` handoff order was inverted — #52/#53 target `task_completions`, which does not exist yet, and #52 is blocked-by #54). Real chain:

| Order | Issue | Title | Blocked by |
|---|---|---|---|
| 1 | #55 | F5: keyset pagination utility + convention | — (deps met) — **🟡 In Progress** |
| 2 | #54 | F4: `transition()` mechanism (status write + `activity_log`, atomic) | #56 (done) |
| 3 | #8 | Occurrence lifecycle enum + generation (Inngest) — **creates `task_completions` etc.** | #54 |
| 4 | #9 | Exception + corrective-action state machines | #54, #8 |
| 5 | #53 | F3: server-authoritative timestamps (`recorded_at`) | #8/#9 (task_completions) |
| 6 | #52 | F2: idempotency keys (`client_submission_id`) on writes | #54, #8/#9 (task_completions) |
| 7 | #10 | Domain wiring: route transitions through `transition()` (F4 application) | #54, #8, #9 |
| — | #11 | Shared-tablet actor identity + correction-version permissions | #8/#9 |
| — | #69 | Shared-tablet PIN: issuance, storage, verification | — |

**#10 vs #54 "duplicate" resolved (not a dup):** #54 = the generic mechanism (backend); #10 = the domain application that consumes it (edge sets, role guards, repeated-deviation rule, F4 assertion test). Neither closed; #10 retitled to remove the identical-title collision, both cross-linked.

### M3 — Storage, evidence, exports
#12 R2 + attachments · #13 SHA-256 hash chain · #14 PDF audit pack

### M4 — Product UI
#15 GraphQL (yoga + Pothos + DataLoader) · #16 Today dashboard · #17 Server Actions + idempotency

### M5 — Hardening + observability
#18 Retention · #19 GraphQL hardening · #20 Inngest + IndexedDB queue · #21 Sentry + pino + Resend

### Tooling / process (parallel)
#59 Playwright E2E · #60 Working agreement update · #62 Decision journal

### Validation (human)
#22 DE/NL legal retention number · #23 Walk-in connectivity reality check

## Next
1. **Neon EU #34** — provision Neon DB (non-superuser `app_user` role), swap Vercel placeholder env values. Human action; unblocks prod deploy.
2. **Close stale M1 epics** — #2, #4 are done; close them to keep the board clean.
3. **M0 sign-off** — human review of #24, #25, #26, #27 → close all → close #1.
4. **M2 in progress** — #55 (F5 keyset pagination) is the first M2 issue (branch `feat/55-keyset-pagination`). Corrected dependency order: #55→#54→#8→#9→#53→#52→#10 (see M2 table above; #52/#53 wait on `task_completions` from #8/#9).
