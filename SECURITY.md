# Shift Ledger — Security Posture

Shift Ledger is a food-safety **documentation & operational-proof** tool. It is **not** a
legal-compliance certification service. This file tracks the security posture as we build
and the checklist of production hardening to finalize before pilot ("highlight while
developing, finalize before go-live" — CTO decision D13).

_Last updated: Milestone 1 (Foundation), 2026-07-01._

## Current posture (in place as of Milestone 1)

### Multi-tenancy isolation (defense-in-depth)
- **`organization_id` on every tenant-scoped table.** The only non-tenant table is `users`
  (global identity by design — tenancy lives on `memberships`).
- **Row-Level Security enabled AND FORCED** on every tenant table (`organizations`,
  `memberships`, `invitations`, `properties`, `outlets`, `activity_log`). FORCE means RLS
  applies even to the table owner.
- **The app connects as a NON-superuser role (`app_user`, `NOSUPERUSER NOBYPASSRLS`).**
  This is critical: PostgreSQL superusers bypass RLS even when FORCE is set. Migrations run
  as `app_user` (which owns the schema); only seeding uses the superuser connection.
- **Transaction-local tenant GUC.** All tenant-scoped access goes through `withTenant()`,
  which opens a transaction and sets `app.current_org_id` via
  `set_config('app.current_org_id', $orgId, true)` — the `true` makes it **transaction-local**,
  so it is safe under connection pooling (no leakage across pooled connections). RLS policies
  read this GUC; with no GUC set, policies default-deny (zero rows).
- **Verified by an automated cross-tenant leak test** (`tests/rls.test.ts`): as Org A the app
  cannot read Org B's rows, and with no tenant context it reads nothing.

### Immutable audit trail
- **`activity_log` is append-only at the database level.** A trigger raises an exception on
  any `UPDATE` or `DELETE`, enforced regardless of application code. Verified by
  `tests/activity-log-immutability.test.ts`.

### Baseline
- Secrets via environment variables (`.env` git-ignored; `.env.example` documents the shape).
- Logger redacts `password`/`token`/`authorization`/`DATABASE_URL`.
- UUID v7 primary keys (non-guessable, non-sequential across tenants).

## Pending production hardening (before pilot)

| Area | Item | Milestone |
|---|---|---|
| Auth | Better Auth (sessions, org context → GUC), password/session policy | M2 |
| Tenancy | Property/outlet scoping layer on top of org RLS | M2 |
| API | GraphQL depth/complexity limits; introspection OFF in prod; rate-limit `/api/graphql` (F7) | later |
| Audit | Per-org dense `seq` + hash chain (`prev_hash`/`row_hash`) for tamper-evidence (F6) | M7 |
| Writes | Idempotency keys on state-producing writes; single `transition()` choke point (F2/F4) | M5 |
| Uploads | Presigned R2 PUT/GET, content-type allowlist, size limits, strip EXIF/GPS, checksum | M5 |
| GDPR | DSAR export/delete, retention job (1095-day default), legal-hold enforcement, DPA | M9 |
| Transport | Security headers / CSP, HTTPS-only cookies, CSRF posture for any non-Action POST | later |
| Secrets | Move to managed secrets (Vercel/host); rotate; never commit | pre-pilot |
| DB | Neon EU (non-superuser app role); PITR backups; connection pooling verified with GUC | pre-pilot |

## Dev-only shortcuts (MUST be hard-gated; never in production)
_Tracked here so they cannot silently ship. Each must assert `NODE_ENV !== 'production'`._

- **Local database credentials** (`app_user`/`app_user`, `postgres`/`postgres`) — embedded-postgres
  dev cluster only. Production uses managed secrets.
- _(Coming in M2+)_ dev "log in / impersonate any role" switcher; GraphQL introspection/playground
  in dev; relaxed rate limits in dev.

## Deviations from plan (recorded)
- **Dev DB:** D13 specified Docker Postgres 16; Docker is unavailable on the dev machine, so we
  use **`embedded-postgres` (PostgreSQL 18, no Docker/admin)**. Prod is unchanged (Neon EU,
  `DATABASE_URL`-driven). PG18 also provides a native `uuidv7()` (simplifies UUIDv7 PKs).
- **Framework:** `create-next-app@latest` installed **Next.js 16** (current stable) rather than 15;
  App Router / RSC / Server Actions unchanged.
- **ORM:** Prisma **7** (current stable) with the `prisma-client` generator + `@prisma/adapter-pg`
  driver adapter.
