# Shift Ledger — Project Flow Log

A running, high-level log of what has been built and decided, so any agent or human can
catch up fast. Detail lives in [`docs/architecture.md`](docs/architecture.md) (full 23-section
design + decisions D1–D13, F1–F8), [`SECURITY.md`](SECURITY.md), and [`CLAUDE.md`](CLAUDE.md)
(working agreement). Update this at the end of each working session.

_Last updated: 2026-07-02._

## Status snapshot
- **M0 — Design sprint:** ✅ complete (design system: shadcn/ui + Radix + Tailwind v4, OKLCH tokens, self-hosted Geist/GDPR; 49 components; 14 screens; light + dark).
- **M1 — Backend Foundation & RLS Proof:** ✅ **merged to `main`** — schema + RLS gate + seed + CI, plus the full scaffold epic (**#2**). Product UI still to come.
- **Scaffold epic #2:** ✅ complete — CI gates, Prettier/pre-commit, conventions, health route, keyless automation, and Vercel are all on `main`.
- **In flight:** **Better Auth #39–#42** (epic #4) — separate conversation. Playwright E2E **#59** — its own conversation.

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
- Recently moved to **Done:** #29, #30, #33, #58, #63, #31, #72.

## Next
1. **Better Auth #39–#42** (epic #4, separate conversation): #39 install/config → #40 sign-up/in/out → #41 org-aware session (active `organization_id` → RLS GUC) → #42 role model + permission checks (D7). Core-auth-only (no Better Auth org plugin — the app owns tenancy); open self-signup provisions a first org + Owner via a `provisionOrganization()` path that respects RLS.
2. **Neon EU #34 / #3:** provision the DB (non-superuser app role) + pooled connection; swap the placeholder Vercel env values for real ones.
3. Then M2 feature work (occurrence lifecycle, exception/corrective-action state machines, tablet identity).
