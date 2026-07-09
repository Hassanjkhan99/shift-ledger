# shift-ledger
Shift Ledger - daily operational-proof command center for HACCP-style hotel-kitchen food-safety (EU/GDPR). Next.js 15 monolith on Vercel.

> Operational-proof / documentation tool — **not** legal-compliance certification.

## Deploy notes — Better Auth env (#131)

The auth UI (sign-up / sign-in / sign-out) is backed by Better Auth and needs two env vars set per
environment. See [`.env.example`](.env.example) for the full contract.

- **`BETTER_AUTH_URL`** — must equal the origin the app is served from (scheme + host + port). Better
  Auth rejects requests whose `Origin` header does not match with `INVALID_ORIGIN`, so a mismatch here
  silently breaks sign-in/sign-up. On Vercel set it **per-environment** to the Preview / Production URL.
- **`BETTER_AUTH_SECRET`** — signs the session cookie; set a strong random value in every hosted env.
  The app falls back to a dev-only insecure secret if unset, which is fine only for local dev.

## Database environments (Neon) — #143

We **own the Neon branch lifecycle in CI** so preview branches can't pile up and hit the branch limit
again. Each environment maps to a fixed, long-lived branch except for ephemeral per-PR branches:

| Environment              | Neon branch          | `DATABASE_URL` set in            |
| ------------------------ | -------------------- | -------------------------------- |
| Production               | `production`         | Vercel **Production** env        |
| Preview (default) + dev  | `shift-ledger-dev`   | Vercel **Preview** env           |
| CI, per open PR          | `preview/pr-<n>`     | created/deleted by the workflow  |

The [`Neon preview branch`](.github/workflows/neon-preview.yml) workflow creates `preview/pr-<n>` when a
PR opens and **deletes it when the PR closes** (merged or not), running `prisma migrate deploy` against it
as a per-PR migration check. It needs two repo secrets: **`NEON_API_KEY`** and **`NEON_PROJECT_ID`**.

**One-time dashboard runbook (must be done outside the repo):**

1. **Disable Vercel's native auto-branching** — the Vercel↔Neon integration otherwise creates its own
   branch per preview (the original cause of the limit being exceeded). In Vercel → Storage/Integrations →
   Neon (or Neon Console → Integrations → Vercel), turn OFF "create a branch per preview deployment".
2. Point Vercel **Production** env `DATABASE_URL` at the `production` branch, and **Preview** env
   `DATABASE_URL` at the fixed `shift-ledger-dev` branch (both a non-superuser role — never a
   BYPASSRLS/owner role for the app runtime).
3. Add `NEON_API_KEY` + `NEON_PROJECT_ID` as **GitHub Actions secrets** so the lifecycle workflow can run.
