# Shift Ledger — Project Flow Log

A running, high-level log of what has been built and decided, so any agent or human can
catch up fast. Detail lives in [`docs/architecture.md`](docs/architecture.md) (full 23-section
design + decisions D1–D13, F1–F8), [`SECURITY.md`](SECURITY.md), and [`CLAUDE.md`](CLAUDE.md)
(working agreement). Update this at the end of each working session.

## Status snapshot
- **M0 — Design sprint:** ✅ complete (design system: shadcn/ui + Radix + Tailwind v4, OKLCH tokens, self-hosted Geist/GDPR; 49 components; 14 screens; light + dark).
- **M1 — Backend Foundation & RLS Proof:** ✅ built — **PR #57 in QA (evidence), not merged.**
- **In flight:** #58 split CI into attributable gates (this branch). #59 Playwright E2E = its own conversation.

## What M1 delivered (PR #57)
- Next.js 16 (App Router, TS) + Tailwind v4, shadcn-ready · pino logger · Sentry hook.
- Prisma 7 on PostgreSQL 18 (local: `embedded-postgres`, no Docker; prod: Neon EU via `DATABASE_URL`).
- Schema: organizations, users (global), memberships, invitations, properties, outlets, activity_log. UUIDv7 PKs, canonical enums (D1/D2/F8), `organization_id` on every tenant table.
- **Security spine (tested, 12/12):** RLS enabled + FORCED; app connects as non-superuser `app_user`; transaction-local `set_config('app.current_org_id', …, true)` via `withTenant()`; cross-tenant read/write/update/delete all denied; default-deny with no context; `activity_log` append-only (DB trigger rejects UPDATE/DELETE/TRUNCATE).
- Dev seed (2 orgs + users/memberships/properties/outlets). CI (GitHub Actions). SECURITY.md. **No product UI.**

## Key decisions / deviations (recorded in SECURITY.md)
- Docker unavailable on dev machine → **embedded-postgres (PG18)**; prod unchanged (Neon EU). PG18 gives native `uuidv7()`.
- **Next.js 16** and **Prisma 7** (current stable) — App Router + driver-adapter patterns unchanged.
- Bug caught by the RLS gate: rolled-back transaction-local GUC resets to `''` (not NULL) → policies use `NULLIF(current_setting('app.current_org_id', true), '')` (fail-closed).

## Workflow & board
- Repo: Hassanjkhan99/shift-ledger · Board: Projects v2, pipeline `Backlog → Ready → In Progress → In Review → QA (evidence) → Done`.
- Issue-first; one issue → one branch → one PR → one QA-evidence comment; agent never self-approves. See [`CLAUDE.md`](CLAUDE.md).
- M1 PR #57 cards (epics #5, #6 + subs) are in **QA (evidence)** awaiting human QA. F-principle impl tasks #52–#55 re-milestoned to M2.
- Backlog groomed this session: #58 (split CI), #59 (Playwright E2E), #60 (fold rules into CLAUDE.md).

## Next (after #57 merges)
1. #29 Prettier + pre-commit · 2. #30 conventions doc · 3. #33 health route — then Better Auth (#39–#42) before Neon (#34). One issue, one branch, one PR, one evidence comment each.
