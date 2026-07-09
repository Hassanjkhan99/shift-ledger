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
