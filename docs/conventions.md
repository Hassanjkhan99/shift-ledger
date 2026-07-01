# Shift Ledger — Code Conventions

Practical conventions for this repo. The "why" and full design live in
[`architecture.md`](architecture.md); the working agreement is in [`../CLAUDE.md`](../CLAUDE.md).
This is the day-to-day cheat sheet.

## Project structure

```
src/
  app/            # Next.js App Router: routes, layouts, RSC pages
    api/          #   thin REST route handlers (uploads, exports, cron, webhooks) — added per feature
  lib/            # server/shared utilities (db.ts tenant wrapper, logger, auth, guards)
  generated/      # generated code (Prisma client) — git-ignored, never edited by hand
prisma/           # schema.prisma, migrations/, seed.ts
scripts/          # dev/ops scripts (embedded-postgres dev DB, etc.) — .mjs, run with node/tsx
tests/            # Vitest specs + global-setup (ephemeral PG)
docs/             # architecture.md, conventions.md, automation.md, FLOW.md (root)
```

## Data access (the important one)

Three paths, do not mix them up:

1. **Reads (server render): React Server Components → Prisma directly.** Minimal client JS.
2. **Live client reads: GraphQL** (`/api/graphql`, yoga + Pothos + **DataLoader** — no N+1) via TanStack Query. *(Arrives in M4; not built yet.)*
3. **Writes: Server Actions** (Zod-validated). **No tRPC.** GraphQL is read-only.

**Every tenant-scoped DB access goes through `withTenant(orgId, tx => …)`** (`src/lib/db.ts`). It opens a transaction and sets the transaction-local RLS GUC. **Never** query tenant tables outside it — a raw query with no tenant context returns zero rows by design (RLS default-deny), and bypassing the wrapper is a security bug, not a shortcut.

**Thin REST** (`src/app/api/*`) only for what must live outside React: signed uploads, export downloads, cron/Inngest, webhooks, future mobile API.

## Security conventions (non-negotiable)

- App connects as the **non-superuser** DB role (superusers bypass RLS). Migrations/seed use the elevated role only.
- Tenant tables carry `organization_id`; **RLS enabled + FORCED**; policies read `app.current_org_id`.
- `activity_log` is **append-only** (DB trigger). Compliance records (completions/evidence) are immutable — edits create versions, never mutate.
- Writes that can be retried carry an **idempotency key** (`client_submission_id`, F2). Compliance timestamps are **server-authoritative** (`recorded_at`, F3), never client-supplied.
- Validate all input with **Zod** at the boundary.

## Components

- **Default to Server Components.** Add `"use client"` only for interactivity (forms, optimistic lists, uploads, keypad).
- Keep client bundles small; push data fetching to RSC/GraphQL, not client effects.

## Naming & style

- Files: `kebab-case` for modules/routes; `PascalCase` for React components.
- DB: snake_case columns (via Prisma `@map`), tables plural. Enums use canonical values (D1/D2/F8).
- TypeScript strict; no `any` without a comment justifying it.
- **Formatting is automatic** — Prettier + Husky pre-commit (`npm run format` / `format:check`). Don't hand-format.

## Testing

- Every issue ships tests; keep `main` green (no bug debt).
- Vitest; DB-backed tests use the ephemeral embedded-postgres global setup (`tests/global-setup.ts`).
- Security-critical behavior (RLS isolation, audit immutability) must have explicit tests — see `tests/foundation.test.ts`.

## Workflow

Issue-first: one issue → one `feat/<issue#>-<slug>` branch → one PR (`Closes #n`) → CI green → QA evidence on the issue → merge. Keep `.github/workflows/` changes out of feature PRs (GitHub's merge API can drop them; edit workflows only in dedicated CI issues). See [`../CLAUDE.md`](../CLAUDE.md).
