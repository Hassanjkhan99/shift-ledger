# Shift Ledger — MVP Software Architecture (Plan)

> This plan file is the **founding-CTO architecture design** for the Shift Ledger MVP — a design document, **no production code yet**.
>
> **How to read it:**
> 1. **CTO pre-build decisions** (immediately below) — my *binding* resolutions to the cross-section inconsistencies and open questions the design surfaced. Read these first; they override any drift in the sections.
> 2. **The full 23-section architecture** (after the divider) — product interpretation, scope, journeys, domain model, multi-tenancy, permissions, state machines, DB schema, scheduling, evidence/audit, API, frontend, UX, notifications, export, security, deployment, scalability, testing, roadmap, ADRs, risks, and final recommendation.
>
> **Compliance stance (non-negotiable):** Shift Ledger is an operational-proof & documentation tool. It must never claim to provide legal compliance certification. EU data residency (Germany/Netherlands launch), GDPR-aware.

---

# Orchestration brief — progress & current phase
_A lightweight status/handoff for the orchestration agent. Updated 2026-07-01. Detail lives in the current phase; future phases are outcomes only and will be adjusted as we go._

## Where we are (one line)
Architecture **and** full design system are done and approved. We are at the **start of the code build — Milestone 1 (Foundation).** No production code written yet.

## Done ✅
- **Architecture design** — full 23-section architecture + **13 binding CTO decisions (D1–D13)**: Next.js 15 monolith, GraphQL (reads) + Server Actions (writes), Postgres/Neon + Prisma + UUIDv7, `org_id`-everywhere + RLS tenancy, Better Auth, R2, Inngest, materialize-ahead recurrence, append-only/immutable audit, @react-pdf export. Foundational-correctness principles F1–F8 locked.
- **Milestone 0 — Design sprint (Claude designer)** — shadcn/ui + Radix + Tailwind v4, OKLCH tokens, indigo/Slate + status palette, self-hosted Geist (GDPR); **49 components**, all **14 screens**, light + dark. ⌘K reserved (post-MVP).

## Current phase — Milestone 1: Foundation (backend, no UI) — IN PROGRESS
**Goal:** build the correctness spine everything else hangs off; front-loaded because it's the #1 risk concentration.

**Tasks (track these):**
1. Scaffold Next.js 15 + TS + Tailwind v4 + shadcn (OKLCH tokens, Geist); Sentry + pino; CI.
2. Prisma + **local Docker Postgres 16** (dev); UUIDv7; core schema migration (§8, canonical enums D1/D2/F8); `org_id` on every tenant table.
3. **Tenancy gate (#1 risk):** RLS + FORCE; transaction-local `set_config('app.current_org_id', …, true)` (D6); **cross-tenant leak test** — hard gate, nothing proceeds until green.
4. **Immutability core:** append-only `activity_log` + Postgres trigger (reject UPDATE/DELETE); single `transition()` choke point (F4); versioned-completion pattern.
5. Better Auth — Org / Membership / Invitation / Role; org context → RLS GUC.
6. GraphQL (yoga + Pothos + **DataLoader**) with depth/complexity limits + introspection-off-in-prod (F1/F7); TanStack Query provider; IndexedDB write-queue scaffold (D9).
7. **Dev experience (D13):** full seed (all roles/entities), dev-only role switcher — all hard-gated behind a prod assertion; start `SECURITY.md` hardening checklist.

**Acceptance:** RLS blocks cross-org reads (test) · immutability trigger rejects UPDATE/DELETE · CI green · deploys to Vercel.

**Where orchestrator input / provisioning helps:** Neon EU, Cloudflare R2, Resend, Inngest credentials (needed as we reach each integration — local Docker unblocks everything until then); and the two pre-pilot validations: **exact DE/NL legal retention number** and **HACCP starter-template content** (needs a real chef/counsel).

## Future phases — outcomes only (adjustable)
- **M2 — Orgs / properties / users:** manage org structure, invitations, property-scoped roles.
- **M3 — Templates & schedules:** recurring task generation, DST-safe + idempotent (2nd risk concentration).
- **M4 — Today dashboard:** fast frontline view + manager multi-outlet rollup.
- **M5 — Task completion & evidence:** the product heartbeat; adaptive required-evidence; R2 uploads; immutable versions.
- **M6 — Exceptions & corrective actions:** full state machines (D2).
- **M7 — Timeline & audit logs:** complete transition coverage + optional hash chain.
- **M8 — Audit export:** async PDF/CSV packs with the non-certification disclaimer.
- **M9 — Pilot readiness:** GDPR (DSAR/retention), EU residency verified, onboarding, perf + security pass.

## Guardrails the orchestrator should hold me to
- **Scope:** no ERP / inventory / procurement / POS / PMS / recipe / AI / offline-CRDT / custom-forms engine. **Templates only.**
- **Security spine always on** (RLS, append-only audit, scoping, Zod, GraphQL limits); dev shortcuts hard-gated; `SECURITY.md` finalized before pilot.
- **Foundations right on day one (F1–F8):** no N+1, idempotency keys, server-authoritative timestamps, single transition choke point, keyset pagination, evidence hashing, GraphQL hardening.
- **Compliance stance:** documentation/proof, never legal certification.

## Pointers
Full detail: this plan file — **§1–§23** (architecture), **D1–D13** (binding decisions, above), **Appendix A** (designer brief), **Appendix B** (design system spec).

---

## Context — why this design exists

We are building an MVP SaaS product, "Shift Ledger — the Linear of hotel kitchen operations": a fast, opinionated daily command center that lets a kitchen manager answer one question — *what must happen today, what was missed, and can I prove it happened?* The design goal is a narrow, durable architecture that **one strong full-stack engineer** can build and operate, that **feels fast** (Linear/Stripe/Vercel-grade), and whose **compliance records are trustworthy by construction** (immutable, attributable, tamper-evident). The document below was produced by a multi-agent design pass anchored to a single locked architectural spine, then reviewed by an editor pass that flagged the inconsistencies I resolve next.

## CTO pre-build decisions (BINDING — these override any drift in the sections below)

The design is strong and internally consistent on the big decisions (Next.js monolith, Prisma/Neon, org_id + RLS tenancy, Better Auth, R2, Inngest, materialize-ahead recurrence, append-only audit, @react-pdf export). The editor flagged genuine naming/enum drift and a few unresolved product questions. As founding CTO I resolve them here. **Where a section below disagrees with this list, this list wins** and must be reflected in the first Prisma migration.

### D1 — Canonical `task_occurrence.status` enum
`pending → due → overdue → completed | completed_late | failed | skipped | cancelled` (8 states, matching the product brief). Reject the `scheduled` / `void` variants seen in some sections. `completed_late` = completed after `due_at + grace`. `skipped` ≠ `cancelled`: **skipped** = a legitimate no-op for the day *with a reason* (e.g. kitchen closed); **cancelled** = the occurrence should never have existed (schedule paused/edited before it came due). Propagate to schema (§8), state machine (§7), API (§11), and scheduler tests (§19).

### D2 — Ship the FULL Exception & CorrectiveAction state machines
- Exception: `open → acknowledged → in_progress → resolved → verified`, plus `reopened`.
- CorrectiveAction: `open → assigned → done → verified`, plus `rejected`.
The condensed variants in §4/§8/§11 are superseded. The extra states are cheap to implement and are exactly what makes the audit trail credible to an inspector (who acknowledged, who verified, when).

### D3 — `grace_minutes` default = 15 (configurable per template, 0–60)
Nonzero so the overdue sweep does not fire the instant `due_at` passes and generate false "overdue" noise. §8's `DEFAULT 0` and §9's `default 30` are both replaced by **15**.

### D4 — Evidence↔Attachment constraint keys off drawn-vs-typed, not the type name
`requires_attachment = (type IN ('photo','file')) OR (type = 'signature' AND signature_mode = 'drawn')`. Typed initials / PIN sign-offs require **no** binary attachment; a drawn (canvas) signature does. This fixes the §4 CHECK constraint that would otherwise reject valid typed sign-offs.

### D5 — Retention default = 1095 days (3 years), per-org configurable, with legal hold
A single default replacing the 24-month / 5-year / 3-year disagreement across §4/§8/§10. **This number MUST be legally validated per customer before go-live** — DE/NL food-hygiene documentation expectations vary and this tool does not certify compliance. Support a per-org override and a `legal_hold` flag that blocks deletion/anonymisation while set.

### D6 — RLS session-variable pattern under Neon pooling (the #1 build risk)
Every DB interaction runs inside a Prisma `$transaction` (or a Prisma Client extension) whose **first** statement is `SELECT set_config('app.current_org_id', $orgId, true)` — **transaction-local** (the `true` arg), never a session-level `SET`, so it is safe under PgBouncer transaction pooling. A query issued outside this wrapper sees zero rows (RLS default-deny). Build this and prove it with a **cross-tenant leak test in Milestone 1, before any feature work** — a pooled-connection GUC leak silently defeats the entire tenancy model.

### D7 — Single owner-list for "correct a completed record"
`KitchenManager` (own outlet), `PropertyManager` (own property), `OrgAdmin`, and `Owner` may create a correction **version**. `ShiftLeader`, `Staff`, `Auditor`, and `ExternalInspector` may **not**. Every correction writes a new immutable version + an `activity_log` entry with a **mandatory reason**. This is the authoritative list for the §6 matrix, the §10 narrative, and the Server Action guard.

### D8 — Shared-tablet actor identity (closes the §22 gap)
On shared devices, task completion requires a lightweight per-action actor confirmation (pick-user + 4-digit PIN, or initials). Captured on `task_completion` as `actor_user_id` + `actor_confirmation_method` (`session | pin | initials`). Add to the schema and the completion flow — without it, "who did it" is repudiable on exactly the shared devices frontline staff use, and the audit trail is weak where it matters most.

### D9 — No true offline-first for MVP; YES to write-queue resilience
**Decision date: 2026-07-01.**

True offline-first (Electric SQL, CRDT, PowerSync) is **deferred to V2** — not for performance reasons, but for legal correctness: our immutable audit trail + versioned completions creates a genuine conflict-resolution ambiguity when two staff complete the same task occurrence offline simultaneously. Which completion is the authoritative compliance record? That is a legal/product question that cannot be answered with code alone, and getting it wrong silently is worse than requiring connectivity.

What we DO ship in MVP to cover the walk-in fridge connectivity reality:
- **IndexedDB write-queue**: a task completion that fails to POST (network error) is queued locally and retried silently on reconnect, with a visible "pending sync" indicator. The user never loses a submitted check.
- **TanStack Query aggressive caching** (see D10): reads feel fast and serve from cache on spotty connections; only stale data (not "broken" data) appears.
- **Local draft persistence** (already in §13.5): half-entered forms survive navigation regardless of connectivity.

**V2 path if pilot data confirms offline demand:** Electric SQL (open-source, Postgres-native, compatible with our Neon setup) + PGlite for in-browser read access. The schema does not need to change to adopt this later — org_id + occurrence row model is compatible.

**Do NOT use:** Replicache, Yjs, Automerge, or any CRDT library in MVP. They do not compose well with an immutable-versioned audit trail.

### D10 — TanStack Query (React Query v5) + GraphQL as the client-side data layer
**Decision date: 2026-07-01.**

We add **TanStack Query v5** as the caching/fetching layer for client components, with a **GraphQL fetcher** (generated by graphql-codegen) instead of REST. See ADR-b for the full GraphQL rationale.

**The two-path read model:**
- **Path A — RSC → Prisma directly**: initial page render for all routes. No GraphQL hop, minimal client JS, fast first paint. RSC initial data is passed to `HydrationBoundary` to pre-populate TanStack Query cache, so client components don't make a redundant duplicate fetch on mount.
- **Path B — Client component → TanStack Query → GraphQL (`/api/graphql`)**: live interactive islands — Today dashboard task list (background refetch), Exceptions list, Notification badge. These are the components that need to stay fresh without a full page reload.

**Query key convention:** `[org, property?, outlet?, 'graphql', operationName, variables]` — Server Action success calls `queryClient.invalidateQueries` with the matching prefix for precise cache invalidation. Writes (Server Actions) update the server; TanStack Query reconciles the cache.

**Optimistic mutations:** TanStack Query `onMutate` / `onError` / `onSettled` — task completion flips to "done" locally (no spinner) and reconciles when the Server Action settles. Richer rollback than `useOptimistic` alone.

**Live Today dashboard:**
Option 1 (MVP): TanStack Query polling at 30–60 second interval — simple, no infra.
Option 2 (fast follow): GraphQL subscriptions via WebSocket (graphql-yoga supports this) — swap without refactoring the component, just change the query document to a subscription.

Ship Option 1 for pilot. Add Option 2 if pilots say the 30–60s lag is noticeable.

**Libraries:**
- `@tanstack/react-query` v5 + `@tanstack/react-query-devtools` (dev only)
- `graphql-request` as the lightweight fetch client for graphql-codegen hooks (no Apollo Client — too heavy for MVP)
- `graphql-codegen` pipeline: `@graphql-codegen/typescript` + `@graphql-codegen/typescript-react-query` — generates typed `useQuery` / `useSuspenseQuery` hooks from `.graphql` query documents
- No `axios` / `ky` — native `fetch` only (graphql-request uses fetch internally)

### D11 — Milestone 0: Design sprint with Claude designer BEFORE any frontend code
**Decision date: 2026-07-01.**

No frontend component is written until all 14 main screens are designed, reviewed, and approved. This is **Milestone 0** (see updated roadmap below). The design sprint uses Claude's designer tool and produces:

1. **Mobile-first screens** (375px viewport, iOS-style): Today dashboard (frontline view), Task detail + complete flow, Failed check flow, Shared-tablet PIN actor confirmation.
2. **Desktop screens** (1280px): Manager Today with outlet rollup, Exceptions view, Corrective actions, Timeline, Audit export, Templates, Schedule settings, User management, Property/outlet settings.
3. **Navigation architecture**: Mobile bottom bar + header; desktop sidebar + content area; intercepting-route modal pattern for task detail.
4. **Component inventory**: button variants, form controls, status badges, task cards, evidence upload widget, audit timeline row — enough to define the design system before any code.
5. **User flow diagrams**: the 6 core journeys from §3, mapped as screen-to-screen flows.

**Gate:** Milestone 1 (Foundation) can start in parallel with Milestone 0 (it is backend-only). Milestone 4 (Today dashboard UI) and all subsequent frontend milestones are **blocked until Milestone 0 is approved.**

### D12 — Foundational correctness principles (build right on day one, never "fix later")
**Decision date: 2026-07-01.**

The N+1 query on the Today list is not a performance optimization to defer — it is a correctness problem baked into the data-access shape. The same is true of the items below. Each is cheap to do right at the start and expensive-to-catastrophic to retrofit once there is production compliance data. These are **binding** and must be reflected in the first migration and the first data-access utilities.

**F1 — No N+1, ever (GraphQL AND RSC).** The Today dashboard, timeline, and exceptions list must load in a bounded number of queries regardless of row count.
- GraphQL: `@pothos/plugin-dataloader` is mandatory from the first resolver (per ADR-b). Batching is not optional.
- RSC → Prisma: use explicit `select`/`include` to fetch relations in one round-trip; never loop over rows issuing per-row queries in a Server Component. Code review rejects any per-item query in a list path.
- A test asserts the Today query count is constant (e.g. ≤ 3) for 1 vs 200 occurrences.

**F2 — Idempotency keys on all state-producing writes.** Every task completion (and corrective-action completion, and export request) carries a **client-generated `client_submission_id` (uuid)**, unique per org. This is *required*, not optional, because the D9 offline write-queue retries submissions — without it, a retry after a lost ACK creates a duplicate compliance record. A retry with a seen `client_submission_id` returns the existing row (idempotent success), never a second insert. Added to `task_completions` (§8.14) and mirrored on any queued write.

**F3 — Server-authoritative timestamps (clock trust).** The compliance timestamp on any record (`task_completions.recorded_at`) is set by the **server**, never the client — a client clock can be wrong or manipulated, and "when did this happen" is the crux of the audit. The device's self-reported time is stored *separately* as `client_reported_at` (advisory only, never used for compliance logic or ordering). This is what lets us honestly tell an inspector the timeline is trustworthy.

**F4 — One state-transition choke point.** It must be structurally impossible to change an entity's `status` or create a versioned edit without writing an `activity_log` row. All transitions route through a single application `transition()` service that calls the SECURITY DEFINER log-insert function in the same transaction (§8.20). No Server Action updates a status column directly. A test asserts: for every enum status change in the codebase, a corresponding `activity_log` row exists.

**F5 — Keyset pagination everywhere lists grow.** `activity_log`, `task_occurrences` history, `notifications`, and `exceptions` use **keyset (seek) pagination** (`WHERE (org, seq) < cursor ORDER BY seq DESC LIMIT n`), never `OFFSET`. Offset pagination degrades and reorders under concurrent writes; switching later is an API-breaking refactor. UUID v7 / per-org `seq` make keyset natural.

**F6 — Evidence integrity is required, not optional.** `attachments.checksum_sha256` is **computed and required on upload finalize** (not nullable-in-practice), and for binary evidence the checksum is included in the `activity_log` hash-chain payload for that completion. This is what makes "the photo wasn't swapped afterward" a provable claim, not a hope.

**F7 — GraphQL endpoint hardening (new attack surface from ADR-b).** `/api/graphql` is a public POST surface and must be hardened on day one, not after a pilot:
- **Query depth + complexity limiting** (`@escape.tech/graphql-armor` or Pothos complexity plugin) — reject pathological nested queries.
- **Introspection disabled in production**; enabled only in dev/preview.
- **Persisted/allow-listed operations** are the V2 hardening goal; for MVP, depth+complexity limits + auth are the floor.
- **Rate limiting** (Upstash) applied per-user/per-IP to `/api/graphql` specifically, not just to REST routes.
- Every resolver enforces tenant + property scope via `@pothos/plugin-scope-auth` on top of RLS — GraphQL gets no bypass of the D6 tenant wrapper.

**F8 — Canonical enums/defaults reconciled in the schema (§8).** The schema section as originally drafted still carried pre-decision enum values and defaults; these are corrected to match D1/D2/D3/D5 and are the source of truth for the first migration:
- `occurrence_status` → `pending, due, overdue, completed, completed_late, failed, skipped, cancelled` (was `scheduled…void`).
- `exception_status` → `open, acknowledged, in_progress, resolved, verified, reopened` (was `open, in_progress, resolved, verified, void`).
- `corrective_status` → `open, assigned, done, verified, rejected` (was `open, in_progress, done, verified, overdue`).
- `organizations.retention_days` DEFAULT `1095` (was `1825`).
- `scheduled_tasks.grace_minutes` DEFAULT `15` (was `0`).
- `task_occurrences.status` DEFAULT `pending` (was `scheduled`); overdue-sweep partial index predicate uses `status IN ('pending','due')`.

### D13 — Development environment & security posture (max dev velocity, tight security by construction)
**Decision date: 2026-07-01.**

Optimize for developer velocity *without* loosening the security architecture. The two are separated cleanly: the security *spine* is always on (even in dev); dev *conveniences* sit on top, hard-gated, and never ship.

- **Dev database:** local **PostgreSQL 16 in Docker** — most performant for dev (no network latency, full superuser for RLS/trigger testing), free, and zero credential-blocking. `DATABASE_URL` env points at **Neon EU** for staging/prod. Identical Prisma schema + migrations + RLS policies across all environments — no app-code divergence.
- **Full seed (never blocked on data):** a seed script populates a realistic demo org across **every entity and all canonical roles** — properties, outlets, users, memberships, templates (DE/NL HACCP), scheduled tasks, materialized occurrences (past/due/overdue/done/failed), completions with evidence, exceptions + corrective actions, and a populated activity timeline — so every screen renders real data on first run.
- **Dev conveniences — DEV-ONLY, hard-gated (a startup assertion throws if any is enabled while `NODE_ENV=production`):** one-click "log in / impersonate any role"; GraphQL **introspection + playground on in dev, off in prod** (F7); relaxed rate limits in dev; Prisma Studio. Each is guarded and commented; none is reachable in prod.
- **Security spine is always on (dev included):** RLS + FORCE, transaction-local `app.current_org_id` (D6), append-only `activity_log` + trigger (F4), tenant/property scoping, Zod validation, GraphQL depth/complexity limits (F7). Dev shortcuts never replace these — they layer on top.
- **Running security-hardening checklist (`SECURITY.md`):** every dev shortcut and every prod-only tightening (introspection off, production rate limits, secrets management, CSP/headers, upload content-scanning, signed-URL TTLs, DSAR/retention jobs) is tracked as we go and **finalized before pilot**. "Highlight while developing, finalize before go-live."

## What to build first (the spine that must exist before any feature)
1. **Auth + Organization/Membership** (Better Auth) with org context resolved into every request.
2. **The tenant-scoping + RLS transaction wrapper (D6)** and its cross-tenant leak test — the gate for all data work.
3. **The append-only `activity_log`** (Postgres trigger-enforced) + the immutable/versioned completion pattern.

Templates, schedules, the Today dashboard, evidence, exceptions, and export all layer on top of these three. See **§20** for the full 9-milestone roadmap and **§23** for the ordered first-10 engineering tasks.

---

# Shift Ledger — MVP Software Architecture

_Founding-CTO architecture design. This is a design document, not code. Compliance stance: Shift Ledger is an operational-proof & documentation tool, not a legal-compliance certification service._

## Executive summary

Shift Ledger is a fast, opinionated daily command center for hotel kitchens — the "Linear of kitchen operations" — built to answer one question: *what must happen today, what was missed, and can I prove it?* It turns HACCP-style food-safety rituals (fridge temps, cleaning, allergen segregation, opening/closing sign-offs) into timestamped, attributable, tamper-evident evidence, with failed checks auto-spawning exceptions and corrective actions, and a one-click inspection-ready audit pack as the payoff. It is deliberately *not* an ERP/inventory/POS/PMS/recipe/scheduling platform, and it never claims legal certification — only documentation and operational proof, EU-resident and GDPR-aware for its Germany/Netherlands launch.

The recommended architecture is deliberately boring so one strong full-stack engineer can build and operate it: a single Next.js 15 (App Router, TypeScript) monolith on Vercel, with tenant-scoped Prisma reads from Server Components and typed Server Actions for writes, over PostgreSQL on Neon (EU). A thin REST surface exists only for uploads, export downloads, and cron/webhooks. It *feels fast* because reads ship minimal client JS, the Today dashboard is a cheap indexed read over pre-materialized occurrences (never a runtime recurrence computation), and completions use optimistic UI with direct-to-R2 photo uploads. It *is trustworthy* because multi-tenancy is enforced twice (application scoping plus Postgres RLS keyed on `organization_id`), and the compliance core is immutable by construction: completions and evidence never mutate, edits write new versions, and an append-only, optionally hash-chained `activity_log` (trigger + RLS enforced) is the tamper-evident spine an inspector can rely on. Inngest runs occurrence generation, overdue sweeps, notifications, and async @react-pdf/renderer exports; DST-safe due times are computed in each property's IANA timezone and stored UTC.

## Architecture at a glance

| Concern | Choice |
|---|---|
| App shape | Single Next.js 15 (App Router) TypeScript monolith on Vercel — no separate backend, no microservices |
| Language | TypeScript end-to-end |
| Data access | RSC → Prisma directly (initial page render); Client components → TanStack Query → GraphQL (live updates); Writes → Server Actions |
| API style | **GraphQL** (`/api/graphql` via graphql-yoga + Pothos) for all client reads; **Server Actions** for all writes; thin REST for uploads/exports/cron/webhooks only; no tRPC |
| Database | PostgreSQL on Neon (EU region) |
| ORM | Prisma |
| IDs | UUID v7 (time-sortable, db-generated) |
| Tenancy | Shared DB / shared schema; `organization_id` denormalized on every tenant table; app scoping + Postgres RLS (`app.current_org_id`); every composite index leads with `organization_id`; property/outlet scoping layered on top |
| Auth | Better Auth (self-hosted; org/membership/invitation/role primitives; Prisma+Postgres); Auth.js v5 fallback |
| File storage | Cloudflare R2 (S3-compatible, EU, zero egress); presigned PUT/GET, org-prefixed keys, never served from app |
| Jobs/scheduler | Inngest (durable, retriable, cron + event fan-out) for generation, overdue sweep, notifications, exports |
| Recurrence strategy | Typed recurrence object; occurrences materialized ~3-day rolling window by daily job; idempotent via `UNIQUE(scheduled_task_id, occurrence_local_date)`; ~10-min overdue sweep; DST-safe local→UTC |
| Audit/immutability | Append-only `activity_log` (RLS + Postgres trigger, no UPDATE/DELETE); immutable versioned TaskCompletion/Evidence; optional per-org hash chain |
| PDF export | Async ExportJob (queued→processing→completed→failed) via @react-pdf/renderer; stored in R2; short-lived signed GET |
| Notifications | In-app `notification` table first; digest/batched; WhatsApp/SMS deferred |
| Email | Resend (EU), digest/batched |
| Hosting | Vercel (EU function region) + Neon (EU) + Cloudflare R2 (EU) + Inngest + Upstash Redis (rate limiting) |
| Monitoring | Sentry (errors) + pino structured logs + Vercel logs/analytics |
| Region/compliance stance | EU data residency (Neon EU + R2 EU); GDPR-aware, DPA-ready; documentation/operational-proof tool, NOT legal certification |

## Consistency & open flags

No material contradictions found across the ten sections — the architectural spine is honored consistently (tenancy, immutability, recurrence, R2, Inngest, Better Auth, @react-pdf all align). The following are genuine inconsistencies and open decisions the CTO should resolve before build:

- **`occurrence_status` enum drift — resolve to one canonical set.** Section 4 uses `pending | due | overdue | completed | failed | skipped`; Section 7 adds `completed_late` and `cancelled` (and uses `void`-less naming); Section 8's Postgres enum is `scheduled | due | overdue | completed | failed | skipped | void`; Section 9 uses `scheduled | due | overdue | completed | failed | skipped | cancelled`. These are four different state sets for the single most important table. Pick one (recommend Section 7/9's superset with `scheduled`, `completed_late`, `cancelled`) and propagate it to the schema, state machine, and API before writing the migration.
- **`exception_status` and `corrective_status` also diverge across sections.** Section 7 models a rich Exception lifecycle (`open → acknowledged → in_progress → resolved → verified → reopened`) and CorrectiveAction (`open → assigned → done → verified → rejected`), while Sections 4/8/11 use shorter sets (`open | in_progress | resolved | verified | void`, and `open | done | verified` / `open | in_progress | done | verified | overdue`). Decide whether the MVP ships the full state machines or the condensed ones; the harness test in Section 19 and the API in Section 11 must match whatever is chosen.
- **`grace_minutes` default is contradictory.** Section 8 says `DEFAULT 0`, Section 9 says `default 30`, Section 4 says "0–15 per template." Pick one default (recommend a nonzero value like 15 so the overdue sweep does not fire the instant `due_at` passes) and state it once.
- **Evidence↔Attachment rule for `signature` conflicts.** Section 4 says binary types `photo | file | signature` MUST reference an Attachment; Section 10/11 treat signature/initials as *optionally* attached (typed initials need no binary, a drawn signature does). Clarify the CHECK constraint: it should key off drawn-vs-typed, not the `signature` type alone, or the constraint in Section 4 will reject valid typed sign-offs.
- **`edit completed tasks` scope needs a single owner list.** Section 6's matrix allows PropertyManager/KitchenManager (scoped) plus Owner/OrgAdmin to create correction versions; confirm this is intended (KitchenManager can correct a completion) and that it matches the Server Action guard, since Section 10 phrases it slightly more narrowly.
- **RLS session-var mechanics under Neon connection pooling is the top build risk, not a contradiction — but unresolved in detail.** Every section assumes `app.current_org_id` is reliably set per transaction; ADR-c flags this as Prisma's known friction point. Decide the concrete pattern (transaction-scoped `SET LOCAL` via a Prisma extension/`$transaction` wrapper) and prove it with the cross-tenant test in Milestone 1 before any feature work, because a pooled-connection leak here defeats the entire tenancy model.

Open product questions (not architectural): (1) confirmed DE/NL legal retention duration — Section 4 defaults 24 months, Section 8 defaults 1825 days (5y), Section 10 recommends a 3-year floor; these three defaults disagree and need a chef/legal-validated number. (2) Shared-tablet actor identity (PIN/initials step) — flagged in Section 22 but not yet in the schema or completion flow. (3) Offline/dead-zone submit-queue scope — Section 22's lightweight client queue is not reflected in Sections 5, 8, or 12 and should be explicitly in or out for MVP.

---

# 1. Product interpretation

## The core user problem

A hotel kitchen runs on a set of daily, legally-freighted rituals: check the walk-in fridge is cold enough, verify the fryer oil, confirm the line was cleaned down, sign off the opening and closing, log the delivery temperatures, prove the allergen prep was segregated. Today these live on clipboards, laminated sheets, WhatsApp photos, and the memory of whoever was on shift. When the food-safety authority (in Germany: the Lebensmittelüberwachung; in the Netherlands: the NVWA) walks in, or when something goes wrong and liability is on the line, the manager cannot answer three questions quickly and truthfully:

1. **What must happen today?** (across every fridge, every station, every outlet in the property)
2. **What was missed?** (which checks are overdue, which failed, what wasn't done and by whom)
3. **Can I prove it happened?** (with a timestamped, attributable, tamper-evident record — a photo, a temperature, a signature — not a paper sheet that could have been filled in retroactively)

Paper and chat apps answer none of these. Paper is not searchable, not attributable, trivially back-dated, and lost the moment a binder walks off. WhatsApp has no schedule, no pass/fail semantics, no export, no audit trail. The problem is **not "we need more checklists" — it is "we cannot prove, on demand, that the right checks happened at the right time, and we cannot see in real time what's slipping."**

## The primary daily workflow — a manager's morning

It is 06:45. The Kitchen Manager opens Shift Ledger on their phone before they've taken their coat off.

1. The **Today dashboard** is already scoped to their outlet(s). It shows a single prioritized list: what is due this morning, what is already overdue from the earlier shift, what failed overnight.
2. They see "Walk-in fridge temp — due 08:00" not yet done, and one red item: "Closing clean-down — line 2 — MISSED" from last night. That missed item is the first thing they act on: assign a corrective action, or record why it's acceptable.
3. Staff arriving for the breakfast shift open the app on the shared tablet or their own phone, see the checks assigned to their role, and knock them out — tap the fridge task, enter `3°C`, snap a photo, initial, submit. Under ten seconds. The task goes green.
4. A fridge reads `7°C`. The manager doesn't have to remember what to do — submitting a failing value **automatically raises an Exception** and prompts a corrective action ("moved product to backup unit, called technician, re-checked at 09:30").
5. By mid-morning the manager glances once more: everything due is green or has a logged exception with an owner. The day is provably under control.

The entire loop is measured in taps, not screens. Every daily action is designed to complete in under 10 seconds; every critical workflow (complete a check, raise an exception, export a pack) in one to two clicks.

## What makes this different from generic checklist software

Generic checklist apps (and the "build-your-own-form" tools kitchens get talked into) treat a check as a box that gets ticked. Shift Ledger is not a checklist tool with a kitchen skin. The differences are structural and deliberate:

- **Evidence and proof are first-class, not attachments.** A completion is not "ticked" — it captures an actor, a device, a UTC timestamp, and typed evidence (a measured temperature, a photo, initials/signature). Proof is the product.
- **HACCP semantics are built in, not configured.** A task has a *check type* (temperature, cleaning, allergen, opening, closing) and a *threshold* (fridge ≤ 4°C). The system knows `7°C` is a **fail** — it doesn't just store a number, it evaluates it, and a fail deterministically creates an Exception → CorrectiveAction chain. Generic tools have no concept of pass/fail against a target, or of what a failure obligates you to do next.
- **Immutability and tamper-evidence.** Completions and Evidence are immutable; an "edit" writes a new version plus an append-only ActivityLog entry with before/after, reason, and actor (optionally hash-chained per org). A clipboard — and most SaaS checklists with editable records — cannot prove a value wasn't changed after the fact. An inspector-grade record can.
- **Opinionated, curated templates — not a form builder.** We ship HACCP starter packs for DE and NL. Customers clone and tune thresholds; they do not design forms from a blank canvas. Opinion is a feature: it makes onboarding fast and keeps every kitchen's data comparable and exportable.
- **Time and recurrence are real.** Occurrences are materialized ahead per outlet in the property's own timezone (DST-safe), with genuine *overdue* detection. A generic checklist has no notion of "due at 08:00 local, now overdue, notify the shift leader."
- **Speed as a design constraint.** Sub-10-second actions and 1–2-click workflows are a hard requirement, because frontline kitchen staff will abandon anything slower. Compliance that is annoying does not get done, and undone compliance is the whole problem.
- **The export pack is the payoff.** One action produces an inspection-ready PDF/CSV audit pack. That artifact — not the checklist UI — is what a GM or inspector ultimately cares about.

## What must stay out of scope (and stay there)

Shift Ledger answers one question — *what must happen today, what was missed, can I prove it?* — and refuses to become a hotel operations suite. It is **not** an ERP, inventory or procurement system, POS, PMS, recipe manager, allergen database, payroll or staff-scheduling tool, food-waste analytics engine, or a generic checklist/form builder. It also carries a firm compliance stance: it is a **documentation and operational-proof tool, not legal compliance certification.** We help kitchens produce and keep the evidence; we never claim to certify that they are legally compliant. Adjacent modules are where focused products go to die; the discipline of this MVP is saying no.

# 2. MVP scope

| Capability | Must-have | Should-have | Later | Non-goal / Refuse |
|---|---|---|---|---|
| **Organizations** | Create org; org is the tenant root; org_id on every record; RLS session var | — | Org-level billing plans | Consumer/personal accounts |
| **Properties / Sites** | CRUD; each property carries an IANA timezone | Property-level notes/contact | Geo/map view of properties | Full property/facility management |
| **Outlets (Kitchens)** | CRUD under a property; tasks scope to outlet | Outlet type tags (main, banquet, bar) | Outlet floor plans | Table/section management (that's POS/PMS) |
| **Users & roles** | Better Auth; Membership carries org Role; roles Owner/OrgAdmin/PropertyManager/KitchenManager/ShiftLeader/Staff/Auditor; property-scoped membership | Property-scoped role restriction UX | ExternalInspector role; SSO/SAML | Payroll, HR records, staff scheduling/rostering |
| **Invitations** | Invite by email → pending Membership; accept flow | Resend/expire invite; bulk invite | Self-serve join via domain | Public open signup to a tenant |
| **Task templates** | Curated TemplateLibrary (DE/NL HACCP starter packs); clone to org; check type + required evidence types + threshold config + instructions | Duplicate/edit org templates; enable/disable | Org-authored templates from scratch (still not a form builder) | **Custom-forms/workflow-builder engine** |
| **Recurring scheduled tasks** | ScheduledTask = template + outlet + typed Recurrence (daily/weekly/monthly, interval, byWeekday, byMonthDay, timeOfDay, tz) + role/user assignment | Pause/resume; end date | Complex conditional recurrence | Cron-expression free-text; arbitrary rules engine |
| **Occurrence generation** | Inngest daily job materializes ~3-day rolling window; idempotent UNIQUE(scheduled_task_id, occurrence_local_date); DST-safe UTC due_at | Backfill on new ScheduledTask | Configurable window length | Real-time per-request generation |
| **Today dashboard** | Outlet-scoped prioritized list: due / overdue / failed; 1-tap into a task | Multi-outlet toggle; date navigator | Saved custom views | Generic BI dashboard builder |
| **Task completion** | Complete occurrence; enter typed values; pass/fail auto-evaluated vs threshold; actor + UTC time + device metadata; immutable + versioned edits | Optimistic UI; quick-complete for no-evidence checks | Bulk complete | Editable-in-place records (breaks immutability) |
| **Evidence upload** | Types: note, photo, temperature, checkbox, initials/signature, file; R2 presigned PUT; short-lived signed GET | Client-side image compression; multi-photo | Barcode/label scan | Sensor/IoT temperature ingestion; live monitoring |
| **Failed check / Exception** | Failing completion auto-creates Exception (1..* per occurrence); status lifecycle | Manual exception raise | Exception categorization/tagging | Predictive/AI failure detection |
| **Corrective action** | Exception 1..* CorrectiveAction with assignee, due, verification; close-out | Reminders on overdue CAPA; templated CA suggestions (static) | CA effectiveness trends | AI-recommended corrective actions |
| **Activity timeline** | Append-only ActivityLog; polymorphic subject; every transition + edit (before/after, reason, actor) | Per-org hash chain (prev_hash) | Filter/search timeline | Mutable audit history |
| **Audit / export pack** | Async ExportJob (queued→processing→completed→failed); @react-pdf/renderer PDF + CSV; R2 + short-lived signed URL; filters/metadata captured as AuditPack | Date-range/outlet/check-type filters; scheduled recurring export | Branded/white-label packs | Legal compliance certification claims |
| **Notifications / reminders** | In-app notification table; overdue sweep (~10 min) emits; email via Resend; digest/batching | Per-event routing to role | NotificationPreference per user | WhatsApp/SMS (later); push spam |
| **Comments** | Polymorphic on Exception / CorrectiveAction / TaskOccurrence | @mention a member | Rich text/attachments in comments | Full chat/messaging platform |
| **Auth/session** | Better Auth sessions/accounts; org switching | Passwordless email | SSO/SAML; 2FA policy | Building our own auth from scratch |
| **Compliance/GDPR** | EU residency (Neon EU + R2 EU); retention policy; data-subject export/delete hooks; DPA-ready | Configurable retention window | Automated DSAR portal | Legal certification / "HACCP certified" claims |

**We refuse to build even if a paying pilot asks (and why):**

- **ERP** — accounting/GL/asset management is a different product with a different buyer; it would consume the entire roadmap and we would still lose to real ERPs.
- **Inventory** — stock counts, par levels, and lot tracking are a deep, integration-heavy domain that pulls us into procurement and waste; it destroys the "one question a day" focus.
- **Procurement** — supplier catalogs, POs, and invoicing are a full marketplace/finance problem, not daily operational proof.
- **POS integrations** — sales/order data belongs to the till; integrating it invites endless vendor-specific work and adds nothing to "can I prove the checks happened?"
- **PMS integrations** — room/reservation systems are a hotel-wide concern; coupling to them makes us an integration shop, not a product.
- **Recipe management** — recipes, costing, and nutrition are a separate content product; allergen *verification* stays, allergen *databases* do not.
- **Custom-forms / workflow-builder engine** — the moment we ship a blank-canvas builder we become Jotform-for-kitchens: onboarding slows, data stops being comparable, and every customer needs bespoke support. Opinionated templates are the moat.
- **AI** — no AI in MVP. Auto-classification, predictive failures, and generated corrective actions add nondeterminism to a system whose entire value is deterministic, defensible proof. It also complicates the GDPR/EU story for zero MVP benefit.
- **Offline-first sync** — conflict resolution over immutable compliance records is a research project. Kitchens have Wi-Fi; we optimize for fast online with graceful failure, not CRDT sync.

# 3. Core user journeys

## Journey A — Manager creates a recurring daily task

**Actor:** Kitchen Manager (or PropertyManager) — a role with template/scheduling rights.

**Steps:**
1. From the outlet, choose "Add scheduled check."
2. Pick a TaskTemplate from the org library (e.g. "Walk-in fridge temperature" — check type `temperature`, required evidence `temperature`+`photo`, threshold `≤ 4°C`).
3. Set recurrence: frequency `daily`, interval `1`, time-of-day `08:00`. Timezone is inherited from the property (e.g. `Europe/Berlin`).
4. Set assignment: role `Staff` (or a specific user) at this outlet.
5. Review the plain-language summary ("Every day at 08:00, Europe/Berlin — assigned to Staff") and save.

**System behavior:** Creates one ScheduledTask (org/property/outlet-scoped) with a typed Recurrence. The next daily Inngest generation run materializes TaskOccurrences for the rolling ~3-day window, computing the local `08:00` wall-clock time in `Europe/Berlin` and converting to UTC `due_at` (DST-safe). Occurrence creation is idempotent via `UNIQUE(scheduled_task_id, occurrence_local_date)`. An ActivityLog entry records the creation.

**Edge cases:** DST transition day — due time is computed against local wall clock, not fixed UTC offset. `byMonthDay: 31` in a short month — clamp to last valid day (documented rule). Editing recurrence later regenerates only future, not-yet-completed occurrences; completed/past occurrences are untouched (immutability). Assigning to a role with no members at that outlet — allowed, but surfaced as a warning.

**Data created:** ScheduledTask (+ embedded Recurrence), future TaskOccurrence rows on next generation, ActivityLog entry.

**Success criteria:** A correctly-timed occurrence appears on the Today dashboard on the right local date at 08:00 property time; the whole setup takes well under a minute and no free-text form-building was required.

## Journey B — Staff completes a task

**Actor:** Staff (or ShiftLeader) assigned at the outlet.

**Steps:**
1. Open Today dashboard (already outlet-scoped); tap the due "Walk-in fridge temperature" task.
2. Enter measured temperature (e.g. `3°C`).
3. Capture the required photo (camera → upload).
4. Add initials/signature; optional note.
5. Tap Submit.

**System behavior:** Client requests a presigned R2 PUT URL (POST `/api/uploads`) and uploads the photo directly to R2 (EU). A Server Action creates an immutable TaskCompletion (actor, UTC timestamp, device metadata, entered value) and its Evidence rows (temperature, photo→Attachment, initials). Pass/fail is auto-evaluated against the template threshold; `3°C ≤ 4°C` → **pass**. Occurrence status → `completed`; UI updates optimistically to green. ActivityLog records the completion.

**Edge cases:** Photo upload fails/no signal — completion is blocked if the evidence is required; the entered value is preserved for retry (no silent data loss). Duplicate submit — idempotent; the occurrence already has its 0..1 completion. Completing an already-overdue occurrence — allowed and recorded, but the timeline preserves the overdue transition. Correcting a mistyped value after submit — never mutates the record; writes a new TaskCompletion version + ActivityLog before/after/reason.

**Data created:** TaskCompletion (v1, immutable), Evidence rows, Attachment (R2 object), ActivityLog entry, possible Notification (completion of a monitored check).

**Success criteria:** From tap to green in under 10 seconds for the common path; evidence is durably stored in EU R2 and attributable to the actor.

## Journey C — Failed check creates an exception

**Actor:** Staff completing the check; Exception then owned by ShiftLeader/KitchenManager.

**Steps:**
1. Staff completes the fridge check but enters `7°C`.
2. Submit; system flags a fail and immediately prompts: "This is above the 4°C target — what did you do?"
3. Staff/manager records a CorrectiveAction inline (e.g. "moved product to backup fridge, called service, will re-check at 09:30"), assignee, and a due time.
4. Submit.

**System behavior:** TaskCompletion is stored (immutable, pass/fail = **fail**). A fail deterministically creates an Exception (1..* per occurrence) linked to the occurrence/completion; occurrence status reflects the failure. The inline corrective step creates a CorrectiveAction with assignee, due, and pending verification. Notifications fire to the KitchenManager (in-app + email digest). ActivityLog records completion, exception open, and CA creation.

**Edge cases:** Re-check at 09:30 is a *new* occurrence/completion or an explicit verification event on the CorrectiveAction — the original `7°C` record is never overwritten. Multiple failures in one day produce multiple Exceptions unless the manager links them. Fail with missing required evidence — still records the fail (safety over completeness) and flags the missing evidence. Exception left open past CA due — surfaces on dashboard and triggers reminder.

**Data created:** TaskCompletion (fail), Exception, CorrectiveAction, ActivityLog entries, Notification(s).

**Success criteria:** A failing value cannot be silently closed; every fail is bound to an exception and an owner, and the corrective step is captured in one to two additional taps.

## Journey D — Manager reviews open exceptions

**Actor:** KitchenManager / PropertyManager.

**Steps:**
1. Open the Exceptions view (dashboard filter or dedicated list), scoped to their outlet(s)/property.
2. See open exceptions sorted by severity/age, each with its check, value, and CorrectiveAction status.
3. Open one; read the timeline (completion → exception → CA), add a Comment, reassign or set a new due if needed.
4. When the corrective action is verified, mark it verified → exception moves to resolved.

**System behavior:** Server Components issue tenant-scoped Prisma reads (org_id-leading composite indexes; property/outlet filters). Resolving requires a verification record; the Exception transitions `open → resolved` only via a logged action. Comments are polymorphic on the Exception/CA. Every transition writes an ActivityLog entry.

**Edge cases:** Two managers act on the same exception concurrently — last write wins on mutable status fields, but all transitions are individually logged (no lost history). An exception whose underlying occurrence is very old — still resolvable; ActivityLog preserves original timing. Auditor role can view but cannot resolve.

**Data created:** ActivityLog entries (reassign, comment, verify, resolve), Comment rows, CorrectiveAction verification, Notification on reassignment.

**Success criteria:** A manager can go from "how many problems are open?" to "this one is now owned/resolved" without leaving the exception, and every step is attributable in the timeline.

## Journey E — Inspector arrives, manager exports an audit pack

**Actor:** KitchenManager / PropertyManager (Auditor may also trigger a read-only export).

**Steps:**
1. From Exports, choose "Create audit pack."
2. Set filters: property/outlet(s), date range (e.g. last 30 days), optionally check types (temperature, cleaning) and only-failures.
3. Choose format (PDF for the inspector, CSV for records) and submit.
4. Wait a few seconds; when ready, download via the provided link (or hand the tablet to the inspector).

**System behavior:** A Server Action creates an ExportJob (`queued`); Inngest processes it (`processing`), rendering a deterministic tabular pack with `@react-pdf/renderer` — occurrences, completions, entered values, pass/fail, evidence thumbnails/references, exceptions, corrective actions, and the immutable timeline (optionally hash-chain attestation). Output is written to R2 (EU) as an AuditPack (file + the exact filters/metadata used); status → `completed`. Download is served only via a short-lived presigned GET (GET `/api/exports/:id/download`) — never directly from the app. The pack carries the standing disclaimer: **documentation/operational proof, not legal certification.**

**Edge cases:** Large range → many pages; job retries on transient failure and can page/paginate output. Zero matching records — produces a valid pack stating "no records for filters" (proof of absence is itself useful). Expired download link — re-issue a new signed GET without regenerating. Evidence photo missing in R2 — pack notes the reference and flags the gap rather than failing silently.

**Data created:** ExportJob, AuditPack (R2 object + filter metadata), ActivityLog entry (who exported what, when, with which filters).

**Success criteria:** In one to two clicks the manager produces an inspection-ready, tamper-evident, EU-resident pack that reflects exactly the filtered scope; who exported what is itself audited.

## Journey F — Multi-property manager reviews compliance health across sites

**Actor:** Multi-property Ops Manager (OrgAdmin/PropertyManager across sites; often viewer/admin) or GM/Owner (viewer).

**Steps:**
1. Open the org/portfolio view (all properties in the org, or the subset their membership scopes them to).
2. Scan a per-property health summary: completion rate, overdue count, open exceptions, unresolved corrective actions (today / this week).
3. Drill into a red property → its outlets → the specific overdue/failed occurrences.
4. Optionally trigger a portfolio export or ping the responsible PropertyManager (comment/notification).

**Steps' System behavior:** Reads are org-scoped and further limited by property-scoped Membership; RLS enforces the org boundary as defense-in-depth. Health metrics are aggregates over TaskOccurrence status and Exception/CorrectiveAction state for the period. No new compliance records are created by viewing; drilling down reuses the same outlet-scoped views as Journeys B–D.

**Edge cases:** A property in a different timezone — "today" is evaluated per property's local date, not the viewer's. Manager scoped to only some properties sees only those (RLS + app scoping). Very large portfolios — aggregates are read-optimized (org_id-leading indexes) and paginated by property. Viewer-only roles (GM/Owner, Auditor) can see health but cannot act.

**Data created:** None by default (read-only); optional Notification/Comment if the manager nudges a site; ActivityLog entry if a portfolio export is triggered.

**Success criteria:** In one screen the ops manager can rank properties by compliance health for the period and reach any failing check in two to three clicks, with strict respect for their property scope and each site's local time.

---

# 4. Domain model

This section specifies every canonical entity in Shift Ledger. All tenant-scoped entities carry a denormalized `organization_id` (per spine item 5), a `created_at`/`updated_at` pair, and a db-generated UUID v7 primary key (`id`) unless stated otherwise. To avoid repetition, those three facts are assumed everywhere and only called out where they matter (e.g. composite index ordering, immutability). "Tenant-scoped" below means the table participates in RLS via `app.current_org_id`.

## Organization

**Purpose.** The top-level tenant boundary and billing/ownership unit. Every other tenant-scoped row descends from exactly one Organization; `organization_id` is the partition key for the entire system.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK. Also the RLS partition key value. |
| name | text | Display name (e.g. "Kastell Hotels GmbH"). |
| slug | text | URL-safe, globally unique. |
| default_locale | text | BCP-47 (e.g. `de-DE`, `nl-NL`, `en`). Fallback for users without a locale. |
| billing_status | enum | `trial \| active \| past_due \| suspended`. |
| retention_policy_months | int | GDPR retention window for evidence/logs; default 24. |
| created_at / updated_at | timestamptz | — |

**Relationships.** 1—* Property; 1—* Membership; 1—* TaskTemplate; 1—* Notification; owns (transitively) every tenant-scoped row via `organization_id`.

**Lifecycle.** `trial` → `active` → (`past_due` → `suspended`) → soft-deleted (never hard-deleted while audit records exist within the retention window). Suspension blocks writes but preserves read/export for audit continuity.

**Important constraints.** `slug` globally unique. Cannot be hard-deleted while `activity_log` or `task_completion` rows exist inside `retention_policy_months`. This is the one table where `id` is itself the tenant key, so it is exempt from the "org_id column" rule (its own `id` *is* the org id).

## Property (Site)

**Purpose.** A physical hotel/site within an Organization. **Owns the IANA timezone** that drives all recurrence and due-time math (spine item 8). Second-level isolation boundary beneath the org.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | FK → Organization. Denormalized tenant key. |
| name | text | e.g. "Kastell Amsterdam". |
| timezone | text | **IANA tz** (e.g. `Europe/Amsterdam`). Authoritative source for wall-clock → UTC conversion. |
| address | jsonb | Free-form postal address; not indexed. |
| locale_override | text | Optional; else inherits `Organization.default_locale`. |
| archived_at | timestamptz? | Soft-archive; hides from Today without deleting history. |

**Relationships.** * Property belongs to 1 Organization; Property 1—* Outlet; Membership may be scoped to specific Properties.

**Lifecycle.** active → archived (`archived_at` set). Archiving stops new occurrence generation for its outlets but retains all history and exports.

**Important constraints.** `UNIQUE(organization_id, name)`. `timezone` must be a valid IANA name (validated in app; DB stores text). Changing `timezone` affects only *future* occurrence generation — already-materialized `due_at` values (stored UTC) are never retroactively rewritten.

## Outlet (Kitchen)

**Purpose.** A specific kitchen/production point within a Property (e.g. "Main Kitchen", "Banquet", "Rooftop Bar Pantry"). The unit that ScheduledTasks are attached to.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Denormalized tenant key. |
| property_id | uuid | FK → Property. |
| name | text | e.g. "Main Kitchen". |
| type | enum | `main \| prep \| pastry \| banquet \| bar_pantry \| cold_store \| generic`. |
| archived_at | timestamptz? | Soft-archive. |

**Relationships.** * Outlet belongs to 1 Property (and, denormalized, 1 Organization); Outlet 1—* ScheduledTask; referenced (denormalized) by TaskOccurrence.

**Lifecycle.** active → archived. Archiving halts future occurrence generation for its scheduled tasks.

**Important constraints.** `UNIQUE(property_id, name)`. Outlet inherits timezone from its Property — outlets never carry their own tz.

## User

**Purpose.** A human principal (Better Auth identity). Global across organizations; org access is expressed only through Membership. **Not tenant-scoped** (a user may belong to many orgs), so it does not carry `organization_id`.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK. Managed by Better Auth. |
| email | text | Globally unique; login identifier. |
| name | text | Display name. |
| locale | text? | BCP-47 user preference; overrides org locale in UI. |
| default_organization_id | uuid? | Last-used org for post-login routing. |
| created_at | timestamptz | — |

**Relationships.** User *—* Organization via Membership; User 1—* Session/Account (Better Auth); User referenced as actor on TaskCompletion, Exception, CorrectiveAction, ActivityLog; recipient of Notification.

**Lifecycle.** invited (via Invitation) → active → deactivated (per-membership, not global). A User is never deleted while they are the actor on immutable audit rows; GDPR erasure pseudonymizes the User (see Section on retention) rather than deleting audit references.

**Important constraints.** `email` globally unique. User rows sit outside RLS org-scoping; access control to org data is always mediated by Membership.

## Membership / Role

**Purpose.** The join between User and Organization that carries the org-level Role and optional property scoping. This is the single source of truth for "can this user see/do X in this org".

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| user_id | uuid | FK → User. |
| role | enum | `Owner \| OrgAdmin \| PropertyManager \| KitchenManager \| ShiftLeader \| Staff \| Auditor` (future `ExternalInspector`). |
| scoped_property_ids | uuid[] | Empty = all properties in org; non-empty = restricted to those properties. |
| status | enum | `active \| deactivated`. |
| invited_by | uuid? | Actor who created the originating Invitation. |

**Relationships.** * Membership belongs to 1 Organization and 1 User. `scoped_property_ids` references Property. Originates from an Invitation.

**Lifecycle.** created (accepted Invitation) → active → deactivated. Deactivation revokes access immediately but preserves the row (audit needs to resolve historical actors).

**Important constraints.** `UNIQUE(organization_id, user_id)` — one membership per user per org. At least one `Owner` must exist per org (last-owner-demotion is refused). `Auditor` is read-only at the application layer regardless of scoping. Property scoping is *additive-restrictive*: it narrows, never widens, org access.

## Invitation

**Purpose.** A pending Membership addressed to an email that may not yet correspond to a User. Converts to a Membership on acceptance.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| email | text | Invitee email. |
| role | enum | Role to grant on acceptance. |
| scoped_property_ids | uuid[] | Pre-set scoping for the resulting Membership. |
| token_hash | text | Hash of the single-use invite token (never store raw token). |
| status | enum | `pending \| accepted \| revoked \| expired`. |
| expires_at | timestamptz | Default 7 days. |

**Relationships.** * Invitation belongs to 1 Organization; on acceptance produces 1 Membership. Managed via Better Auth invitation primitives.

**Lifecycle.** `pending` → `accepted` (creates Membership) | `revoked` | `expired`.

**Important constraints.** `UNIQUE(organization_id, email)` among `pending` invitations (no duplicate live invites). Token is single-use; only the hash is persisted. Accepting an invite for an email that already has a Membership in the org is a no-op/merge, never a duplicate.

## TemplateLibrary

**Purpose.** Curated **global** starter templates (HACCP starter packs for DE/NL) maintained by Shift Ledger, not by tenants. A source to *clone from* into an Organization's own TaskTemplates. Global — **not** tenant-scoped, read-only to tenants.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| key | text | Stable slug, e.g. `haccp-de-fridge-temp-daily`. |
| locale | text | `de-DE`, `nl-NL`, etc. |
| check_type | enum | Same enum as TaskTemplate (temperature/cleaning/allergen/opening/closing/generic). |
| default_config | jsonb | Suggested thresholds, required evidence, instructions. |
| region | enum | `DE \| NL \| EU \| GENERIC`. |
| version | int | Bumped when curators revise a pack. |

**Relationships.** TemplateLibrary 1—* (clones) TaskTemplate. No FK from TaskTemplate back to library at runtime beyond an optional `source_key`/`source_version` for provenance.

**Lifecycle.** draft → published → deprecated (kept for provenance; deprecation never mutates already-cloned tenant templates).

**Important constraints.** No `organization_id` (global). Read-only from any tenant context; RLS does not apply. Cloning **copies** config — later library edits do not retro-modify tenant templates.

## TaskTemplate

**Purpose.** An org-owned definition of a check: its type, required evidence, thresholds, and instructions. The reusable "what" that gets scheduled onto outlets.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| name | text | e.g. "Walk-in fridge temperature". |
| check_type | enum | `temperature \| cleaning \| allergen \| opening \| closing \| generic`. |
| required_evidence | jsonb | Ordered list of required Evidence types (e.g. `[temperature, photo]`). |
| threshold_config | jsonb | Typed pass/fail rule, e.g. `{op:"lte", value:4, unit:"C"}` for fridge ≤ 4 °C. |
| instructions | text | Shown to staff at completion time. |
| source_key / source_version | text? / int? | Provenance if cloned from TemplateLibrary. |
| archived_at | timestamptz? | Soft-archive. |

**Relationships.** * TaskTemplate belongs to 1 Organization; TaskTemplate 1—* ScheduledTask; optionally cloned from TemplateLibrary.

**Lifecycle.** active → archived. Editing a template affects only *future* occurrences; already-materialized occurrences snapshot the config they were generated with (see TaskOccurrence).

**Important constraints.** `threshold_config` shape validated by Zod per `check_type` (temperature requires numeric op/value/unit; cleaning/opening/closing are typically pass/fail with checkbox/photo evidence). `UNIQUE(organization_id, name)`.

## ScheduledTask

**Purpose.** A TaskTemplate applied to a specific Outlet with a typed Recurrence, a time-of-day, and an assignment (role OR specific user). The recurring "when + where + who".

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| property_id | uuid | Denormalized from outlet for scoping/indexing. |
| outlet_id | uuid | FK → Outlet. |
| template_id | uuid | FK → TaskTemplate. |
| recurrence | jsonb | Typed: `{freq: daily\|weekly\|monthly, interval, byWeekday?, byMonthDay?, timeOfDay}` (spine item 8). |
| timezone_snapshot | text | IANA tz copied from Property at creation; recomputed if property tz changes for future gen. |
| assignee_role | enum? | Role responsible (XOR with assignee_user_id). |
| assignee_user_id | uuid? | Specific user (XOR with assignee_role). |
| grace_minutes | int | Minutes after `due_at` before → overdue; default 0–15 per template. |
| active | bool | Pauses generation without deleting history. |

**Relationships.** * ScheduledTask belongs to Organization/Property/Outlet and 1 TaskTemplate; ScheduledTask 1—* TaskOccurrence.

**Lifecycle.** active → paused (`active=false`) → archived. The generation job reads active ScheduledTasks and materializes occurrences on a rolling ~3-day window.

**Important constraints.** Exactly one of `assignee_role` / `assignee_user_id` is set (CHECK). `timeOfDay` is a local wall-clock time interpreted in `timezone_snapshot`; DST-safe conversion to UTC happens at generation. Pausing does not delete existing future occurrences (they may be cleaned by the generator).

## TaskOccurrence

**Purpose.** A single materialized instance of a ScheduledTask due on one local date — the atom of the Today dashboard. Carries the UTC due time and denormalized scope for fast, cheap tenant-scoped reads.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Denormalized tenant key (leads indexes). |
| property_id / outlet_id | uuid | Denormalized scope. |
| scheduled_task_id | uuid | FK → ScheduledTask. |
| occurrence_local_date | date | The property-local calendar date; part of the idempotency key. |
| due_at | timestamptz | **UTC**, computed from local wall-clock at generation. |
| timezone | text | IANA tz snapshot (denormalized for display). |
| status | enum | `pending \| due \| overdue \| completed \| failed \| skipped`. |
| config_snapshot | jsonb | Frozen copy of template threshold/evidence config at generation time. |

**Relationships.** * TaskOccurrence belongs to 1 ScheduledTask (+ denormalized org/property/outlet); TaskOccurrence 1—(0..1) TaskCompletion; 1—* Exception (on failure); polymorphic Comment target.

**Lifecycle.** `pending` → `due` (at `due_at`) → `overdue` (sweep job, after `grace_minutes`) → `completed` | `failed` | `skipped`. Terminal states are set only via a TaskCompletion (completed/failed) or explicit manager skip.

**Important constraints.** `UNIQUE(scheduled_task_id, occurrence_local_date)` — the idempotency guarantee for the generation job (spine item 8). `config_snapshot` makes occurrences immune to later template edits. Every index leads with `organization_id`; the hot Today query is `(organization_id, outlet_id, due_at)`.

## TaskCompletion

**Purpose.** The immutable, versioned record that an occurrence was performed — who, when, on what device, with what measured values, pass or fail. This is the core compliance evidence row.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| occurrence_id | uuid | FK → TaskOccurrence. |
| version | int | 1 for original; increments per correction (new row). |
| supersedes_id | uuid? | Points to the prior version this one replaces. |
| actor_user_id | uuid | Who completed it. |
| completed_at | timestamptz | Server-authoritative timestamp. |
| entered_values | jsonb | e.g. `{temperature: 3.2, unit:"C"}`. |
| result | enum | `pass \| fail`. |
| device_metadata | jsonb | User-agent, app version, coarse client time (for forensics). |
| edit_reason | text? | Required when `version > 1`. |

**Relationships.** * TaskCompletion belongs to 1 TaskOccurrence; TaskCompletion 1—* Evidence; a `fail` result triggers Exception creation. Chained by `supersedes_id`.

**Lifecycle.** created (immutable). A correction never updates the row: it inserts `version = n+1` with `supersedes_id` set and an `edit_reason`, and writes an ActivityLog before/after entry (spine item 9). Only the highest active version is "current".

**Important constraints.** **No UPDATE/DELETE** (enforced by RLS + trigger). `UNIQUE(occurrence_id, version)`. `edit_reason` mandatory for `version > 1` (CHECK). `result` is computed against `TaskOccurrence.config_snapshot`, not the live template. Result vs. threshold mismatch is itself logged.

## Evidence

**Purpose.** A single piece of proof attached to a TaskCompletion (a temperature value, a note, a photo, a checkbox tick, initials/signature, or a file). Immutable, like its parent completion.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| completion_id | uuid | FK → TaskCompletion. |
| type | enum | `note \| photo \| temperature \| checkbox \| initials \| signature \| file`. |
| value | jsonb | Type-specific payload (number+unit, text, boolean, initials string). |
| attachment_id | uuid? | (0..1) FK → Attachment for binary types (photo/file/signature image). |
| captured_at | timestamptz | Client capture time (advisory). |

**Relationships.** * Evidence belongs to 1 TaskCompletion; Evidence 1—(0..1) Attachment.

**Lifecycle.** created (immutable). Corrections happen at the TaskCompletion version level, never by mutating an Evidence row.

**Important constraints.** No UPDATE/DELETE. Binary types (`photo`, `file`, `signature`) MUST reference an Attachment; non-binary types (`note`, `temperature`, `checkbox`, `initials`) MUST NOT (CHECK on `attachment_id`). Presence/shape must satisfy the parent occurrence's `config_snapshot.required_evidence`.

## Attachment

**Purpose.** Metadata record for a binary object stored in Cloudflare R2 (evidence photos, signature images, generated audit PDFs). The app never streams files directly — it brokers presigned URLs (spine item 7).

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key (also encoded in R2 key prefix). |
| r2_key | text | Object key, prefixed `org/<org_id>/...` for isolation. |
| content_type | text | MIME. |
| size_bytes | bigint | Set on upload finalize. |
| checksum | text? | SHA-256 for integrity / hash-chain support. |
| status | enum | `pending \| uploaded \| quarantined`. |
| kind | enum | `evidence \| export`. |

**Relationships.** Referenced (0..1) by Evidence; produced by ExportJob/AuditPack. No child rows.

**Lifecycle.** `pending` (presigned PUT issued) → `uploaded` (finalize confirms object exists) → optionally `quarantined`. Orphaned `pending` rows past TTL are garbage-collected.

**Important constraints.** `r2_key` MUST begin with the org prefix — cross-org key access is impossible even if an id leaks. Only short-lived presigned GETs are ever handed out. `size_bytes`/`content_type` validated against evidence type limits (e.g. photo ≤ 15 MB, image MIME only).

## Exception

**Purpose.** A recorded failure of a check — a failed completion, a missed (overdue-never-done) occurrence, or a manually flagged problem. The thing an inspector cares most about, and the entry point to corrective action.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| occurrence_id | uuid | FK → TaskOccurrence. |
| cause | enum | `failed_check \| missed \| manual`. |
| severity | enum | `low \| medium \| high`. |
| detail | jsonb | e.g. measured vs. threshold, or free note. |
| status | enum | `open \| in_progress \| resolved \| dismissed`. |
| opened_by | uuid? | Null when system-generated (missed sweep). |
| resolved_at | timestamptz? | — |

**Relationships.** * Exception belongs to 1 TaskOccurrence; Exception 1—* CorrectiveAction; polymorphic Comment target.

**Lifecycle.** `open` → `in_progress` → `resolved` | `dismissed`. Resolution typically requires ≥1 completed CorrectiveAction (configurable by severity). Every transition writes an ActivityLog entry.

**Important constraints.** At most one *open* Exception per `(occurrence_id, cause)` (dedupe the sweep). `dismissed` requires a reason (logged). Exceptions are never deleted — they are first-class audit artifacts.

## CorrectiveAction

**Purpose.** The remediation for an Exception — what was done, by whom, by when, and how it was verified. This is what turns "a fridge was too warm" into "we moved product, logged loss, re-checked at 15:00, verified by manager".

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| exception_id | uuid | FK → Exception. |
| description | text | Action to take / taken. |
| assignee_user_id | uuid? | Responsible person. |
| due_at | timestamptz? | Optional deadline. |
| status | enum | `open \| done \| verified`. |
| completed_by / completed_at | uuid? / timestamptz? | Set on `done`. |
| verified_by / verified_at | uuid? / timestamptz? | Set on `verified` (must differ from completer for high severity). |

**Relationships.** * CorrectiveAction belongs to 1 Exception; polymorphic Comment target.

**Lifecycle.** `open` → `done` → `verified`. Verification is the closure signal that can flip the parent Exception to `resolved`.

**Important constraints.** For `high` severity Exceptions, `verified_by` MUST differ from `completed_by` (four-eyes; CHECK/app rule). All transitions logged. Not immutable (it is an operational task, not an evidence record), but every change is captured in ActivityLog.

## Comment

**Purpose.** Lightweight polymorphic discussion/annotation on an Exception, CorrectiveAction, or TaskOccurrence. Human context around the structured records.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| subject_type | enum | `exception \| corrective_action \| task_occurrence`. |
| subject_id | uuid | Polymorphic target id (same org). |
| author_user_id | uuid | — |
| body | text | Plain text / minimal markdown. |

**Relationships.** Polymorphic *—1 to (Exception | CorrectiveAction | TaskOccurrence). Author is a User.

**Lifecycle.** created → (optional soft edit within a short window, logged) → soft-deleted (hidden, retained for audit).

**Important constraints.** `(subject_type, subject_id)` must resolve to a row in the **same** `organization_id` (app-enforced; polymorphic FK cannot be a DB FK). Comments are not evidence — they never satisfy `required_evidence`.

## ActivityLog

**Purpose.** The append-only, immutable spine of the audit trail. Every state transition and every edit across the domain writes exactly one row here, with polymorphic subject, actor, before/after, and reason. Underpins inspection-ready exports and tamper-evidence (spine item 9).

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK (time-sortable — natural audit ordering). |
| organization_id | uuid | Tenant key (leads index). |
| subject_type | enum | e.g. `task_completion \| exception \| corrective_action \| membership \| scheduled_task \| ...`. |
| subject_id | uuid | Polymorphic target. |
| verb | enum | e.g. `created \| completed \| failed \| edited \| status_changed \| dismissed`. |
| actor_user_id | uuid? | Null for system/cron actions (`actor_type` marks system). |
| before / after | jsonb? | Snapshot for edits. |
| reason | text? | Required for edits/dismissals. |
| prev_hash / row_hash | text? | Optional per-org hash chain for tamper-evidence. |
| created_at | timestamptz | Server-authoritative. |

**Relationships.** Polymorphic *—1 to any auditable entity; actor is a User (nullable for system).

**Lifecycle.** insert-only. There is no update or delete lifecycle — that is the point.

**Important constraints.** **INSERT-only**, enforced by RLS policy + a Postgres trigger that raises on UPDATE/DELETE (spine item 9). When the hash chain is enabled, `row_hash = H(prev_hash || canonical(row))` and `prev_hash` = previous row's hash within the org, giving append-tamper detection. Ordered by UUID v7 `id` for stable pagination.

## Notification

**Purpose.** A per-user, per-event message (overdue task, new exception, corrective action assigned, export ready). In-app first, email second via Resend; batched to avoid spam (spine item 12).

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| recipient_user_id | uuid | FK → User. |
| event_type | enum | `task_overdue \| exception_opened \| corrective_assigned \| export_ready \| ...`. |
| subject_type / subject_id | enum / uuid | Deep-link target. |
| channel | enum | `in_app \| email`. |
| status | enum | `unread \| read` (in-app) / `queued \| sent \| failed` (email). |
| dedupe_key | text | Collapses duplicate events within a digest window. |

**Relationships.** * Notification belongs to 1 Organization and 1 recipient User. References a polymorphic subject. (Future) NotificationPreference per user.

**Lifecycle.** in-app: `unread` → `read`. email: `queued` → `sent` | `failed` (retried by Inngest). Digest batching collapses same-`dedupe_key` events.

**Important constraints.** `dedupe_key` prevents notification storms (e.g. one digest per outlet per sweep, not one per occurrence). Recipient must have an active Membership in the org at send time.

## ExportJob

**Purpose.** The asynchronous job that produces an inspection-ready audit pack (PDF/CSV) from filtered records. State machine: queued → processing → completed → failed (spine items 10–11). Runs on Inngest, renders with @react-pdf/renderer.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| requested_by | uuid | FK → User. |
| filters | jsonb | Date range, property/outlet ids, check types, pass/fail — the exact query used. |
| format | enum | `pdf \| csv`. |
| status | enum | `queued \| processing \| completed \| failed`. |
| audit_pack_id | uuid? | FK → AuditPack when completed. |
| error | text? | Set on failure. |

**Relationships.** * ExportJob belongs to 1 Organization; ExportJob 1—(0..1) AuditPack (on success).

**Lifecycle.** `queued` → `processing` → `completed` (writes AuditPack) | `failed` (retriable). Idempotent per (org, filters, format) within a short window to avoid duplicate heavy renders.

**Important constraints.** `filters` are persisted verbatim so the pack is reproducible and self-describing. Download is only ever via `GET /api/exports/:id/download` issuing a short-lived presigned R2 GET (spine item 2). Job scoped to requester's org and property scope.

## AuditPack

**Purpose.** The immutable record of a generated export file: the R2 object plus the exact filters/metadata and integrity data used to produce it. This is the artifact handed to an inspector.

**Key fields**

| Field | Type | Notes |
|---|---|---|
| id | uuid (v7) | PK |
| organization_id | uuid | Tenant key. |
| export_job_id | uuid | FK → ExportJob. |
| attachment_id | uuid | FK → Attachment (`kind = export`) in R2. |
| filters_snapshot | jsonb | Frozen copy of the filters used. |
| record_count | int | Rows included (shown on cover page). |
| content_hash | text | SHA-256 of the file for tamper-evidence. |
| generated_at | timestamptz | — |

**Relationships.** * AuditPack belongs to 1 ExportJob and references 1 Attachment. Effectively immutable.

**Lifecycle.** created on successful render (immutable). Retained per org `retention_policy_months`; expiry deletes the R2 object and marks the record expired (metadata retained).

**Important constraints.** Immutable. `content_hash` lets a downloaded pack be verified later. Cover metadata states the compliance stance explicitly: **operational proof, not legal certification** (spine item 15).

## Timezone & Locale (cross-cutting value concepts)

**Purpose.** Two ambient value concepts, not tables. **Timezone** is owned at the **Property** level (IANA name) and is the single authority for all recurrence and due-time math. **Locale** is owned at **Organization** (`default_locale`) with optional overrides at Property and User level, and drives display language/formatting only.

**Rules & constraints.**

| Concept | Owner | Consumers | Rule |
|---|---|---|---|
| Timezone (IANA) | Property | ScheduledTask (`timezone_snapshot`), TaskOccurrence (`due_at`, `timezone`) | Wall-clock `timeOfDay` is interpreted in the property tz, converted to UTC at generation (DST-safe). Changing property tz affects only future generation; stored `due_at` UTC values are never rewritten. |
| Locale (BCP-47) | Organization → Property → User | UI rendering, PDF/CSV export labels, dates/numbers, email | Presentation only — never affects due-time computation. Resolution order: User.locale → Property.locale_override → Organization.default_locale. DE/NL/EN supported at MVP. |

All timestamps are stored in **UTC (`timestamptz`)** and rendered in the relevant property timezone; the two concerns are strictly separated so audit records are unambiguous across DST boundaries and jurisdictions.

# 5. Multi-tenancy model

Shift Ledger is a **shared-database, shared-schema** multi-tenant system. There is exactly one Postgres database (Neon, EU region) and one schema; tenants are separated logically by `organization_id`, enforced with two independent layers (application scoping + Postgres RLS). This is spine item 5, and the rest of this section justifies and operationalizes it.

## Organization-level tenancy

The **Organization is the tenant boundary**. Every tenant-scoped table carries a denormalized `organization_id` column, and every row belongs to exactly one org. All reads (React Server Components → Prisma) and writes (Server Actions) execute inside a request context that has resolved the caller's org from their Membership and set the Postgres session variable `app.current_org_id`. There is no code path to "all orgs" data outside a small, explicitly-flagged platform-admin surface that bypasses RLS deliberately.

Org resolution happens once per request: authenticate (Better Auth) → load the active Membership → pin `app.current_org_id` for the DB session → all subsequent queries are transparently constrained.

## Property-level isolation

Property (and Outlet) scoping is layered **on top of** org scoping, never instead of it. Two mechanisms:

1. **Membership property scoping.** A Membership with a non-empty `scoped_property_ids` is restricted to those properties; empty means all properties in the org. This is *additive-restrictive* — it can only narrow what the org role already permits.
2. **Denormalized `property_id` / `outlet_id`** on the operational tables (ScheduledTask, TaskOccurrence, and transitively their children) so property/outlet filters are cheap index scans, not multi-join walks.

Application-layer query builders always apply `organization_id = current_org` first, then intersect with the membership's property scope, then any explicit outlet filter. RLS enforces the org layer; property scoping is enforced in the application query layer (RLS policies stay org-simple and fast; property rules are richer and role-dependent, so they live in code with Zod-validated inputs).

## Role-based access

Roles live on Membership and gate *operations*, not raw row visibility (row visibility is org+property scoping). Summary:

| Role | Scope | Can do |
|---|---|---|
| Owner | Org | Everything incl. billing, delete org, last-owner protected. |
| OrgAdmin | Org | Manage properties, outlets, templates, memberships, exports. |
| PropertyManager | Scoped properties | Manage outlets/scheduled tasks, resolve exceptions, export within scope. |
| KitchenManager | Property/outlet | Configure scheduled tasks, complete checks, open/resolve exceptions, corrective actions. |
| ShiftLeader | Outlet | Complete checks, submit evidence, open exceptions, log corrective actions. |
| Staff | Outlet | Complete assigned checks, submit evidence. |
| Auditor | Org (read-only) | Read everything, generate/download exports. No writes anywhere. |
| (future) ExternalInspector | Time-boxed, scoped | Read-only, restricted to a shared audit pack/date range. |

Enforcement is defense-in-depth: (a) UI hides unavailable actions; (b) every Server Action re-checks role + property scope server-side against the resolved Membership before mutating; (c) RLS guarantees the row was in-org regardless. `Auditor` is denied all writes at the Server Action layer categorically.

## Data partitioning & the "org_id on every table" decision — **yes**

**Put `organization_id` on every tenant-scoped table. This is non-negotiable.** Justification:

- **RLS needs a local predicate.** A single-column `organization_id = current_setting('app.current_org_id')::uuid` policy on each table is simple, fast, and index-friendly. Deriving org via joins in RLS policies would be slow and fragile.
- **No join to know the tenant.** Denormalization means the tenant of any row is knowable without traversing parents — critical for child tables like Evidence, CorrectiveAction, ActivityLog that are several hops from Organization.
- **Index leadership.** Every composite index can lead with `organization_id`, matching the RLS predicate and the natural access pattern (always "within this org").
- **Future physical partitioning / DB lift.** `organization_id` is already the partition key, so a large tenant can be split to a dedicated DB (or the table range-partitioned by org) with zero application changes.

The only exemptions are Organization itself (its `id` *is* the tenant key), globally-shared TemplateLibrary (no tenant), and Better Auth's global User/Session/Account tables (access is mediated by Membership, not RLS).

## Preventing cross-tenant leaks

Belt-and-suspenders, in order of trust:

1. **Postgres RLS as ground truth.** Every tenant table has `ENABLE ROW LEVEL SECURITY` + a `FORCE`d policy keyed on `app.current_org_id`. Even a buggy query or a raw SQL mistake cannot return another org's rows, because the session variable constrains it at the engine.
2. **Mandatory application scoping.** A single tenant-aware Prisma client wrapper sets the session var per request/transaction and refuses to run if `app.current_org_id` is unset. No Server Action or RSC gets a "naked" client.
3. **Set-then-query in one transaction.** The org session var is set inside the same transaction/connection as the query, so pooled connections (Neon/pgBouncer) never leak context between requests.
4. **Polymorphic integrity checks.** Polymorphic references (Comment, ActivityLog subject) are validated in-app to resolve to the same org, since a DB FK cannot express them.
5. **R2 key prefixing.** Every object key is `org/<org_id>/...`; presigned URLs are minted per-object with short TTL, so storage isolation matches DB isolation.
6. **Tests + CI guardrails.** A cross-tenant test suite asserts that org A can never read/write org B rows through any Server Action; a lint/CI check rejects Prisma calls made outside the tenant wrapper.

## Database indexing implications

Every composite index **leads with `organization_id`**, which serves the RLS predicate and the dominant "within this org, filtered by property/outlet/time" access pattern in one structure. Concrete examples:

| Table | Leading composite index | Serves |
|---|---|---|
| task_occurrence | `(organization_id, outlet_id, due_at)` | Today dashboard, overdue sweep. |
| task_occurrence | `(scheduled_task_id, occurrence_local_date)` UNIQUE | Idempotent generation. |
| activity_log | `(organization_id, subject_type, subject_id, id)` | Per-subject audit timeline + stable order. |
| task_completion | `(organization_id, occurrence_id, version)` | Current version lookup / export. |
| exception | `(organization_id, status, severity)` | Open-exceptions views. |
| membership | `(organization_id, user_id)` UNIQUE | Access resolution. |
| notification | `(organization_id, recipient_user_id, status)` | In-app inbox. |

The tradeoff — a wider leading column and some write amplification from denormalized `organization_id`/`property_id` — is deliberately accepted: it makes every hot read a tight org-local index range scan and keeps RLS predicates sargable.

## Future enterprise account support

The design pre-positions for scale without over-building the MVP:

- **Dedicated DB lift.** Because `organization_id` is the universal partition key and all access is org-scoped, a large tenant can be migrated to a dedicated Neon database with the same schema; only connection routing changes, not application logic.
- **Org groups (multi-property ops).** A future `OrganizationGroup` (parent over several Organizations, e.g. a hotel chain's HQ) can layer cross-org *read/reporting* for a Multi-property Ops Manager without collapsing the tenant boundary — each underlying org keeps its own `organization_id` and RLS. This stays out of MVP scope.
- **Table partitioning.** High-volume tables (task_occurrence, activity_log) can be range/hash-partitioned by `organization_id` later, transparently, since the key already leads every index.

None of these are built in the MVP; the point is that the shared-schema + org-key design does not paint us into a corner.

## Recommendation

**Adopt shared-database / shared-schema multi-tenancy with `organization_id` denormalized onto every tenant-scoped table, enforced by mandatory application-level tenant scoping AND Postgres Row-Level Security as defense-in-depth, with property/outlet scoping and role checks layered in the application.** This is the simplest durable model for one full-stack engineer to run, it keeps every hot query as an org-local index range scan, it makes cross-tenant leakage a two-layer failure rather than a one-line bug, and — because `organization_id` is already the partition key — it lets us lift a large tenant to a dedicated database or introduce org groups later with **zero application rewrites**. Do not consider schema-per-tenant or database-per-tenant for the MVP; they add operational and migration cost that this model defers cleanly until real enterprise demand justifies it.

---

# 6. Permissions and roles

Shift Ledger enforces a single **org-level Role** carried on each `Membership`. `PropertyManager`, `KitchenManager`, `ShiftLeader`, and `Staff` are additionally **property-scoped**: a Membership may be constrained to one or more properties, and every permission below is evaluated within that property scope. `Owner`, `OrgAdmin`, and `Auditor` see the whole organization. All permission checks run **application-level first** (tenant + property scoping in Server Actions / RSC queries) with **Postgres RLS** (`app.current_org_id`) as defense-in-depth.

## 6.1 Permission matrix

Legend: **Yes** = permitted org-wide · **Scoped** = permitted only within the properties/outlets the Membership is scoped to · **No** = denied.

| Action | Owner | OrgAdmin | PropertyManager | KitchenManager | ShiftLeader | Staff | Auditor | ExternalInspector (future) |
|---|---|---|---|---|---|---|---|---|
| Invite users | Yes | Yes | Scoped | No | No | No | No | No |
| Create properties | Yes | Yes | No | No | No | No | No | No |
| Create outlets | Yes | Yes | Scoped | No | No | No | No | No |
| Create templates | Yes | Yes | Scoped | Scoped | No | No | No | No |
| Schedule tasks | Yes | Yes | Scoped | Scoped | No | No | No | No |
| Complete tasks | Yes | Yes | Scoped | Scoped | Scoped | Scoped | No | No |
| Edit completed tasks | Yes | Yes | Scoped | Scoped | No | No | No | No |
| Delete completed tasks | No | No | No | No | No | No | No | No |
| Create corrective actions | Yes | Yes | Scoped | Scoped | Scoped | No | No | No |
| Close corrective actions | Yes | Yes | Scoped | Scoped | No | No | No | No |
| Export audit pack | Yes | Yes | Scoped | Scoped | No | No | Scoped/Yes | Scoped (future) |
| View all properties | Yes | Yes | No | No | No | No | Yes | Scoped (future) |
| View activity logs | Yes | Yes | Scoped | Scoped | Scoped | No | Yes | Scoped (future) |
| Manage billing (future) | Yes | No | No | No | No | No | No | No |

Notes on specific cells:

- **Delete completed tasks = No for everyone.** Completed compliance records are immutable (see 6.2). "Deletion" is never a hard delete; the only permitted operation is a `cancelled`/superseding version written by a manager, captured in audit history. This is deliberate and non-negotiable for inspection integrity.
- **Auditor** is strictly read-only across the whole org: it may view every property and every activity log, and export audit packs (its core purpose), but writes nothing. It cannot complete tasks, create corrective actions, or invite users.
- **Staff / ShiftLeader** are frontline-first: they exist to *complete* tasks and (ShiftLeader only) raise corrective actions fast, within their scoped outlets. They cannot restructure the org (templates, schedules, properties, closing corrective actions).
- **Manage billing** is Owner-only and out of MVP scope; listed for completeness of the role model.
- **ExternalInspector** is a future read-only, time-boxed, property-scoped guest role (for a health inspector on-site); not built in MVP.

## 6.2 Immutability rule for completed compliance records

Once a `TaskCompletion` (and its child `Evidence`) is written, it is an **immutable compliance record**. There is no in-place UPDATE and no DELETE path exposed to any role.

- An "edit" (e.g. a manager correcting a mistyped fridge temperature of `40°C` that should read `4.0°C`) does **not** mutate the original row. It writes a **new version** of the `TaskCompletion` (incremented version, pointer to the superseded row) and appends an `ActivityLog` entry capturing **before value, after value, reason (required), actor, timestamp, and device metadata**. The original version is retained forever and remains visible in the timeline and in audit packs.
- Only `Owner`, `OrgAdmin`, and scoped `PropertyManager` / `KitchenManager` may create such a corrected version ("Edit completed tasks = Yes/Scoped"). Frontline roles cannot.
- `Evidence` binaries in R2 are never overwritten; a correction attaches new Attachments and supersedes, it never replaces the object.
- The `activity_log` table is **append-only**, enforced by RLS plus a Postgres trigger that rejects UPDATE/DELETE, with an optional per-org **hash chain** (`prev_hash`) for tamper-evidence. This guarantees that "can I prove it happened?" holds even when a value was later corrected — the correction and its reason are themselves part of the permanent record.

## 6.3 Property-scoping of manager roles

- **Org-wide roles** (`Owner`, `OrgAdmin`, `Auditor`): every query is scoped only by `organization_id`. They see and (for Owner/OrgAdmin) act across all properties and outlets.
- **Property-scoped roles** (`PropertyManager`, `KitchenManager`, `ShiftLeader`, `Staff`): the Membership carries the set of property ids it applies to. Every read (RSC query) and every write (Server Action) is filtered by `organization_id` **AND** the intersection of the request's property/outlet with the Membership's scoped properties. A KitchenManager scoped to *Property Amsterdam-Centraal* cannot see, complete, edit, or export anything belonging to *Property Berlin-Mitte*, even though both share the same organization.
- Scoping is layered strictly **on top of** org scoping — never a replacement. Because every composite index leads with `organization_id` and property scoping is applied next, these checks are cheap and index-aligned.
- A single human with responsibilities across two properties is modeled as one User with **one Membership scoped to both properties** (not two memberships), keeping the org-level Role singular and unambiguous.

---

# 7. State machines

Every transition in every machine below writes an `ActivityLog` entry (append-only, polymorphic subject, org-scoped, actor + timestamp + before/after state). This is universal and is restated per table for precision. "System-triggered" transitions are driven by **Inngest** jobs (occurrence generation, ~10-minute overdue sweep, completed_late detection, export processing); "user-triggered" transitions come from Server Actions invoked by a permitted role.

## 7.1 TaskOccurrence

States: `pending`, `due`, `overdue`, `completed`, `completed_late`, `failed`, `skipped`, `cancelled`.

- `pending` — materialized ahead (rolling ~3-day window), `due_at` in the future.
- `due` — `now >= due_at`, within grace, awaiting completion.
- `overdue` — grace window elapsed with no completion.
- `completed` — passing completion recorded on time.
- `completed_late` — passing completion recorded after it went `overdue`.
- `failed` — completion recorded but pass/fail evaluated as fail (threshold breach), spawns an Exception.
- `skipped` — explicitly marked not-applicable by a manager (e.g. outlet closed that day), with reason.
- `cancelled` — occurrence voided (schedule changed/deleted before it was actioned).

| From → To | Trigger | Who can trigger | System-triggered? | Audit log |
|---|---|---|---|---|
| (none) → pending | Occurrence generation job materializes the occurrence | — | Yes (Inngest generation) | Required |
| pending → due | `now >= due_at` reached | — | Yes (sweep) | Required |
| due → overdue | Grace window elapsed, no completion | — | Yes (sweep, ~10 min) | Required |
| due → completed | Passing completion submitted on time | KitchenManager, ShiftLeader, Staff, PropertyManager (scoped); Owner/OrgAdmin | No (user) | Required |
| overdue → completed_late | Passing completion submitted after overdue | KitchenManager, ShiftLeader, Staff, PropertyManager (scoped); Owner/OrgAdmin | No (user); system stamps the "late" classification | Required |
| due → failed | Completion submitted but fails threshold/checklist | KitchenManager, ShiftLeader, Staff, PropertyManager (scoped); Owner/OrgAdmin | No (user); system evaluates pass/fail + opens Exception | Required |
| overdue → failed | Late completion that also fails threshold | Same as above | No (user); system evaluates + opens Exception | Required |
| pending → cancelled | Underlying ScheduledTask edited/deleted before action | PropertyManager, KitchenManager (scoped); Owner/OrgAdmin | Partly (generation reconciliation may cancel) | Required |
| due → cancelled | Same as above, after it became due | PropertyManager, KitchenManager (scoped); Owner/OrgAdmin | No (user) | Required |
| pending → skipped / due → skipped / overdue → skipped | Manager marks not-applicable with reason | PropertyManager, KitchenManager (scoped); Owner/OrgAdmin | No (user) | Required (reason mandatory) |

Terminal states: `completed`, `completed_late`, `failed` (record immutable; a correction creates a new TaskCompletion version, not a state re-open), `skipped`, `cancelled`. There is no direct `failed → completed` transition — remediation happens through the linked Exception/CorrectiveAction, not by mutating the occurrence.

## 7.2 Exception

States: `open`, `acknowledged`, `in_progress`, `resolved`, `verified`, `reopened`.

- `open` — auto-created when an occurrence resolves to `failed`.
- `acknowledged` — a responsible user has seen and accepted ownership.
- `in_progress` — corrective work underway (typically ≥1 CorrectiveAction active).
- `resolved` — corrective work reported complete, awaiting verification.
- `verified` — a manager confirmed the resolution holds (terminal-happy).
- `reopened` — verification failed or the issue recurred; back into the loop.

| From → To | Trigger | Who can trigger | System-triggered? | Audit log |
|---|---|---|---|---|
| (none) → open | Occurrence evaluated as `failed` | — | Yes (pass/fail evaluation on completion) | Required |
| open → acknowledged | User accepts ownership | ShiftLeader, KitchenManager, PropertyManager (scoped); Owner/OrgAdmin | No (user) | Required |
| acknowledged → in_progress | First CorrectiveAction assigned/started | KitchenManager, PropertyManager (scoped); Owner/OrgAdmin | Partly (auto when a linked CorrectiveAction → assigned) | Required |
| in_progress → resolved | All CorrectiveActions reported `done` | KitchenManager, PropertyManager (scoped); Owner/OrgAdmin | Partly (auto when last linked CorrectiveAction → done) | Required |
| resolved → verified | Manager verifies fix holds | PropertyManager, KitchenManager (scoped); Owner/OrgAdmin | No (user) | Required |
| resolved → reopened | Verification rejected | PropertyManager, KitchenManager (scoped); Owner/OrgAdmin | No (user) | Required |
| verified → reopened | Recurrence / audit finding | PropertyManager, KitchenManager (scoped); Owner/OrgAdmin | No (user) | Required |
| reopened → acknowledged | Re-triaged | ShiftLeader, KitchenManager, PropertyManager (scoped); Owner/OrgAdmin | No (user) | Required |

Terminal-happy state: `verified`. `reopened` always re-enters via `acknowledged`. Every transition writes `ActivityLog`.

## 7.3 CorrectiveAction

States: `open`, `assigned`, `done`, `verified`, `rejected`.

- `open` — created under an Exception, not yet assigned.
- `assigned` — has an assignee and a due date.
- `done` — assignee reports the action complete (with evidence where required).
- `verified` — a manager confirms the action was effective.
- `rejected` — manager judges the reported work insufficient; returns for rework.

| From → To | Trigger | Who can trigger | System-triggered? | Audit log |
|---|---|---|---|---|
| (none) → open | CorrectiveAction created under an Exception | ShiftLeader, KitchenManager, PropertyManager (scoped); Owner/OrgAdmin | No (user) | Required |
| open → assigned | Assignee + due date set | KitchenManager, PropertyManager (scoped); Owner/OrgAdmin | No (user) | Required |
| assigned → done | Assignee marks complete (+ evidence) | Assignee (any scoped role incl. Staff if assigned); KitchenManager/PropertyManager; Owner/OrgAdmin | No (user) | Required |
| done → verified | Manager confirms effectiveness | PropertyManager, KitchenManager (scoped); Owner/OrgAdmin | No (user) | Required |
| done → rejected | Manager rejects reported work | PropertyManager, KitchenManager (scoped); Owner/OrgAdmin | No (user) | Required |
| rejected → assigned | Returned for rework (re-assigned) | KitchenManager, PropertyManager (scoped); Owner/OrgAdmin | No (user) | Required |

Terminal-happy state: `verified`. When the **last** CorrectiveAction on an Exception reaches `done`, the system may auto-advance the parent Exception to `resolved` (see 7.2). `rejected` never dead-ends; it routes back to `assigned`. Every transition writes `ActivityLog`.

## 7.4 ExportJob

States: `queued`, `processing`, `completed`, `failed`.

- `queued` — export requested; filters/metadata persisted; awaiting worker.
- `processing` — Inngest worker rendering the AuditPack via `@react-pdf/renderer` (or CSV) and uploading to R2.
- `completed` — file stored in R2; short-lived signed GET URL available.
- `failed` — render/upload error after retries exhausted.

| From → To | Trigger | Who can trigger | System-triggered? | Audit log |
|---|---|---|---|---|
| (none) → queued | User requests audit pack export | PropertyManager, KitchenManager (scoped), Auditor; Owner/OrgAdmin | No (user) | Required |
| queued → processing | Worker picks up job | — | Yes (Inngest) | Required |
| processing → completed | Render + R2 upload succeeds | — | Yes (Inngest) | Required |
| processing → failed | Error after retries exhausted | — | Yes (Inngest) | Required |
| failed → queued | Retry requested | PropertyManager, KitchenManager (scoped), Auditor; Owner/OrgAdmin | No (user) — new attempt | Required |

Notes: `queued → processing → completed/failed` is the durable, retriable Inngest lifecycle; intra-attempt retries are handled by Inngest without changing the user-visible state. A user-requested retry from `failed` is modeled as a fresh `failed → queued` transition (or a new ExportJob), both audited. The signed download URL is issued only in `completed` state via `GET /api/exports/:id/download`; files are never served directly from the app. Every transition writes `ActivityLog`.

---

# 8. Database schema

This section specifies the full PostgreSQL schema for Shift Ledger as structured tables. It is strictly consistent with the LOCKED ARCHITECTURAL SPINE (Neon EU, Prisma, UUID v7 PKs, shared-schema multi-tenancy with RLS, materialized occurrences, immutable audit) and the CANONICAL ENTITIES. No Prisma or SQL code is given — only column tables, keys, and index specifications.

## 8.0 Shared conventions (stated once, apply to every table below)

- **Primary keys**: `id uuid` PK, UUID **v7** (time-sortable), db-generated. No serial/bigint PKs.
- **Tenant column**: `organization_id uuid NOT NULL` on **every tenant-scoped table**, denormalized even where it is derivable via joins. It is the **leading column of every composite index** and the RLS partition key. (The `organizations` table itself and the global `template_library` and Better Auth `users`/`accounts`/`verification` tables are the only non-tenant-scoped tables.)
- **Timestamps**: `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT now()` (app-maintained on write) on all mutable tables. All time stored **UTC**; wall-clock is always resolved through a property IANA timezone.
- **Soft delete**: `deleted_at timestamptz NULL` on mutable tables; queries filter `deleted_at IS NULL`. **Exceptions (never soft-deleted, append-only / versioned)**: `activity_log`, `task_completion`, `evidence`. These are immutable — an "edit" writes a **new version row** plus an `activity_log` entry, never an UPDATE/DELETE.
- **RLS**: enabled and FORCED on every tenant-scoped table. Policy predicate: `organization_id = current_setting('app.current_org_id')::uuid`, set per-request from the authenticated membership. `activity_log`, `task_completion`, `evidence` additionally have **no UPDATE/DELETE policy** (append-only), backed by a trigger that raises on UPDATE/DELETE.
- **Enums**: implemented as Postgres `enum` types (listed inline). Money/temperature stored as `numeric`, never float.
- **Localization later**: `locale` / `*_i18n jsonb` columns are present now on user-facing content tables (`organizations`, `users`, `task_templates`, `template_library`) so DE/NL/EN can be layered without migration churn.
- **Foreign keys**: all FKs `ON DELETE RESTRICT` by default; tenant data is retired via soft-delete or org lifecycle jobs, not cascading hard deletes (audit integrity). Better Auth session/account rows cascade from `users`.

Enum types used below:

| Enum | Values |
|---|---|
| `org_role` | Owner, OrgAdmin, PropertyManager, KitchenManager, ShiftLeader, Staff, Auditor, ExternalInspector |
| `check_type` | temperature, cleaning, allergen, opening, closing, generic |
| `evidence_type` | note, photo, temperature, checkbox, initials, signature, file |
| `recurrence_freq` | daily, weekly, monthly |
| `occurrence_status` | pending, due, overdue, completed, completed_late, failed, skipped, cancelled *(canonical per D1/F8)* |
| `completion_result` | pass, fail |
| `exception_status` | open, acknowledged, in_progress, resolved, verified, reopened *(canonical per D2/F8)* |
| `corrective_status` | open, assigned, done, verified, rejected *(canonical per D2/F8)* |
| `invitation_status` | pending, accepted, revoked, expired |
| `export_status` | queued, processing, completed, failed |
| `export_format` | pdf, csv |
| `notification_channel` | in_app, email |
| `notification_status` | pending, sent, read, failed |
| `comment_subject_type` | task_occurrence, exception, corrective_action |
| `activity_subject_type` | organization, property, outlet, membership, task_template, scheduled_task, task_occurrence, task_completion, evidence, exception, corrective_action, export_job, notification |

---

## 8.1 organizations

Root tenant. Not itself tenant-scoped (it *is* the tenant) but RLS restricts a session to its own org row.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| name | text | NOT NULL |
| slug | citext | NOT NULL, globally unique (subdomain/url) |
| default_locale | text | NOT NULL DEFAULT 'de' (BCP-47: de, nl, en) |
| default_timezone | text | NOT NULL DEFAULT 'Europe/Berlin' (IANA; per-property overrides) |
| retention_days | int | NOT NULL DEFAULT 1095 (3y default per D5; per-org configurable; MUST be legally validated per customer) |
| legal_hold | boolean | NOT NULL DEFAULT false (blocks deletion/anonymisation while set — D5) |
| hash_chain_enabled | boolean | NOT NULL DEFAULT true (per-org tamper-evident audit chain) |
| settings_json | jsonb | NOT NULL DEFAULT '{}' (minimal org prefs; no bloated admin) |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: none
- **Indexes**: `UNIQUE (slug)`; `(deleted_at)` partial where not null (lifecycle sweeps)
- **Unique**: `slug`
- **RLS**: `id = app.current_org_id`

## 8.2 properties (Sites)

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| name | text | NOT NULL |
| timezone | text | NOT NULL (IANA, e.g. 'Europe/Amsterdam') — **source of truth for occurrence wall-clock** |
| address_json | jsonb | NULL (street/city/country; country drives DE/NL starter packs) |
| country_code | char(2) | NOT NULL (ISO 3166-1; 'DE'/'NL') |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id -> organizations.id`
- **Indexes**: `(organization_id, deleted_at)`; `(organization_id, name)`
- **Unique**: `UNIQUE (organization_id, name)` (name unique within org)
- **RLS**: `organization_id = app.current_org_id`

## 8.3 outlets (Kitchens)

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id (denormalized) |
| property_id | uuid | NOT NULL, FK -> properties.id |
| name | text | NOT NULL (e.g. 'Main Kitchen', 'Banquet Cold Prep') |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id -> organizations.id`; `property_id -> properties.id`
- **Indexes**: `(organization_id, property_id, deleted_at)`
- **Unique**: `UNIQUE (property_id, name)`
- **RLS**: `organization_id = app.current_org_id`

## 8.4 users (Better Auth — global, not tenant-scoped)

A person, potentially a member of multiple orgs. Global identity; tenancy lives on `memberships`.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| email | citext | NOT NULL, globally unique |
| email_verified | boolean | NOT NULL DEFAULT false |
| name | text | NULL |
| image_url | text | NULL (avatar) |
| locale | text | NULL (personal UI language override; falls back to org default) |
| created_at / updated_at | timestamptz | conventions (no org scoping; no soft-delete — GDPR erasure handled explicitly) |

- **Primary key**: `id`
- **Foreign keys**: none
- **Indexes**: `UNIQUE (email)`
- **RLS**: not org-scoped; access mediated by application + membership joins.

## 8.5 accounts (Better Auth — credentials/OAuth)

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| user_id | uuid | NOT NULL, FK -> users.id ON DELETE CASCADE |
| provider_id | text | NOT NULL (e.g. 'credential', 'google') |
| account_id | text | NOT NULL (provider's subject id) |
| password_hash | text | NULL (credential provider only) |
| access_token / refresh_token | text | NULL |
| expires_at | timestamptz | NULL |
| created_at / updated_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `user_id -> users.id` (CASCADE)
- **Indexes**: `(user_id)`; `UNIQUE (provider_id, account_id)`
- **Unique**: `(provider_id, account_id)`

## 8.6 sessions (Better Auth)

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| user_id | uuid | NOT NULL, FK -> users.id ON DELETE CASCADE |
| token | text | NOT NULL, unique (session token/hash) |
| active_organization_id | uuid | NULL, FK -> organizations.id (Better Auth active-org context → drives `app.current_org_id`) |
| ip_address / user_agent | text | NULL |
| expires_at | timestamptz | NOT NULL |
| created_at / updated_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `user_id -> users.id` (CASCADE); `active_organization_id -> organizations.id`
- **Indexes**: `UNIQUE (token)`; `(user_id)`; `(expires_at)` (expiry sweep)
- **Unique**: `token`

## 8.7 verification (Better Auth — email verify / password reset tokens)

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| identifier | text | NOT NULL (email/purpose key) |
| value | text | NOT NULL (token/hash) |
| expires_at | timestamptz | NOT NULL |
| created_at / updated_at | timestamptz | conventions |

- **Primary key**: `id`
- **Indexes**: `(identifier)`; `(expires_at)`
- **Unique**: `UNIQUE (identifier, value)`

## 8.8 memberships

The `User *—* Organization` join carrying org-level Role, optionally property-scoped.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| user_id | uuid | NOT NULL, FK -> users.id |
| role | org_role | NOT NULL (org-level role) |
| property_scope | uuid[] | NULL (if non-null, membership limited to these property_ids; null = whole org) |
| status | text | NOT NULL DEFAULT 'active' (active/suspended) |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id -> organizations.id`; `user_id -> users.id`
- **Indexes**: `(organization_id, user_id)`; `(user_id)` (list my orgs on login); `(organization_id, role)`
- **Unique**: `UNIQUE (organization_id, user_id)` (one membership per user per org)
- **RLS**: `organization_id = app.current_org_id`
- **Note**: property-level scoping is enforced in the application layer on top of org RLS (see Spine §5). `property_scope` as `uuid[]` keeps the MVP simple; a join table can replace it later without changing org partitioning.

## 8.9 invitations

Pending membership by email.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| email | citext | NOT NULL |
| role | org_role | NOT NULL (role granted on accept) |
| property_scope | uuid[] | NULL (mirrors membership scoping) |
| token | text | NOT NULL, unique (accept link) |
| status | invitation_status | NOT NULL DEFAULT 'pending' |
| invited_by | uuid | NOT NULL, FK -> users.id |
| expires_at | timestamptz | NOT NULL |
| accepted_at | timestamptz | NULL |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id -> organizations.id`; `invited_by -> users.id`
- **Indexes**: `UNIQUE (token)`; `(organization_id, status)`; `(organization_id, email)`
- **Unique**: `token`; partial `UNIQUE (organization_id, email) WHERE status = 'pending'` (one live invite per email per org)
- **RLS**: `organization_id = app.current_org_id`

## 8.10 template_library (global curated starter packs)

Global, NOT tenant-scoped — curated HACCP starter packs for DE/NL, cloned into an org's `task_templates`.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| key | text | NOT NULL, unique (stable identifier, e.g. 'haccp.fridge_temp.de') |
| check_type | check_type | NOT NULL |
| country_code | char(2) | NULL (DE/NL targeting; null = generic) |
| title_i18n | jsonb | NOT NULL (per-locale titles: {de,nl,en}) |
| instructions_i18n | jsonb | NULL |
| required_evidence | evidence_type[] | NOT NULL DEFAULT '{}' |
| target_config_json | jsonb | NULL (thresholds, e.g. {"maxCelsius":4}) |
| default_recurrence_json | jsonb | NULL (suggested recurrence to seed a scheduled_task) |
| version | int | NOT NULL DEFAULT 1 |
| is_active | boolean | NOT NULL DEFAULT true |
| created_at / updated_at | timestamptz | conventions |

- **Primary key**: `id`
- **Indexes**: `UNIQUE (key)`; `(check_type)`; `(country_code, is_active)`
- **RLS**: none (global read; writes restricted to platform admins at app layer)

## 8.11 task_templates (org-owned)

A template owned by an org, optionally cloned from `template_library`.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| source_library_id | uuid | NULL, FK -> template_library.id (provenance if cloned) |
| check_type | check_type | NOT NULL |
| title | text | NOT NULL |
| title_i18n | jsonb | NULL (localized overrides) |
| instructions | text | NULL |
| required_evidence | evidence_type[] | NOT NULL DEFAULT '{}' (evidence types the completion must include) |
| target_config_json | jsonb | NULL (threshold/target, e.g. fridge <= 4°C: {"maxCelsius":4}) |
| is_active | boolean | NOT NULL DEFAULT true |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id -> organizations.id`; `source_library_id -> template_library.id`
- **Indexes**: `(organization_id, is_active, deleted_at)`; `(organization_id, check_type)`
- **RLS**: `organization_id = app.current_org_id`

## 8.12 scheduled_tasks

A `TaskTemplate` applied to an Outlet, with typed recurrence, time-of-day, and assignment.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| property_id | uuid | NOT NULL, FK -> properties.id (denormalized) |
| outlet_id | uuid | NOT NULL, FK -> outlets.id |
| task_template_id | uuid | NOT NULL, FK -> task_templates.id |
| recurrence_json | jsonb | NOT NULL (typed Recurrence: {freq, interval, byWeekday[], byMonthDay[], timeOfDay}) |
| recurrence_freq | recurrence_freq | NOT NULL (denormalized from json for filtering) |
| time_of_day | time | NOT NULL (local wall-clock; resolved via property.timezone at generation) |
| timezone | text | NOT NULL (snapshot of property.timezone at creation; DST-safe generation) |
| assignee_role | org_role | NULL (assign to role) |
| assignee_user_id | uuid | NULL, FK -> users.id (assign to specific user) |
| grace_minutes | int | NOT NULL DEFAULT 15 (per D3; due→overdue grace before sweep flips status; configurable 0–60) |
| starts_on | date | NOT NULL (first eligible local date) |
| ends_on | date | NULL (open-ended if null) |
| is_active | boolean | NOT NULL DEFAULT true |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `property_id`, `outlet_id`, `task_template_id`, `assignee_user_id`
- **Indexes**: `(organization_id, is_active, deleted_at)`; `(organization_id, outlet_id, is_active)`; **`(is_active, ends_on)` — drives the daily generation job scan** for active schedules
- **Check**: exactly one of (`assignee_role`, `assignee_user_id`) non-null (enforced via CHECK constraint)
- **RLS**: `organization_id = app.current_org_id`

## 8.13 task_occurrences (materialized)

One row per occurrence per local date, materialized ~3 days ahead. **The heart of the Today dashboard and overdue sweep.**

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id (denormalized) |
| property_id | uuid | NOT NULL, FK -> properties.id (denormalized) |
| outlet_id | uuid | NOT NULL, FK -> outlets.id (denormalized) |
| scheduled_task_id | uuid | NOT NULL, FK -> scheduled_tasks.id |
| task_template_id | uuid | NOT NULL, FK -> task_templates.id (denormalized for dashboard render) |
| check_type | check_type | NOT NULL (denormalized) |
| occurrence_local_date | date | NOT NULL (local calendar date in property tz — idempotency key) |
| due_at | timestamptz | NOT NULL (UTC; computed from local_date + time_of_day in timezone) |
| timezone | text | NOT NULL (snapshot; denormalized) |
| status | occurrence_status | NOT NULL DEFAULT 'pending' (per D1/F8) |
| assignee_role | org_role | NULL (snapshot from scheduled_task) |
| assignee_user_id | uuid | NULL, FK -> users.id |
| completed_at | timestamptz | NULL (set when a completion lands; denormalized for fast filter) |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `property_id`, `outlet_id`, `scheduled_task_id`, `task_template_id`, `assignee_user_id`
- **Unique**: **`UNIQUE (scheduled_task_id, occurrence_local_date)`** — idempotent generation (re-running the job never double-creates)
- **Indexes** (critical):
  - **Today dashboard**: `(organization_id, property_id, outlet_id, occurrence_local_date, status)` — the primary "what must happen today" query, scoped and date-filtered.
  - **Overdue sweep**: partial `(status, due_at) WHERE status IN ('pending','due')` — lets the ~10-min sweep job cheaply find occurrences whose `due_at + grace` has passed to flip → `due`/`overdue`, org-agnostic (runs as system role).
  - `(organization_id, assignee_user_id, occurrence_local_date)` — "my tasks today".
  - `(organization_id, status, occurrence_local_date)` — org-wide missed/failed rollups.
- **RLS**: `organization_id = app.current_org_id` (the sweep job runs under a privileged system role that bypasses the org predicate but still filters by status/due_at).

## 8.14 task_completions (versioned, immutable)

`TaskOccurrence 1—(0..1)` current completion, but rows are **append-only versions** — an edit inserts a new version, never mutates.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| task_occurrence_id | uuid | NOT NULL, FK -> task_occurrences.id |
| version | int | NOT NULL DEFAULT 1 (monotonic per occurrence) |
| is_current | boolean | NOT NULL DEFAULT true (only one current version per occurrence) |
| supersedes_id | uuid | NULL, FK -> task_completions.id (prior version this replaces) |
| client_submission_id | uuid | NOT NULL (client-generated idempotency key — F2; a retry with the same id returns the existing row, never a duplicate) |
| result | completion_result | NOT NULL (pass/fail) |
| entered_values_json | jsonb | NOT NULL DEFAULT '{}' (e.g. {"measuredCelsius":3.4}) |
| measured_numeric | numeric | NULL (extracted primary reading for query/threshold checks; `numeric`, never float) |
| completed_by | uuid | NOT NULL, FK -> users.id (actor) |
| actor_confirmation_method | text | NOT NULL DEFAULT 'session' (`session` \| `pin` \| `initials` — shared-tablet actor identity, D8) |
| recorded_at | timestamptz | NOT NULL DEFAULT now() (**server-authoritative** compliance timestamp — F3; the trustworthy "when") |
| client_reported_at | timestamptz | NULL (device self-reported time — advisory only, never used for compliance logic/ordering — F3) |
| device_meta_json | jsonb | NULL (user-agent, app version, geo hint) |
| edit_reason | text | NULL (required when version > 1) |
| created_at | timestamptz | NOT NULL DEFAULT now() (**no updated_at, no deleted_at — immutable**) |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `task_occurrence_id`, `completed_by`, `supersedes_id`
- **Unique**: **partial `UNIQUE (task_occurrence_id) WHERE is_current` — at most one current completion per occurrence**; `UNIQUE (task_occurrence_id, version)`; **`UNIQUE (organization_id, client_submission_id)` — idempotency (F2)**
- **Indexes**: `(organization_id, task_occurrence_id, version)`; `(organization_id, result, recorded_at)` (fail rollups / exports)
- **RLS**: `organization_id = app.current_org_id`; **append-only — no UPDATE/DELETE policy; trigger raises on UPDATE/DELETE**. Superseding is done by inserting a new version and flipping `is_current` on the prior row via the *only* permitted narrow update path (a SECURITY DEFINER function that also writes the activity_log), or by modeling `is_current` derivation from max(version) — the versioning function is the single writer.

## 8.15 evidence (immutable)

`TaskCompletion 1—*` evidence items. Immutable; corrections attach to the new completion version.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| task_completion_id | uuid | NOT NULL, FK -> task_completions.id |
| type | evidence_type | NOT NULL (note/photo/temperature/checkbox/initials/signature/file) |
| value_text | text | NULL (note text, initials, checkbox label) |
| value_numeric | numeric | NULL (temperature reading) |
| value_bool | boolean | NULL (checkbox) |
| attachment_id | uuid | NULL, FK -> attachments.id (binary evidence: photo/signature/file) |
| captured_at | timestamptz | NOT NULL DEFAULT now() |
| created_at | timestamptz | NOT NULL DEFAULT now() (**immutable — no updated_at/deleted_at**) |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `task_completion_id`, `attachment_id`
- **Indexes**: `(organization_id, task_completion_id)`; `(organization_id, type)`
- **RLS**: `organization_id = app.current_org_id`; **append-only trigger (no UPDATE/DELETE)**.

## 8.16 attachments (R2 object metadata)

Pointer to a Cloudflare R2 object. Files are never served from the app (presigned GET only).

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| r2_bucket | text | NOT NULL |
| r2_key | text | NOT NULL (object key, org-prefixed: `org/{org_id}/evidence/{uuid}`) |
| content_type | text | NOT NULL (image/jpeg, application/pdf, …) |
| byte_size | bigint | NULL (set on upload finalize) |
| checksum_sha256 | text | NULL until finalize, then **required** (integrity / tamper-evidence — F6; included in the activity_log hash-chain payload for the completion) |
| status | text | NOT NULL DEFAULT 'pending' (pending → uploaded; set on finalize callback) |
| uploaded_by | uuid | NULL, FK -> users.id |
| created_at / updated_at / deleted_at | timestamptz | conventions (soft-delete = tombstone; R2 object purged by retention job) |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `uploaded_by`
- **Indexes**: `(organization_id, status)`; `UNIQUE (r2_bucket, r2_key)`
- **Unique**: `(r2_bucket, r2_key)`
- **RLS**: `organization_id = app.current_org_id`
- **Note**: the `POST /api/uploads` route issues the presigned PUT and inserts the `pending` row; `exports` (§8.22) reuse this table for generated PDF/CSV objects.

## 8.17 exceptions

Created when an occurrence/completion fails. `TaskOccurrence 1—*` exceptions.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| property_id | uuid | NOT NULL, FK -> properties.id (denormalized) |
| outlet_id | uuid | NOT NULL, FK -> outlets.id (denormalized) |
| task_occurrence_id | uuid | NOT NULL, FK -> task_occurrences.id |
| task_completion_id | uuid | NULL, FK -> task_completions.id (the failing version, if from a completion) |
| status | exception_status | NOT NULL DEFAULT 'open' |
| severity | text | NOT NULL DEFAULT 'normal' (normal/critical — e.g. cold-chain breach) |
| title | text | NOT NULL (e.g. 'Fridge over 4°C') |
| detail | text | NULL |
| opened_by | uuid | NULL, FK -> users.id (null = system-generated on threshold fail) |
| opened_at | timestamptz | NOT NULL DEFAULT now() |
| resolved_at | timestamptz | NULL |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `property_id`, `outlet_id`, `task_occurrence_id`, `task_completion_id`, `opened_by`
- **Indexes**: `(organization_id, status, opened_at)` (open-exceptions dashboard); `(organization_id, outlet_id, status)`; `(organization_id, task_occurrence_id)`
- **RLS**: `organization_id = app.current_org_id`

## 8.18 corrective_actions

`Exception 1—*` corrective actions with assignee, due, verification.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| exception_id | uuid | NOT NULL, FK -> exceptions.id |
| status | corrective_status | NOT NULL DEFAULT 'open' |
| description | text | NOT NULL (action taken/required) |
| assignee_user_id | uuid | NULL, FK -> users.id |
| assignee_role | org_role | NULL |
| due_at | timestamptz | NULL |
| completed_by | uuid | NULL, FK -> users.id |
| completed_at | timestamptz | NULL |
| verified_by | uuid | NULL, FK -> users.id (manager sign-off) |
| verified_at | timestamptz | NULL |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `exception_id`, `assignee_user_id`, `completed_by`, `verified_by`
- **Indexes**: `(organization_id, status, due_at)` (overdue corrective-action sweep); `(organization_id, exception_id)`; `(organization_id, assignee_user_id, status)`
- **RLS**: `organization_id = app.current_org_id`

## 8.19 comments (polymorphic)

On `task_occurrence | exception | corrective_action`.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| subject_type | comment_subject_type | NOT NULL |
| subject_id | uuid | NOT NULL (id of the subject row; FK not enforceable across types — validated at app layer) |
| body | text | NOT NULL |
| author_id | uuid | NOT NULL, FK -> users.id |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `author_id`
- **Indexes**: `(organization_id, subject_type, subject_id, created_at)` (thread render)
- **RLS**: `organization_id = app.current_org_id`

## 8.20 activity_log (append-only, hash-chained)

Immutable, polymorphic, org-scoped. Records **every state transition and every edit** (before/after + reason + actor). Optional per-org hash chain for tamper-evidence.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| seq | bigint | NOT NULL (monotonic per-org sequence; ordering + chain position) |
| subject_type | activity_subject_type | NOT NULL |
| subject_id | uuid | NOT NULL |
| action | text | NOT NULL (e.g. 'occurrence.completed', 'completion.edited', 'exception.opened') |
| actor_user_id | uuid | NULL, FK -> users.id (null = system/job actor) |
| actor_label | text | NULL ('system:overdue-sweep', 'system:generator') |
| before_json | jsonb | NULL (prior state for edits) |
| after_json | jsonb | NULL (new state) |
| reason | text | NULL (required for compliance edits) |
| prev_hash | text | NULL (hash of previous row in this org's chain) |
| row_hash | text | NOT NULL (sha256 over canonicalized row + prev_hash; tamper-evident) |
| created_at | timestamptz | NOT NULL DEFAULT now() (**append-only: no updated_at/deleted_at**) |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `actor_user_id`
- **Unique**: `UNIQUE (organization_id, seq)` (dense per-org sequence, drives chain)
- **Indexes**: `(organization_id, subject_type, subject_id, seq)` (timeline for an entity); `(organization_id, created_at)` (org activity feed); `(organization_id, action, created_at)`
- **RLS**: `organization_id = app.current_org_id`; **append-only — INSERT-only policy + trigger raising on UPDATE/DELETE.** The insert path (SECURITY DEFINER function) computes `seq`, `prev_hash`, `row_hash` atomically so the chain cannot be forged from application code.

## 8.21 notifications

Per user, per event; in-app first, email optional. Digest/batching to avoid spam.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| user_id | uuid | NOT NULL, FK -> users.id (recipient) |
| channel | notification_channel | NOT NULL (in_app / email) |
| event_type | text | NOT NULL ('occurrence.overdue', 'exception.opened', 'corrective.due', …) |
| subject_type | activity_subject_type | NULL (deep-link target) |
| subject_id | uuid | NULL |
| title | text | NOT NULL |
| body | text | NULL |
| status | notification_status | NOT NULL DEFAULT 'pending' |
| read_at | timestamptz | NULL |
| sent_at | timestamptz | NULL (email dispatch time) |
| dedupe_key | text | NULL (batching/digest collapse key) |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `user_id`
- **Indexes**: `(organization_id, user_id, status, created_at)` (unread badge / inbox); `(status, channel)` partial where `status='pending'` (dispatch worker pickup); `(organization_id, dedupe_key)` (digest collapse)
- **Unique**: partial `UNIQUE (organization_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL` (idempotent digest)
- **RLS**: `organization_id = app.current_org_id`

## 8.22 export_jobs

`queued → processing → completed → failed`. Produces an `audit_pack`.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| requested_by | uuid | NOT NULL, FK -> users.id |
| format | export_format | NOT NULL (pdf/csv) |
| status | export_status | NOT NULL DEFAULT 'queued' |
| filters_json | jsonb | NOT NULL (date range, property/outlet ids, check_type, pass/fail — the query used) |
| audit_pack_id | uuid | NULL, FK -> audit_packs.id (set on completion) |
| error | text | NULL (failure detail) |
| started_at / finished_at | timestamptz | NULL |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `requested_by`, `audit_pack_id`
- **Indexes**: `(organization_id, status, created_at)` (export history list); `(status)` partial where `status IN ('queued','processing')` (Inngest worker pickup)
- **RLS**: `organization_id = app.current_org_id`

## 8.23 audit_packs

The generated file record + the metadata/filters snapshot used to build it. Delivered via short-lived signed R2 URL through `GET /api/exports/:id/download`.

| Column | Type | Constraints/Notes |
|---|---|---|
| id | uuid | PK, UUID v7 |
| organization_id | uuid | NOT NULL, FK -> organizations.id |
| export_job_id | uuid | NOT NULL, FK -> export_jobs.id |
| attachment_id | uuid | NOT NULL, FK -> attachments.id (R2 object holding the PDF/CSV) |
| format | export_format | NOT NULL |
| filters_snapshot_json | jsonb | NOT NULL (immutable copy of what was exported — reproducibility) |
| record_count | int | NULL (occurrences/completions included) |
| chain_head_hash | text | NULL (activity_log row_hash at export time — proves scope integrity) |
| generated_at | timestamptz | NOT NULL DEFAULT now() |
| expires_at | timestamptz | NULL (retention/GDPR purge boundary) |
| created_at / updated_at / deleted_at | timestamptz | conventions |

- **Primary key**: `id`
- **Foreign keys**: `organization_id`, `export_job_id`, `attachment_id`
- **Indexes**: `(organization_id, generated_at)` (audit-pack history); `(organization_id, export_job_id)`
- **RLS**: `organization_id = app.current_org_id`

---

## 8.24 How the schema supports the key capabilities

| Capability | Schema mechanism |
|---|---|
| **Recurring occurrence generation** | `scheduled_tasks.recurrence_json` (typed) + `time_of_day` + `timezone` snapshot; generator materializes `task_occurrences` ~3 days ahead; **`UNIQUE (scheduled_task_id, occurrence_local_date)`** makes generation idempotent. Job scan uses `scheduled_tasks(is_active, ends_on)`. |
| **DST-safe due times** | `occurrence_local_date` (date) + `time_of_day` resolved through `timezone` (IANA) → `due_at` stored as UTC `timestamptz`. Wall-clock is computed in the property tz at generation, so DST shifts are correct. |
| **Today dashboard (fast)** | `task_occurrences` composite index `(organization_id, property_id, outlet_id, occurrence_local_date, status)` — a single scoped, date-bounded range scan; denormalized `check_type`, `task_template_id`, `assignee_user_id`, `completed_at` avoid joins for the list render. |
| **Overdue sweep (fast)** | Partial index `task_occurrences(status, due_at) WHERE status IN ('scheduled','due')` — the ~10-min sweep finds `due_at + grace_minutes < now()` cheaply and flips → `due`/`overdue`, emitting notifications + activity_log. Runs under system role. |
| **Evidence + R2 attachments** | `evidence.attachment_id → attachments.r2_key` (org-prefixed key); `POST /api/uploads` issues presigned PUT and inserts a `pending` attachment; finalize sets `status='uploaded'`, `byte_size`, `checksum_sha256`. |
| **Immutable audit trail** | `activity_log` append-only (INSERT-only RLS + trigger), per-org `seq`, `prev_hash`/`row_hash` chain (toggled by `organizations.hash_chain_enabled`); `task_completions` + `evidence` immutable, edits create new `version` rows with `supersedes_id` and `edit_reason`. |
| **Export history** | `export_jobs` (state machine + `filters_json`) → `audit_packs` (`filters_snapshot_json`, `record_count`, `chain_head_hash`, R2 `attachment_id`); history via `(organization_id, generated_at)`. |
| **Notifications** | `notifications` per user/channel; dispatch worker pickup via partial `(status, channel) WHERE status='pending'`; `dedupe_key` + partial unique for digest/batching. |
| **Multi-property orgs** | `organization_id` on every table + `property_id`/`outlet_id` denormalized on operational tables; `memberships.property_scope uuid[]` for property-scoped roles; Auditor read-only via role. |
| **Timezones** | `properties.timezone` is source of truth; snapshotted onto `scheduled_tasks.timezone` and `task_occurrences.timezone` so historical due-time computation is stable even if a property's tz is later corrected. |
| **Localization later** | `default_locale` (org), `users.locale`, `*_i18n jsonb` on `template_library` and `task_templates`; `country_code` on properties/library drives DE/NL starter-pack selection. No migration needed to add NL/EN strings. |
| **Multi-tenancy / defense-in-depth** | `organization_id` leading every composite index + RLS `organization_id = app.current_org_id` FORCED on all tenant tables; a large tenant can later be lifted to a dedicated DB since org_id is the partition key. |

### Most important indexes (call-outs)

1. **Today dashboard**: `task_occurrences (organization_id, property_id, outlet_id, occurrence_local_date, status)` — the single most-hit read path; keep it covering via the denormalized columns.
2. **Overdue sweep**: `task_occurrences (status, due_at) WHERE status IN ('scheduled','due')` — small, hot partial index scanned every ~10 minutes.
3. **Idempotent generation**: `task_occurrences UNIQUE (scheduled_task_id, occurrence_local_date)`.
4. **Current completion guard**: `task_completions UNIQUE (task_occurrence_id) WHERE is_current` — enforces the 0..1 current completion per occurrence while preserving all versions.
5. **Open exceptions**: `exceptions (organization_id, status, opened_at)` and **overdue corrective actions**: `corrective_actions (organization_id, status, due_at)`.
6. **Audit timeline**: `activity_log (organization_id, subject_type, subject_id, seq)` + `UNIQUE (organization_id, seq)` for the hash chain.

---

# 9. Recurring task scheduling design

Shift Ledger's scheduling engine exists to answer "what must happen today" with zero ambiguity and zero runtime guesswork. The design principle: **materialize occurrences ahead of time so the Today dashboard is a cheap indexed read, never a recurrence computation.** No RRULE is ever evaluated at page-load. The dashboard is a `SELECT` over `task_occurrence` filtered by org/outlet/local-date and status.

## 9.1 What a schedule is

A `ScheduledTask` binds a `TaskTemplate` to an `Outlet` and carries:

| Field | Purpose |
|---|---|
| `recurrence` (typed JSON) | `{ freq: daily\|weekly\|monthly, interval: int, byWeekday?: int[], byMonthDay?: int[], timeOfDay: "HH:mm" }` |
| `timezone` (IANA) | Inherited/denormalized from the `Property` (e.g. `Europe/Berlin`, `Europe/Amsterdam`) |
| `assignment` | Either `role` (e.g. KitchenManager) OR a specific `userId` — mutually exclusive |
| `grace_minutes` | Window after `due_at` before an occurrence flips to `overdue` (default 30) |
| `active_from` / `active_until` | Bounds; supports pausing without deleting |
| `version` | Monotonic integer; every schedule edit increments it (see 9.7) |

We deliberately store a **typed recurrence object, not a raw iCal RRULE string.** The MVP supports exactly three frequencies. A typed shape is Zod-validatable, renders to a human sentence trivially ("Every weekday at 06:00"), and forecloses the infinite-complexity RRULE surface we do not want. This is a deliberate scope refusal: no cron expressions, no "every 2nd Tuesday except holidays" builder. That is workflow-builder bloat.

## 9.2 Occurrence materialization — the rolling 3-day window

A `TaskOccurrence` is one concrete instance for one `occurrence_local_date`. It stores a `due_at` (UTC), a denormalized `timezone`, `org_id`/`property_id`/`outlet_id`, `status`, and a snapshot of the resolved assignment.

**We materialize a rolling ~3-day window ahead** (today + next 2 local days). Why 3 and not 30 or 90:

- **Short enough** that edits to a schedule affect almost no already-materialized future rows (see 9.7), keeping "edit the future" cheap and clean.
- **Long enough** to survive a failed or delayed generation run: if the daily job misfires at 00:00, we still have 2 days of runway before the Today dashboard is empty, and the 10-minute sweep plus generation retries close the gap. A 1-day window would make a single missed job a same-day outage.
- **Bounded write volume**: occurrence rows stay proportional to active schedules × 3, not × 90 — cheaper storage, and DST/timezone/schedule edits touch a tiny frontier.

Occurrences are the durable record of "this was supposed to happen." They are never deleted for reporting purposes — a skipped or cancelled occurrence is retained with a status, so "what was missed" is answerable historically.

## 9.3 The two Inngest jobs

Per spine item 11, all scheduling is durable Inngest functions, not raw Vercel Cron (we need retries and fan-out).

### 9.3.1 Daily generator — `scheduling/generate-occurrences`
- **Cron:** hourly (`0 * * * *`), not once-daily. Because properties span multiple IANA timezones, "local midnight" happens at different UTC instants. An hourly generator lets each schedule extend its window as its own local day rolls over, and makes the job naturally idempotent and self-healing.
- **Logic:** fan-out per active `ScheduledTask`. For each, compute the set of `occurrence_local_date` values that should exist within `[today_local, today_local + 2]` in the schedule's timezone, evaluate the recurrence against each candidate date, compute `due_at`, and **upsert**.
- **Idempotency:** `UNIQUE(scheduled_task_id, occurrence_local_date)`. Generation is an upsert on that key — re-running the job creates nothing new. See 9.4.

### 9.3.2 Overdue sweep — `scheduling/sweep-overdue`
- **Cron:** every 10 minutes (`*/10 * * * *`).
- **Logic:** a single tenant-agnostic query transitions occurrences where `status = 'due'` AND `now() > due_at + grace_minutes` → `overdue`. Each transition writes an `activity_log` entry and enqueues a `notification.dispatch` event (batched/digested per spine item 12, so one late person does not get 40 pings).
- **Why a sweep, not per-occurrence timers:** one indexed query every 10 minutes over the small live window is far cheaper and more durable than scheduling millions of individual delayed jobs. The index `(organization_id, status, due_at)` makes this a bounded scan.

**Occurrence lifecycle:**

| Status | Meaning | Set by |
|---|---|---|
| `scheduled` | Materialized, before its local day / not yet actionable | generator |
| `due` | Actionable now (within its day, at/after surfacing time) | generator/sweep |
| `overdue` | Past `due_at + grace`, no completion | sweep |
| `completed` | Has a passing `TaskCompletion` | completion server action |
| `failed` | Has a failing completion (spawns Exception) | completion server action |
| `skipped` | Intentionally skipped with reason | user action |
| `cancelled` | Voided (e.g. outlet closed that day) with reason | user action |

`skipped` and `cancelled` **require a reason string** and both write an `activity_log` entry with actor. They are never a silent delete — "what was missed vs. what was legitimately skipped" must be distinguishable in the audit pack.

## 9.4 Avoiding duplicate occurrences

Two defenses:

1. **DB-level:** `UNIQUE(scheduled_task_id, occurrence_local_date)`. This is the hard guarantee. Two concurrent generator runs (e.g. a retry overlapping the next hourly tick) cannot both insert the same day.
2. **App-level:** generation is an **idempotent upsert** keyed on that constraint — `INSERT ... ON CONFLICT (scheduled_task_id, occurrence_local_date) DO NOTHING`. Crucially, **conflict = do nothing, never overwrite.** An existing occurrence may already be `completed` or `failed`; regeneration must never reset it. The generator only ever creates missing future rows.

## 9.5 Timezone handling

- **Source of truth:** IANA timezone on the `Property`, denormalized onto `ScheduledTask` and onto each `TaskOccurrence` at materialization. Storing it on the occurrence means a completed record forever knows the local context it was due in, even if the property later moves timezones.
- **Computing `due_at`:** the `occurrence_local_date` + `recurrence.timeOfDay` is a **local wall-clock** value. We interpret it in the schedule's IANA tz and convert to a UTC instant at generation time. All storage and comparison is UTC; all display is converted back to the occurrence's stored tz.
- **Changing a property's timezone:** we **only regenerate FUTURE, unmaterialized occurrences.** Already-materialized occurrences (especially anything `completed`/`failed`/`overdue`) keep their original `due_at` and stored tz — rewriting history would corrupt the audit trail. Concretely: bump the schedule version, let the generator produce the next window under the new tz, and leave the existing frontier alone (or, at most, recompute only rows still in `scheduled`/`due` state that lie strictly in the future — never a past or acted-upon row).

## 9.6 DST handling

Because we convert local wall-clock → UTC via a real IANA tz library (not fixed offsets), DST is handled correctly by construction, with two edge cases made explicit:

- **Spring-forward gap** (e.g. `02:30` on the DE spring transition does not exist): if a schedule's `timeOfDay` lands in the skipped hour, we **roll forward to the first valid instant** (the moment the clock jumps to). The occurrence still exists that day; it is not silently dropped.
- **Fall-back overlap** (e.g. `02:30` occurs twice): we **choose the first (earlier) UTC occurrence** deterministically. We never materialize two occurrences for one local date — the `UNIQUE(scheduled_task_id, occurrence_local_date)` constraint enforces exactly one, and picking the earlier instant is the safe "task is due no later than expected" choice.

Kitchen tasks are almost always at 06:00 / 22:00 etc., so these cases are rare — but the rule is defined, not left to chance.

## 9.7 Editing the schedule without corrupting the past

Editing a `ScheduledTask` (new time, new recurrence, reassignment, pause) is **versioned, never destructive:**

1. The edit **increments `version`** and writes an `activity_log` entry capturing before/after + actor + reason.
2. **Already-materialized occurrences are never rewritten.** Anything `completed`, `failed`, `overdue`, `skipped`, or `cancelled` is immutable historical fact. Anything still `scheduled`/`due` and strictly in the future *may* be regenerated to reflect the new schedule (we delete-and-recreate only pristine, un-acted-upon future rows within the window, or simply let them stand and apply the change from the next window forward — the conservative default).
3. Because the materialization window is only ~3 days, the "future frontier" affected by any edit is tiny. This is the payoff of the short window from 9.2: schedule edits are cheap and cannot reach backward into audit records.

Deleting/deactivating a schedule sets `active_until` (soft pause) rather than hard-deleting, so historical occurrences and their evidence remain attached and exportable. **A ScheduledTask that has ever produced occurrences is never hard-deleted.**

---

# 10. Evidence and audit trail design (CRITICAL)

This is the heart of the product's value proposition: **"can I prove it happened?"** The governing rule, stated once and enforced everywhere: **there is NO silent modification of a completed compliance record.** Every completion is immutable; every "edit" is a new version plus an append-only log entry; every state change is recorded with actor, timestamp, and context.

## 10.1 Evidence types

A `TaskCompletion` has one or more `Evidence` rows. Evidence type is driven by the `TaskTemplate`'s required-evidence config, so the frontline user is prompted for exactly what the check demands.

| Evidence type | Payload | Typical check | Attachment? |
|---|---|---|---|
| `note` | free text | any | no |
| `photo` | image in R2 | cleaning, closing | yes (Attachment) |
| `temperature` | numeric value + unit, compared to template threshold | temperature (fridge ≤ 4°C) | no |
| `checkbox` | boolean confirmation | opening/closing steps | no |
| `initials` / `signature` | typed initials or drawn signature stroke image | sign-off, allergen verification | optional (Attachment for drawn) |
| `corrective_action_note` | text tied to a CorrectiveAction | failed-check remediation | no |
| `file` | arbitrary document in R2 (e.g. supplier delivery sheet PDF) | generic | yes (Attachment) |

Threshold logic (e.g. `temperature > 4°C` → fail) lives in the completion server action against the template's target config and sets pass/fail, which drives `completed` vs `failed` and spawns an `Exception` on fail.

## 10.2 What every completion preserves

For each `TaskCompletion` version we persist:

| Captured | Detail |
|---|---|
| **Who** | `actor_user_id` + resolved membership role at time of action |
| **When (UTC)** | `completed_at` server-authoritative UTC timestamp |
| **When (local)** | occurrence's stored IANA tz → local wall-clock, for the audit pack |
| **Where** | denormalized `org_id`, `property_id`, `outlet_id` (from the occurrence) |
| **Device metadata** | user-agent, platform, app version, client-reported capture time, coarse locale — stored as a metadata JSON blob |
| **Entered values** | e.g. measured temperature, checkbox states, note text |
| **Pass/fail** | evaluated against template threshold |
| **Evidence** | child `Evidence` rows + any `Attachment` links |
| **Version lineage** | `version`, `supersedes_completion_id`, `superseded_by_completion_id` |
| **Edit reason** | required free-text reason on any version after the first |

## 10.3 The append-only activity_log

Per spine item 9, `activity_log` is **append-only: no UPDATE, no DELETE.** Enforced by two independent mechanisms so a bug or a compromised app credential cannot rewrite history:

1. **Postgres trigger** that raises on any `UPDATE`/`DELETE` against the table.
2. **RLS policy** granting `INSERT`/`SELECT` only (no update/delete) to the application role.

Each row is org-scoped and polymorphic over its subject:

| Column | Purpose |
|---|---|
| `id` | UUID v7 (time-sortable) |
| `organization_id` | tenant scope (RLS + index lead) |
| `actor_user_id` | who (nullable for system/job actors, which are labelled) |
| `subject_type` / `subject_id` | polymorphic target (Occurrence, Completion, Exception, CorrectiveAction, ScheduledTask, ExportJob…) |
| `verb` | e.g. `completion.created`, `completion.edited`, `occurrence.overdue`, `occurrence.skipped`, `exception.opened`, `corrective_action.verified`, `export.generated` |
| `before` / `after` | JSON snapshots for edits |
| `reason` | required for edits/skips/cancels |
| `metadata` | device/job context |
| `created_at` | UTC |
| `prev_hash` / `hash` | optional per-org hash chain |

### Per-org hash chain (tamper-evidence)
Optional but recommended for inspection-grade proof: each new row's `hash = SHA-256(prev_hash ‖ canonical(row payload))`, where `prev_hash` is the hash of the previous log row **for that organization**. Any retroactive tampering breaks the chain from that point forward, which an export/verification pass can detect. This is tamper-**evidence**, not tamper-**prevention** — combined with the trigger + RLS it gives a strong, auditable story without a blockchain or external notary (explicitly out of scope for MVP).

## 10.4 Completion versioning / edit history

Completions and Evidence are **immutable**. An "edit" (e.g. a chef fat-fingered `40°C` instead of `4.0°C`) does the following in one transaction:

1. Insert a **new `TaskCompletion` version row** with `version = n+1`, `supersedes_completion_id = <old>`, the corrected values, a **required `edit_reason`**, and fresh actor/timestamp/device metadata.
2. Set the old row's `superseded_by_completion_id` — this is the **only** field ever written on an existing completion, and it is a forward pointer, not a value mutation (implemented as a versioning link, never touching the recorded compliance values). The original entered values, evidence, actor, and timestamp remain exactly as captured.
3. Write an `activity_log` `completion.edited` entry with `before`/`after` + reason + actor.
4. The occurrence points at the **current** version; the full chain is walkable for the audit pack, which renders "Original: 40°C (entered by X at T1) — Corrected to: 4.0°C (by Y at T2, reason: 'typo')".

So the audit pack shows both the value that stands and the fact that it was changed, by whom, when, and why. Nothing disappears.

## 10.5 File storage design (R2)

Binary evidence (photos, drawn signatures, file attachments) lives in Cloudflare R2 (spine item 7), never in Postgres and never served directly from the app.

- **Upload flow:** client requests a presigned PUT via `POST /api/uploads` (the thin REST surface); uploads directly to R2; the returned object key + content hash + size + MIME are recorded in an `Attachment` row linked to the `Evidence`.
- **Key layout:** `org/{org_id}/property/{property_id}/outlet/{outlet_id}/completion/{completion_id}/{evidence_id}-{content_sha256}.{ext}`. Org-prefixed for clean per-tenant lifecycle/lift-out and for scoping any future bucket policies.
- **Content hash:** SHA-256 of the bytes stored on the `Attachment`. Serves integrity verification (the audit pack can assert the file is unchanged) and cheap dedupe.
- **Limits (enforced at presign time via Zod):** images ≤ 10 MB, documents ≤ 25 MB; MIME allowlist (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`). Reject everything else. No executables, no arbitrary blobs.
- **EXIF / GPS handling:** on ingest we **strip EXIF/GPS metadata** from photos by default (GDPR data-minimization — we do not want incidental geolocation of staff), while **preserving the capture timestamp into our own metadata field** where present. Server-authoritative `completed_at` remains the record of truth regardless of client EXIF.
- **Access:** download only via **short-lived presigned GET** (e.g. 5-minute TTL) issued through `GET /api/exports/:id/download` or an evidence-view endpoint after tenant authorization. Files are never public.

## 10.6 How the PDF export references evidence

The audit pack (spine item 10, `@react-pdf/renderer`, async Inngest job) is the inspection-ready artifact:

- For each occurrence in the filtered range it renders: task, outlet, due (local + UTC), status, actor, completion values, pass/fail, exceptions + corrective actions, and the **activity-log trail**.
- **Photos/signatures are embedded as thumbnails** fetched from R2 at render time (in the job, server-side) so the PDF is self-contained and viewable offline by an inspector.
- For full-resolution originals the pack includes **short-lived signed URLs** and the **content SHA-256** next to each, so a reviewer can fetch and independently verify integrity. (Signed URLs expire; the hash is the durable proof.)
- If the hash chain is enabled, the pack includes a **chain-verification summary** ("N records, chain intact through <hash>").
- The finished PDF is stored back in R2 as an `AuditPack`, downloaded via short-lived signed URL. The `ExportJob` record captures the exact filters/date-range/actor so an export is itself reproducible and logged (`export.generated`).

## 10.7 Retention policy

HACCP-style food-safety documentation is the product's reason to exist, so retention is generous and configurable per org within bounds:

| Data class | Recommended retention | Rationale |
|---|---|---|
| Compliance records (Occurrence, Completion, Evidence, Exception, CorrectiveAction, activity_log) | **3 years minimum, default configurable up to longer** | EU food-hygiene documentation practice; survives an inspection/audit cycle. We recommend a floor of 3 years and let ops managers extend. |
| Evidence binaries in R2 | same as their parent compliance record | must travel with the record |
| Export packs (AuditPack) | 1 year (regenerable on demand from source records) | they are derived artifacts |
| Notifications | 90 days | operational, not compliance |
| Auth sessions | Better Auth defaults | operational |

Retention is enforced by a scheduled Inngest deletion job that only acts on data **past its retention horizon**, and only on non-legal-hold records.

## 10.8 GDPR considerations (DE / NL)

- **EU residency:** Neon EU region + R2 EU jurisdiction (spine item 7 / 15). No compliance data leaves the EU. DPA-ready.
- **Personal data in evidence:** staff **initials/signatures, actor identity, device metadata, and any EXIF** are personal data. We minimize (strip GPS/EXIF by default, coarse locale only) and we surface these only to authorized roles within the tenant.
- **Data-subject rights vs. legal-record retention — the key tension:** a food-safety record signed by a staff member is a **legal/operational document**; the right to erasure does **not** automatically override the controller's retention obligation for compliance evidence. Our stance: on an erasure request we **pseudonymize the actor's directly-identifying fields** (name/email → a stable internal actor id / "Former staff #NNN") while **preserving the compliance record, the initials as recorded, and the audit chain.** The proof that a check happened, and by which role, is retained; the person's contact-level PII is severed. This is standard controller practice for records held under a legal-basis retention obligation and keeps the hash chain intact (we never delete log rows).
- **Access / portability:** data-subject access and export are served per-org from the same tenant-scoped queries; because everything is org-partitioned, a subject's activity is retrievable.
- **Compliance stance restated (spine item 15):** Shift Ledger provides **documentation and operational proof**, not legal compliance certification. The audit pack is evidence a manager/inspector can rely on; it is explicitly not a certificate of legal HACCP compliance.

**Restated, because it is the product:** completed compliance records are never silently modified. Every correction is a new version; every state change is an append-only, optionally hash-chained log entry with actor, timestamp, and reason.

---

# 11. API design

Per spine item 2, REST is the **canonical logical contract** for the domain. In the MVP, **most of these operations are implemented internally as typed Next.js Server Actions** (colocated with UI, Zod-validated, RSC-read / action-write). A thin real HTTP surface exists only where a call must originate outside React: `POST /api/uploads` (signed PUT issuance), `GET /api/exports/:id/download` (signed GET redirect), `POST /api/cron/*` (Inngest triggers), and webhooks. The paths below are the stable names those operations expose (and the shape a future mobile/public API will honor); read "endpoint" as "Server Action unless marked **[HTTP]**".

**Conventions applied to every group (stated once):**
- **Tenant scope:** every request resolves `organization_id` from the Better Auth session/active org; app-level scoping + Postgres RLS (`app.current_org_id`) enforce it. No endpoint accepts a cross-org id it cannot see.
- **IDs:** UUID v7, db-generated.
- **Auth requirement notation:** role is the *minimum* org role; property/outlet-scoped roles additionally require the resource to be in the member's property scope.
- **Common errors (baseline, omitted per-row unless notable):** `401 UNAUTHENTICATED`, `403 FORBIDDEN` (role/scope), `404 NOT_FOUND` (or masked as 404 for cross-tenant), `409 CONFLICT`, `422 VALIDATION_ERROR` (Zod), `429 RATE_LIMITED`.
- **Immutability:** compliance writes (`complete`, `fail`, evidence) never UPDATE; edits create versions + `activity_log` rows (spine item 9).

## 11.1 Auth / session

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/api/me` **[HTTP]** | – | `{ user, memberships[], activeOrgId }` | authenticated | – | 401 |
| POST | `/api/session/switch-org` **[HTTP]** | `{ organizationId }` | `{ activeOrgId, role, propertyScope[] }` | member of target org | must be an org the user belongs to | 403 if not a member |
| POST | `/api/auth/*` **[HTTP]** | Better Auth handlers (sign-in, sign-out, invitation accept) | Better Auth responses | per Better Auth | – | – |

## 11.2 Organizations

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| POST | `/orgs` | `{ name, country: DE\|NL, timezoneDefault }` | `{ organization }` | authenticated (creator becomes Owner) | `name` 2–80; `country` in {DE,NL} | 409 slug taken |
| GET | `/orgs/:id` | – | `{ organization, counts }` | member | – | 404 |
| PATCH | `/orgs/:id` | `{ name?, country?, timezoneDefault?, retentionMonths? }` | `{ organization }` | Owner \| OrgAdmin | `retentionMonths` 6–120 | 403 |

## 11.3 Properties (Sites)

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/properties` | query: `?includeArchived` | `{ properties[] }` | member (scoped list) | – | – |
| POST | `/properties` | `{ name, address?, timezone (IANA) }` | `{ property }` | Owner \| OrgAdmin | valid IANA tz; `name` 2–80 | 422 bad tz |
| PATCH | `/properties/:id` | `{ name?, address?, timezone? }` | `{ property }` | Owner \| OrgAdmin \| PropertyManager (in scope) | tz change warns (does not rewrite past occurrences) | 403/404 |
| POST | `/properties/:id/archive` | `{ archived: bool }` | `{ property }` | Owner \| OrgAdmin | cannot archive with active future occurrences unless `force` | 409 has-active |

## 11.4 Outlets (Kitchens)

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/properties/:pid/outlets` | `?includeArchived` | `{ outlets[] }` | member (scoped) | – | – |
| POST | `/properties/:pid/outlets` | `{ name, type? }` | `{ outlet }` | Owner \| OrgAdmin \| PropertyManager | `name` 2–80 | 404 property |
| PATCH | `/outlets/:id` | `{ name?, type? }` | `{ outlet }` | Owner \| OrgAdmin \| PropertyManager | – | 403/404 |
| POST | `/outlets/:id/archive` | `{ archived }` | `{ outlet }` | Owner \| OrgAdmin \| PropertyManager | pauses attached schedules | 409 has-active |

## 11.5 Users / members

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/members` | `?role&propertyId` | `{ members[], invitations[] }` | PropertyManager+ | – | – |
| POST | `/members/invite` | `{ email, role, propertyScope?: propertyId[] }` | `{ invitation }` | Owner \| OrgAdmin (any role); PropertyManager (only ShiftLeader/Staff/Auditor in own scope) | valid email; role in enum; PM cannot grant ≥ own | 409 already member/invited |
| POST | `/members/:id/change-role` | `{ role, propertyScope? }` | `{ member }` | Owner \| OrgAdmin | cannot demote last Owner | 409 last-owner |
| POST | `/members/:id/deactivate` | `{ active: bool }` | `{ member }` | Owner \| OrgAdmin | cannot deactivate self if last Owner | 409 |

Roles enum: `Owner, OrgAdmin, PropertyManager, KitchenManager, ShiftLeader, Staff, Auditor`. `Auditor` is read-only everywhere (all write endpoints return 403).

## 11.6 Task templates

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/templates` | `?includeArchived&checkType` | `{ templates[] }` | member | – | – |
| GET | `/template-library` | `?country` | `{ libraryTemplates[] }` (curated DE/NL HACCP starters) | member | – | – |
| POST | `/templates` | `{ name, checkType, requiredEvidence[], thresholdConfig?, instructions?, fromLibraryId? }` | `{ template }` | KitchenManager+ | `checkType` in {temperature,cleaning,allergen,opening,closing,generic}; `thresholdConfig` required iff `temperature` (e.g. `{op:"lte", value:4, unit:"C"}`) | 422 threshold-missing |
| PATCH | `/templates/:id` | `{ name?, requiredEvidence?, thresholdConfig?, instructions? }` | `{ template }` (new version; existing occurrences keep their snapshot) | KitchenManager+ | `checkType` immutable | 409 in-use-immutable-field |
| POST | `/templates/:id/archive` | `{ archived }` | `{ template }` | KitchenManager+ | blocks new schedules; existing keep running | – |

## 11.7 Schedules

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/schedules` | `?outletId&paused` | `{ schedules[] }` | member (scoped) | – | – |
| POST | `/schedules` | `{ templateId, outletId, recurrence, timeOfDay, assignment: {kind:"role"\|"user", value} }` | `{ schedule }` (triggers generation for rolling window) | KitchenManager+ (in scope) | `recurrence` = `{freq:daily\|weekly\|monthly, interval≥1, byWeekday?, byMonthDay?}`; `timeOfDay` `HH:mm`; tz inherited from property | 422 bad-recurrence |
| PATCH | `/schedules/:id` | `{ recurrence?, timeOfDay?, assignment? }` | `{ schedule }` | KitchenManager+ | changes apply to **future** occurrences only; past immutable | 409 |
| POST | `/schedules/:id/pause` | `{ paused: bool }` | `{ schedule }` | KitchenManager+ | pausing halts generation; keeps existing occurrences | – |
| DELETE | `/schedules/:id/future` | `{ fromDate? }` | `{ deletedCount }` | KitchenManager+ | deletes only **future, uncompleted** occurrences | 409 has-completions-after |

Recurrence materialization (spine item 8) is not an API call — Inngest generates a rolling ~3-day window, idempotent on `UNIQUE(scheduled_task_id, occurrence_local_date)`.

## 11.8 Task occurrences

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/occurrences/today` | `?outletId&status` | `{ occurrences[] }` grouped by outlet; each `{ id, template, dueAt, status, assignee, thresholdConfig }` | member (scoped) | resolves "today" per property tz | – |
| GET | `/occurrences` | `?date&outletId&status&from&to` | `{ occurrences[] }` | member (scoped) | date range ≤ 92 days | 422 range-too-wide |
| GET | `/occurrences/:id` | – | `{ occurrence, completion?, exception?, timeline[] }` | member (scoped) | – | 404 |
| POST | `/occurrences/:id/complete` | `{ values?: {temperature?, ...}, evidence[]: EvidenceRef[], note?, deviceMeta }` | `{ completion }` (immutable, v1) | Staff+ (assignee role/user or KitchenManager+) | required evidence present; if `temperature` template, value present and **auto-evaluated vs threshold** | 409 already-completed; 422 missing-evidence |
| POST | `/occurrences/:id/fail` | `{ values?, reason, evidence[], deviceMeta }` | `{ completion(pass=false), exception }` (auto-creates Exception) | Staff+ | `reason` required | 409 already-completed |
| POST | `/occurrences/:id/skip` | `{ reason }` | `{ occurrence(status=skipped) }` | KitchenManager+ | `reason` 3–500 | 409 |
| POST | `/occurrences/:id/reopen` | `{ reason }` | `{ occurrence, newVersion }` | KitchenManager+ only | allowed within **24h** of completion & before included in a finalized export; writes new version + activity_log | 409 export-locked / 403 window-expired |

Status enum: `scheduled → due → overdue` (sweep job) `→ completed | failed | skipped`. `complete`/`fail` auto-set `passed`; a temperature reading outside `thresholdConfig` forces the `fail` path even if submitted via `complete`.

## 11.9 Evidence

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| POST | `/api/uploads` **[HTTP]** | `{ contentType, byteSize, kind: photo\|file\|signature }` | `{ uploadUrl (presigned PUT), attachmentId, expiresIn }` | Staff+ | `contentType` in allowlist (image/jpeg,png,webp,application/pdf); `byteSize` ≤ 15 MB | 422 type/size |
| POST | `/evidence` | `{ completionId?, type, value?, attachmentId? }` | `{ evidence }` | Staff+ | `type` in {note,photo,temperature,checkbox,initials,file}; `attachmentId` required iff photo/file/signature | 422 |
| GET | `/evidence/:id/view` **[HTTP]** | – | `302 →` short-lived presigned GET (≤ 5 min) | member (scoped) or Auditor | – | 404 |

Binary is never proxied through the app (spine item 7): client compresses, PUTs directly to R2, then attaches `attachmentId` to the completion.

## 11.10 Exceptions

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/exceptions` | `?status&outletId&from&to` | `{ exceptions[] }` each `{ occurrence, severity, status, correctiveActions[] }` | member (scoped) | – | – |
| POST | `/exceptions` | `{ occurrenceId, reason, severity? }` | `{ exception }` | Staff+ (usually auto-created by `fail`) | one open exception per occurrence | 409 open-exists |
| POST | `/exceptions/:id/assign` | `{ assigneeUserId }` | `{ exception }` | KitchenManager+ | assignee is org member in scope | 404 |
| POST | `/exceptions/:id/resolve` | `{ resolutionNote }` | `{ exception(status=resolved) }` | KitchenManager+ | requires ≥1 verified CorrectiveAction OR explicit override note | 409 unverified-actions |
| POST | `/exceptions/:id/verify` | `{ verified: bool, note? }` | `{ exception }` | KitchenManager+ \| PropertyManager | – | – |

Exception status: `open → in_progress → resolved → verified` (or `resolved` w/ override).

## 11.11 Corrective actions

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| POST | `/exceptions/:eid/corrective-actions` | `{ description, assigneeUserId, dueAt }` | `{ correctiveAction }` | KitchenManager+ | `dueAt` future; assignee in scope | 422 |
| POST | `/corrective-actions/:id/assign` | `{ assigneeUserId }` | `{ correctiveAction }` | KitchenManager+ | – | 404 |
| POST | `/corrective-actions/:id/complete` | `{ note?, evidence[]? }` | `{ correctiveAction(status=done) }` | assignee \| KitchenManager+ | – | 409 |
| POST | `/corrective-actions/:id/verify` | `{ verified, note? }` | `{ correctiveAction(status=verified) }` | KitchenManager+ (not the completer, where possible) | separation-of-duty warning if self-verify | – |

CorrectiveAction status: `open → done → verified`.

## 11.12 Timeline (activity)

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/timeline` | `?subjectType&subjectId&actorId&from&to&cursor` | `{ entries[], nextCursor }` each `{ id, actor, verb, subject, before?, after?, reason?, at }` | member (scoped); Auditor read | keyset pagination (cursor on `id`) | – |

`activity_log` is append-only (spine item 9): no create/update/delete endpoints — entries are emitted as a side effect of every state transition and versioned edit.

## 11.13 Exports (audit pack)

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| POST | `/exports` | `{ filters: {from, to, propertyId?, outletId[]?, checkType[]?, includeEvidence: bool}, format: pdf\|csv }` | `{ exportJob(status=queued) }` | PropertyManager+ \| Auditor | range ≤ 366 days; at least one property in scope | 422 range |
| GET | `/exports/:id` | – | `{ exportJob: {status, progress, auditPack?, error?} }` | creator \| PropertyManager+ \| Auditor | – | 404 |
| GET | `/api/exports/:id/download` **[HTTP]** | – | `302 →` short-lived presigned GET (≤ 5 min) to R2 object | creator \| PropertyManager+ \| Auditor | only when `status=completed` | 409 not-ready |

ExportJob status: `queued → processing → completed | failed`. Processing is an Inngest job rendering `@react-pdf/renderer` output to R2 (spine items 10–11). Finalized packs **lock** their included occurrences against `reopen`.

## 11.14 Notifications

| Method | Path | Request body | Response | Auth | Validation | Notable errors |
|---|---|---|---|---|---|---|
| GET | `/notifications` | `?unreadOnly&cursor` | `{ notifications[], unreadCount, nextCursor }` | authenticated (own only) | keyset pagination | – |
| POST | `/notifications/mark-read` | `{ ids[]? }` (omit = all) | `{ unreadCount }` | authenticated (own only) | – | – |

Notifications are per-user, generated by Inngest on events (overdue, exception opened, corrective-action assigned/due). In-app first; email via Resend with digest batching (spine item 12).

---

# 12. Frontend application architecture

## 12.1 Routing (App Router route groups)

Two top-level route groups separate unauthenticated shell from the tenant-scoped app. The **active org is a path segment** (`[org]`) so links are shareable, the org is unambiguous server-side, and `switch-org` is just a navigation.

```
(auth)                      → centered card layout, no nav
  /login  /accept-invite  /forgot-password
(app)/[org]                 → authenticated app shell (sidebar/bottom-bar)
  /today                    → default landing (Today dashboard)
  /occurrences/[id]         → task detail + complete/fail flows (modal-routed)
  /exceptions               → list;  /exceptions/[id]
  /corrective-actions       → list;  /corrective-actions/[id]
  /timeline
  /exports                  → list + create;  /exports/[id]
  /settings/templates       /settings/templates/[id]
  /settings/schedules       /settings/schedules/[id]
  /settings/members
  /settings/properties      /settings/properties/[pid]/outlets
  /settings/organization
/select-org                 → org switcher (post-login, no [org] segment)
```

`[org]` resolves to the membership + property scope in the `(app)/[org]/layout.tsx` and seeds the RLS session var for all nested RSC queries. An invalid/forbidden `[org]` → `notFound()`.

## 12.2 Layout hierarchy

- **Root layout:** fonts, theme, Sentry, toast portal, `<html>`.
- **`(auth)` layout:** minimal centered card.
- **`(app)/[org]` layout (RSC):** resolves session + active membership once, renders **desktop sidebar** (≥ md) or **mobile bottom bar** (< md) via CSS/container queries (both rendered, one shown — no layout shift, no JS branch). Holds the notification bell (client island) and org switcher.
- **Section layouts:** `settings/layout.tsx` adds a secondary settings nav; `occurrences/[id]` renders as an **intercepting/parallel route modal** over `/today` on desktop, full page on mobile.

## 12.3 Server vs client components

Default is **RSC**. Client components (`"use client"`) are surgical islands:

| Client island | Why |
|---|---|
| CompleteTaskForm / FailCheckForm | interactive inputs, `useOptimistic`, local draft state |
| TodayList item toggles | optimistic status flip on complete |
| EvidenceUploader | file picker, client-side compression, direct-to-R2 PUT, progress |
| NotificationBell | polling/badge, mark-read |
| CommandMenu (later) | keyboard-driven navigation |
| SignaturePad | canvas capture |
| Date-range / filter controls | client state → URL search params |

Everything else — lists, detail read views, timeline, settings tables, export status — is RSC issuing tenant-scoped Prisma reads.

## 12.4 Data-fetching & mutations

- **Reads:** RSC call Prisma directly (no API round-trip), tenant-scoped by the `[org]` layout. Lists use keyset pagination.
- **Writes:** **Server Actions** (the logical REST ops of §11), Zod-validated, colocated with the form. Actions return typed results for `useOptimistic` / `useActionState`.
- **Invalidation:** actions call `revalidateTag` on granular tags (`today:{outletId}`, `occurrence:{id}`, `exceptions:{org}`, `notifications:{userId}`) and `revalidatePath` for the current route. Completing a task revalidates `today:{outletId}` and `occurrence:{id}` only — not the whole tree.
- **Uploads:** the only client→HTTP path: `POST /api/uploads` → PUT to R2 → attach `attachmentId` in the completion action.

## 12.5 Caching strategy

- Authenticated tenant data is **dynamic / `no-store`** at the fetch level; freshness comes from tag-based revalidation after actions, not time-based ISR.
- **Static/ISR** only for marketing and the curated `template-library` (safe to cache, revalidate daily).
- **Prefetch** Today data: `<Link prefetch>` on nav + `router.prefetch('/[org]/today')` after login so the landing screen is warm.
- Signed R2 URLs are short-lived (≤ 5 min) and never cached.

## 12.6 Loading / error / empty states

- **Loading:** `loading.tsx` per route renders skeletons matching the final layout (Today = outlet-grouped skeleton rows) to avoid CLS. Streaming with `<Suspense>` so the shell + nav paint instantly and lists stream in.
- **Error:** `error.tsx` per section with a retry; global `error.tsx` fallback → Sentry.
- **Empty:** first-class designed empties ("No tasks left today — everything's done", "No open exceptions"). A *clean* Today with everything complete is a **success state**, not a blank.
- **Optimistic-failure:** if an action rejects, revert the optimistic row and toast the reason (e.g. `422 missing-evidence`).

## 12.7 Navigation: mobile vs desktop

- **Mobile (< md), frontline-first:** fixed **bottom bar** — Today, Exceptions, (center) quick-complete, Timeline, Me. Thumb-reachable; large hit targets; no hamburger for primary actions.
- **Desktop (≥ md), manager-first:** left **sidebar** — Today, Exceptions, Corrective actions, Timeline, Exports, Settings; org switcher top, notification bell + user bottom.
- Both driven by the same nav config; the `(app)/[org]` layout picks presentation by breakpoint.

## 12.8 Main screens

Login · Accept-invite · Org switcher · **Today dashboard** (outlet-grouped, due/overdue/done) · Task detail · **Complete-task flow** · **Failed-check flow** (→ auto exception) · Exceptions list/detail · Corrective actions list/detail · Timeline · Audit export (create + status) · Templates (list/edit) · Schedule settings · Member management · Property/outlet settings.

## 12.9 Recommended folder structure

```
src/
  app/
    (auth)/
      login/page.tsx
      accept-invite/page.tsx
    (app)/
      [org]/
        layout.tsx                 # resolves org, seeds RLS, renders shell
        today/
          page.tsx                 # RSC: occurrences/today
          loading.tsx
          @modal/(.)occurrences/[id]/page.tsx   # intercepted detail modal
        occurrences/[id]/page.tsx  # full-page detail (mobile / hard nav)
        exceptions/
        corrective-actions/
        timeline/
        exports/
        settings/
          layout.tsx
          templates/  schedules/  members/  properties/  organization/
    select-org/page.tsx
    api/
      uploads/route.ts
      exports/[id]/download/route.ts
      cron/[...event]/route.ts     # Inngest
      auth/[...all]/route.ts       # Better Auth
  actions/                         # Server Actions (logical REST ops)
    occurrences.ts  exceptions.ts  correctiveActions.ts
    templates.ts  schedules.ts  members.ts  exports.ts  notifications.ts
  components/
    today/  occurrence/  evidence/  nav/  ui/   # ui = design primitives
  lib/
    auth.ts        # Better Auth config
    db.ts          # Prisma client + RLS session helper
    r2.ts          # presign helpers
    inngest/       # job definitions
    validation/    # shared Zod schemas (§11 bodies)
    tenancy.ts     # org/scope resolution
  emails/          # Resend templates
```

## 12.10 Scope guard

The frontend surface stops at the MVP modules. No custom-form builder, no drag-drop workflow designer, no per-customer theming, no nested admin trees — configuration is templates + schedules only, consistent with the "minimal settings" ethos.

---

# 13. UX principles for architecture

The product promise — *every daily action under 10 seconds, critical workflows in 1–2 clicks, a Linear/Stripe feel* — is enforced by concrete architectural choices, not styling.

## 13.1 Optimistic updates (Server Actions + `useOptimistic`)

Completing a task flips the row to **done** instantly in `useOptimistic` state while the Server Action runs; the row settles when the action returns and `revalidateTag('today:{outletId}')` reconciles. On rejection (e.g. missing required evidence) the row reverts and a toast explains why. The frontline user never waits on a spinner for the most common action of their day.

## 13.2 Fast mobile interactions

Bottom-bar primary nav, large thumb targets, and a **center quick-complete** action mean the dominant flow — open Today → tap task → confirm → done — is 1–2 taps. Temperature entry uses a numeric keypad input with the threshold shown inline, so a pass/fail is legible before submit. No modals stacked deeper than one level.

## 13.3 Minimal page reloads

Reads are RSC (no client fetch waterfall); writes are Server Actions with **granular tag revalidation** rather than full-page reloads. Detail views open as **intercepting-route modals** over Today on desktop, so reviewing a task never loses the list's scroll position or context.

## 13.4 Preloaded / prefetched Today data

`<Link prefetch>` on every nav target plus `router.prefetch('/[org]/today')` immediately after login mean the Today screen is warm before it's tapped. Combined with `<Suspense>` streaming (shell + nav paint first, list streams in), perceived load is near-instant.

## 13.5 Local draft state (half-entered survives navigation)

The Complete-task form persists a **local draft** (keyed by `occurrence:{id}`) in the client island — a typed temperature or half-written note survives a modal close, a bottom-bar tab switch, or an accidental back-nav. Drafts are ephemeral client state (not a server write), cleared on successful completion. This directly protects the "kitchen is chaotic, I got interrupted" reality.

## 13.6 Quick image upload (compression + direct-to-R2)

Evidence photos are **compressed client-side** (downscale + re-encode to WebP/JPEG under a size cap) before a **presigned PUT straight to R2** — the app server never proxies bytes (spine item 7). Upload runs in parallel with the user finishing the form; the `attachmentId` is attached on submit. Zero-egress R2 keeps this cheap at photo scale.

## 13.7 Keyboard shortcuts & command menu (later)

MVP ships a few high-value shortcuts on desktop (`g t` → Today, `g e` → Exceptions, `c` → complete focused task, `⌘K` reserved). The **command menu is explicitly post-MVP** (listed as a client island stub) — we reserve `⌘K` and the nav config now so adding it later is additive, not a refactor. No scope creep into a full command palette for launch.

## 13.8 No deep nested settings

Settings is a flat, short list (templates, schedules, members, properties, organization) — no tree, no per-customer config screens. Opinionated defaults (DE/NL HACCP starter templates from the library) mean a new org is productive in minutes. This is the "minimal settings, no bloated admin panels" ethos encoded as information architecture.

## 13.9 Clean audit timeline

The timeline is a single append-only stream (`activity_log`), rendered as a keyset-paginated RSC list: actor · verb · subject · before/after · reason · timestamp. Because every state transition and versioned edit emits one row, the timeline *is* the audit story — no reconstruction, no joins to explain "who changed what and why". This is what makes the export pack trustworthy and the app **inspection-ready** without being a legal-certification claim (spine item 15).

## 13.10 Why this feels like Linear

Instant optimistic state, prefetched landing, modal-routed detail without context loss, keyboard affordances, designed empty states, and sub-second perceived writes combine into a tool that feels like **a fast command center, not enterprise hotel software** — the frontline finishes checks in seconds and the manager gets provable, timestamped evidence for free.

---

# 14. Notification system

## 14.1 Scope and stance

MVP notifications exist to close one loop: **make sure the right person knows what must happen, what slipped, and what needs correcting — without becoming noise.** In-app is the primary channel (a `notification` table read by the app shell), email (Resend) is the secondary channel for high-signal events, and WhatsApp/SMS is explicitly out of MVP.

We ship exactly six event types. No configurable event catalog, no per-event channel matrix in the UI, no marketing/product notifications. That narrowness is a feature.

| Event key | Trigger | Default in-app | Default email | Primary recipients |
|---|---|---|---|---|
| `task.due_soon` | Occurrence enters a lead window before `due_at` | Yes | No | Assigned user, or assigned-role members at the outlet |
| `task.overdue` | Overdue sweep transitions `due → overdue` | Yes | Digest only | Assigned user/role + KitchenManager of the outlet |
| `exception.created` | A completion fails, or a due check is force-failed | Yes | Yes (immediate) | KitchenManager, FoodSafetyManager (PropertyManager role), PropertyManager |
| `corrective_action.assigned` | CorrectiveAction created/assigned | Yes | Yes (immediate) | The CorrectiveAction assignee |
| `corrective_action.overdue` | Sweep finds CA past its `due_at` unverified | Yes | Digest only | CA assignee + KitchenManager |
| `export.ready` | ExportJob transitions to `completed` (or `failed`) | Yes | Yes (immediate) | The requesting user only |

Rationale for the email column: **immediate email is reserved for events that imply someone is blocked or that a compliance failure just occurred** (exception, CA assignment, your own export). Routine "due soon" never emails. Overdue events email only via the batched digest, because a busy service can generate many overdue rows in minutes and per-row email would be spam.

## 14.2 The `notification` table shape

One row per (recipient user, event, subject). Tenant-scoped like every other table; `organization_id` leads every composite index.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid v7 (pk) | db-generated |
| `organization_id` | uuid | tenant partition key; RLS-scoped; leads indexes |
| `property_id` | uuid null | denormalized for property-scoped filtering |
| `outlet_id` | uuid null | denormalized; enables per-outlet digest grouping |
| `recipient_user_id` | uuid | who sees it |
| `event_key` | enum | one of the six above |
| `subject_type` | enum | `TaskOccurrence \| Exception \| CorrectiveAction \| ExportJob` |
| `subject_id` | uuid | polymorphic pointer (no cross-table FK; validated in app) |
| `title` | text | pre-rendered, short (e.g. "Fridge 2 temp check overdue") |
| `body` | text null | one-line context |
| `deep_link` | text | in-app route to the subject |
| `severity` | enum | `info \| warning \| critical` (drives badge color + sort) |
| `dedupe_key` | text | see 14.4; UNIQUE per `(organization_id, dedupe_key)` |
| `read_at` | timestamptz null | null = unread |
| `emailed_at` | timestamptz null | set when an email for this row was dispatched |
| `email_suppressed_reason` | enum null | `actor_self \| quiet_hours \| digest_batched \| pref_off` |
| `created_at` | timestamptz | default now() |

Indexes:
- `UNIQUE (organization_id, dedupe_key)` — the spam guard (14.4).
- `(organization_id, recipient_user_id, read_at, created_at DESC)` — the unread-badge + inbox query.
- `(organization_id, outlet_id, event_key, created_at)` — powers per-outlet digest assembly.

Notifications are **not** compliance records — they are derived, disposable convenience objects. They live outside the immutable audit tier: the authoritative record of "this went overdue / this exception opened" is always the `activity_log` and the domain tables. Notifications may be pruned on a retention schedule (e.g. read + older than 90 days) without touching audit integrity.

## 14.3 Job scheduling (Inngest)

All notification writes are side effects of domain events or scheduled sweeps, dispatched through Inngest (spine item 11). Server Actions do **not** send email inline — they emit an Inngest event and return; the durable function does the fan-out with retries.

| Inngest function | Trigger | What it does |
|---|---|---|
| `occurrence.generate` (cron, daily) | cron | Materializes the rolling ~3-day occurrence window. Does not notify. |
| `occurrence.sweep.due-soon` (cron, ~every 10 min) | cron | Finds occurrences entering the lead window; emits `notify/requested` for `task.due_soon` (in-app only). |
| `occurrence.sweep.overdue` (cron, ~every 10 min) | cron | Transitions `due → overdue`, writes `activity_log`, emits `notify/requested` for `task.overdue`. |
| `corrective-action.sweep.overdue` (cron, ~every 10 min) | cron | Finds unverified CAs past `due_at`; emits `notify/requested` for `corrective_action.overdue`. |
| `notify.fanout` | event `notify/requested` | Resolves recipients (role → outlet members), applies dedupe + suppression rules, writes `notification` rows, decides immediate-email vs digest. |
| `notify.email.immediate` | event `notify/email.immediate` | Sends a single Resend email; sets `emailed_at`. Retriable. |
| `notify.digest` (cron, per property TZ) | cron | Assembles per-user, per-outlet digests of batched rows; sends one Resend email; marks rows `emailed_at`. |

The overdue sweep is the linchpin: the same 10-minute function that flips status is the one that emits notifications, so status and notification are transactionally consistent (the state transition and the `notify/requested` emit happen in one Inngest step; if email later fails it retries independently without re-flipping status).

## 14.4 Anti-spam: dedupe, suppression, quiet hours, digest

This is the part that makes the system trustworthy rather than annoying. Five layers:

**1. Dedupe key (idempotency).** Every candidate notification computes a deterministic `dedupe_key`, e.g. `task.overdue:{occurrence_id}` or `corrective_action.overdue:{ca_id}:{date}`. The `UNIQUE (organization_id, dedupe_key)` constraint guarantees a re-running 10-minute sweep can fire repeatedly but only ever creates **one** overdue notification per occurrence. Insert uses on-conflict-do-nothing.

**2. Don't notify the actor about their own action.** In `notify.fanout`, the event carries `actor_user_id`. Any recipient equal to the actor is dropped (or, if they must retain an in-app record, the row is written with `email_suppressed_reason = actor_self` and never emailed). The chef who logs a failed temp check does not get emailed "an exception was created."

**3. Quiet hours.** Per property timezone, a fixed MVP quiet window (default 22:00–06:00 local). Email dispatched during quiet hours is deferred to the next digest / next window boundary; in-app rows are still written (silent). `critical` severity (`exception.created`) overrides quiet hours and emails immediately — a food-safety failure at 23:00 should not wait.

**4. Per-outlet digest batching.** `task.overdue` and `corrective_action.overdue` are **never** emailed individually. They accumulate as in-app rows and are rolled into a digest keyed by `(recipient_user_id, outlet_id)`: "Outlet: Main Kitchen — 4 overdue checks, 1 overdue corrective action." Digest cadence in MVP is fixed (e.g. hourly during service windows, plus an end-of-shift roll-up), computed in the property timezone.

**5. Recipient collapsing.** When a role-based recipient set overlaps (e.g. a user is both KitchenManager and the assignee), `notify.fanout` collapses to one row per user per subject before insert, so no one gets the same alert twice through two role paths.

## 14.5 User preferences (post-MVP)

MVP ships **no notification settings UI** — the defaults in 14.1 are the product opinion, consistent with the "minimal settings, no admin panels" ethos. The schema is forward-compatible: a future `notification_preference` table keyed by `(organization_id, user_id, event_key)` with per-channel toggles and a custom quiet window slots in without touching the six event types or the fanout pipeline. We explicitly refuse a per-event channel matrix in MVP; it is scope creep that undermines the opinionated defaults.

---

# 15. Export / audit pack design

## 15.1 Purpose and stance

The audit pack is the answer to *"can I prove it happened?"* — a self-contained, inspection-ready document reconstructing what was scheduled, done, missed, failed, and corrected over a date range. **PDF is the primary format** (the artifact an inspector or GM reads); **CSV is an optional companion** (flat rows for the org's own analysis / spreadsheet import). Both are generated by the same job from the same query.

Hard stance: the pack is **operational documentation and proof of process, not a legal compliance certification**. That disclaimer appears on the cover page (15.7) and is non-removable.

## 15.2 Filters

The export request is a typed, Zod-validated filter object (shared between the Server Action that enqueues and the Inngest worker):

| Filter | Type | Notes |
|---|---|---|
| `date_range` | {from, to} local dates | Required. Interpreted in the property timezone. Capped (e.g. ≤ 366 days) to bound job size. |
| `property_id` | uuid | Required — a pack is scoped to one property for a clean cover/header. |
| `outlet_ids` | uuid[] null | Optional; default = all outlets in the property the requester can see. |
| `task_types` | enum[] null | `temperature \| cleaning \| allergen \| opening \| closing \| generic`. |
| `status` | enum[] null | `completed \| missed \| overdue \| failed`. |
| `exceptions_only` | bool | Shortcut: only occurrences that produced an Exception. |

## 15.3 Contents of the pack

The PDF is a deterministic, tabular document (order fixed):

1. **Cover page** — organization, property, outlet(s), date range, applied filters, generated-by user + timestamp (UTC + property-local), pack ID, and the non-legal disclaimer.
2. **Summary** — counts: scheduled, completed, missed, overdue, failed; completion rate; open vs. resolved exceptions.
3. **Task log** — per occurrence: outlet, task template name, check type, due (local), status, responsible user, completion timestamp, entered value (e.g. measured temp) vs. threshold, pass/fail.
4. **Missed / overdue section** — occurrences with no completion by due time.
5. **Failed checks & exceptions** — each Exception with its trigger, severity, and linked corrective actions.
6. **Corrective actions** — assignee, due, verification status, verifier, timestamps.
7. **Evidence references** — per completion, a list of evidence items (type + short signed thumbnail link or a stable evidence ID); photos referenced, not inlined at full size, to keep packs printable.
8. **Edit-history summary** — from `activity_log`: any versioned edits to completions/evidence, with actor, timestamp, and reason (before/after). This is what makes the pack tamper-evident.

Everything is drawn from tenant-scoped Prisma reads plus the immutable `activity_log`; the pack never invents state.

## 15.4 Async generation + ExportJob state machine

Exports are **asynchronous, never synchronous** (spine item 10). A large date range across many outlets can touch tens of thousands of occurrences — that cannot block a request/response. Flow:

1. Server Action validates filters, creates an `ExportJob` row (`status = queued`), emits Inngest event `export/requested`, returns the job id immediately. UI shows a pending pill.
2. Inngest `export.process` picks it up: `queued → processing`, runs the paginated query, renders PDF (and CSV if requested), streams the result to R2.
3. On success: writes the `AuditPack` record (R2 object key, byte size, filters snapshot, checksum), sets `ExportJob.status = completed`, emits `export.ready` notification.
4. On failure (after Inngest retries exhausted): `status = failed` with an error message; emits `export.ready` (failed variant) so the user isn't left waiting.

State machine: `queued → processing → completed` / `queued → processing → failed`. Terminal states are immutable; a re-run is a **new** ExportJob (never a mutation of the old one), preserving an audit trail of who exported what, when.

## 15.5 PDF tooling — @react-pdf/renderer, decisively

We use **@react-pdf/renderer**, not Puppeteer/headless Chromium.

| Concern | @react-pdf/renderer | Puppeteer / headless Chromium |
|---|---|---|
| Serverless fit (Vercel/Inngest) | Pure JS, no binary; runs cleanly in the same runtime | Needs a bundled Chromium (chrome-aws-lambda), heavy cold starts, brittle on serverless |
| Determinism | Layout engine is deterministic — ideal for repeatable tabular audit packs | Rendering can drift with Chromium/font versions |
| Output shape | Built for structured, paginated, tabular documents | Optimized for rendering arbitrary web pages (overkill) |
| Ops surface | One npm dependency | A browser binary to patch, size limits, timeouts |
| Cost/latency | Low memory, fast for tables | High memory, slow cold start |

For audit packs — dense, tabular, deterministic, repeated — @react-pdf/renderer is the correct tool. Puppeteer's only advantage (rendering rich arbitrary HTML/CSS) is a non-need here and a liability on serverless. CSV is emitted directly as a stream, no library needed.

## 15.6 Storage, access control, and link expiry

- **Storage:** generated packs live in **Cloudflare R2** (spine item 7), keyed by `organization_id/property_id/export_job_id.pdf` (and `.csv`). Never served directly from the app.
- **Access control:** downloads route through `GET /api/exports/:id/download`. The handler enforces (a) the caller's session, (b) org membership matching the pack's `organization_id`, and (c) role — Owner, OrgAdmin, PropertyManager, KitchenManager, and Auditor may download; Staff/ShiftLeader may not, unless they are the requesting user. Property scoping applies: a property-scoped membership can only pull packs for its properties.
- **Signed URLs, short-lived:** the handler mints a **short-lived presigned R2 GET (default TTL 5 minutes)** and redirects. The URL is never persisted or embedded in email. Links **regenerate on demand** — the user always re-requests through the access-controlled route, so revoked access takes effect immediately and stale links simply expire.
- **Evidence links inside the PDF** use the same short-TTL signed-GET mechanism; because they expire, the printed/archived PDF references evidence by stable ID, and live links are re-minted when viewing the pack in-app.

## 15.7 Cover-page disclaimer (mandatory)

Every pack's cover page carries a fixed, non-removable notice, in substance:

> *This document is operational record-keeping generated by Shift Ledger to evidence completed kitchen food-safety tasks. It reflects data entered by the operator and is intended to support HACCP-style self-documentation. It is not a legal compliance certification, official inspection result, or accreditation, and does not constitute legal advice.*

This keeps the product firmly in the "documentation & operational proof" lane (spine item 15) and prevents any customer from representing an export as a regulatory certificate. The disclaimer text is versioned in code; its version string is stamped on the cover so we can prove which wording a given historical pack carried.

---

# 16. Security model

Security for Shift Ledger is dominated by ONE fact: it is a shared-schema, multi-tenant SaaS holding legally-relevant food-safety evidence. The two existential risks are (a) cross-tenant data leakage (IDOR / broken access control) and (b) loss of trust in the audit trail. Everything below is weighted toward those two. We build practically for MVP but we do not cut corners on tenant isolation or audit integrity.

## 16.1 Authentication

- **Provider**: Better Auth (self-hosted), Prisma + Postgres adapter on Neon. Session, Account, User, Organization, Membership, Invitation are Better Auth first-class primitives. Auth.js v5 is the documented fallback only.
- **Session model**: server-side sessions with an opaque session token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. No JWT-in-localStorage. Session rows live in Postgres; revocation is immediate (delete/expire the row). Default TTL 30 days with rolling refresh; **8-hour idle re-validation** for privileged roles (Owner, OrgAdmin).
- **Org context resolution**: a session is NOT globally trusted. On every request the server resolves `(userId, activeOrgId)` from the session + the requested route's org, then loads the caller's `Membership` for that org. If no active Membership exists for the target org, the request is rejected before any data query. `activeOrgId` is what gets pushed into the Postgres RLS session var (16.3).
- **Login methods (MVP)**: email + password and email magic-link/OTP. Social login deferred. Optional TOTP 2FA available and **required for Owner/OrgAdmin** (enforced at login, not optional for those roles).
- **Passwords**: hashed with Argon2id (Better Auth default) — never MD5/SHA/bcrypt-with-low-cost. Minimum 10 chars, checked against a breached-password list (k-anonymity range query, e.g. HIBP). No forced rotation (NIST-aligned). Rate-limited login (16.6).

## 16.2 Authorization

Two enforcement layers, both mandatory. Neither alone is trusted.

**Layer 1 — Single policy/guard layer (application).** Every Server Action and every REST route handler passes through one `authorize()` policy function before touching data. There is no second code path. It takes `(caller membership, targetResource, action)` and returns allow/deny. Roles map to capabilities:

| Role | Scope | Can complete tasks | Can edit templates/schedules | Can manage members | Can export | Can view |
|---|---|---|---|---|---|---|
| Owner | Org | Yes | Yes | Yes (incl. billing) | Yes | All |
| OrgAdmin | Org | Yes | Yes | Yes | Yes | All |
| PropertyManager | Property(s) | Yes | Yes (own properties) | Invite ≤ own scope | Yes (own scope) | Own properties |
| KitchenManager | Outlet(s) | Yes | Limited (schedules on own outlets) | No | Yes (own outlets) | Own outlets |
| ShiftLeader | Outlet(s) | Yes | No | No | No | Own outlets |
| Staff | Outlet(s) | Yes (assigned) | No | No | No | Own outlets (today) |
| Auditor | Org (read-only) | No | No | No | Yes (read/export) | All (read) |
| ExternalInspector (future) | Scoped read | No | No | No | Time-boxed export | Scoped read |

- **Property/outlet scoping** layers on top of org scoping: a `Membership` can be restricted to a set of property/outlet ids. The policy layer checks role capability AND scope membership.
- Deny-by-default. Unknown action or unmapped role = deny.

**Layer 2 — Postgres Row-Level Security (defense in depth).** See 16.3. Even if the application layer has a bug, RLS makes a cross-org read return zero rows.

## 16.3 Tenant isolation

- `organization_id` is denormalized onto **every** tenant-scoped table and every composite index **leads** with it.
- **RLS is enabled and FORCED on every tenant-scoped table.** Policy shape: `organization_id = current_setting('app.current_org_id')::uuid`. The setting is applied per-request/per-transaction from the resolved `activeOrgId` (16.1), using the connection's session GUC set at the start of the Prisma transaction.
- The application DB role is **non-superuser** and **not** `BYPASSRLS`. Migrations run under a separate privileged role that is never used at request time.
- **A query without org scope is impossible to leak**: if `app.current_org_id` is unset, the policy predicate evaluates against NULL and returns zero rows — fail-closed, not fail-open. There is no "select all tenants" path available to the request-time role.
- Property/outlet filtering is an additional `WHERE` applied by the app on top of RLS; it is a narrowing, never a widening.
- Cross-tenant admin/support access (ours) goes through a separate, audited internal tool with its own break-glass role — never the app's request path.

## 16.4 File-upload security

Evidence photos are user-supplied binaries — treated as hostile.

- **Presigned PUT to R2**: `POST /api/uploads` issues a short-TTL (≤ 60s) presigned PUT. The route validates the caller (policy layer) and the declared `content-type` and `content-length` BEFORE issuing.
- **Content-type allowlist**: `image/jpeg`, `image/png`, `image/webp`, `application/pdf` only. Enforced both on the presign constraint and re-validated server-side by sniffing magic bytes on finalize — never trust the client-declared type.
- **Size limits**: images ≤ 15 MB, PDFs ≤ 25 MB. Enforced via presigned condition.
- **Never trust client filename**: the R2 object key is server-generated (`org/{orgId}/outlet/{outletId}/{uuidv7}.{ext}`). Client filename is stored only as a display label, never used in the path or in any header.
- **EXIF/GPS strip**: on finalize, a normalization step re-encodes images and strips ALL EXIF metadata (including GPS) before the Attachment is marked usable. Protects staff privacy and prevents metadata leakage. The stripped, canonical object is what audit exports reference.
- **Malware stance (MVP-honest)**: files are stored in a private R2 bucket, never executed, never served from our origin, and only delivered via short-TTL signed GET with `Content-Disposition: attachment` and a restrictive `Content-Security-Policy`. We do NOT run a full AV pipeline in MVP; we do opportunistic magic-byte + size + type validation. A ClamAV/scanning webhook on finalize is the documented first upgrade if any customer requires it. We do not pretend to scan when we don't.

## 16.5 Signed URLs

- **Upload**: presigned PUT, TTL ≤ 60s, single object key, fixed content-type + max size condition.
- **Download / view**: short-lived presigned GET, **TTL ≤ 5 min**, issued only after the policy layer confirms the caller may see that Attachment (org + property/outlet scope). Files are **never** served directly from the Next.js origin and R2 buckets are private (no public read).
- Signed URLs are never logged in full, never embedded in emails; emails link to an authenticated in-app view that mints a fresh URL.

## 16.6 Rate limiting

- **Mechanism**: Upstash Redis (rate-limit primitive), sliding window.
- **Per-IP**: auth endpoints (login, magic-link, password reset) — e.g. 10/min/IP, then exponential backoff; `POST /api/uploads` presign — 60/min/IP.
- **Per-user / per-org**: mutating Server Actions — sane ceilings (e.g. 300/min/user) to blunt abuse and runaway clients; export requests — e.g. 10/hour/org (heavy jobs).
- **Cron/webhook endpoints**: authenticated by signing secret (Inngest signature / cron secret), not IP-listed; rejected if signature invalid.

## 16.7 Audit logging & protecting destructive actions

- `activity_log` is **append-only**: no UPDATE/DELETE granted to the app role; a Postgres trigger raises on UPDATE/DELETE; RLS scopes reads by org. Every state transition and every "edit" (which is a new version row, never a mutation) writes an activity_log entry with actor, timestamp, subject (polymorphic), before/after, and reason.
- **Optional per-org hash chain**: each row stores `prev_hash`; tamper-evidence for inspection-grade trust. Recommended on by default for orgs on the audit-focused tier.
- **Re-auth on destructive/admin actions**: removing a member, deleting a ScheduledTask, rotating org keys, or exporting a full audit pack requires a fresh credential check (recent password/2FA within a short window) — sudo-style step-up. All such actions are activity-logged with the actor.
- Compliance records (TaskCompletion, Evidence) are immutable by design (spine §9); there is no delete endpoint. Corrections create new versions.

## 16.8 Input validation

- **Zod everywhere**: one schema per operation, shared between the Server Action and its REST twin (spine §13). Nothing reaches Prisma unvalidated.
- Validation covers types, ranges (e.g. measured temperature within a plausible band), enum membership (check type, evidence type, status), and referential shape. Reject-with-typed-error, never coerce silently.
- Server Actions re-validate on the server even when the client already validated — the client is never trusted.

## 16.9 OWASP Top 10 mapping

| OWASP (2021) | Risk here | Mitigation |
|---|---|---|
| A01 Broken Access Control (**#1 for us**) | Cross-tenant IDOR: reading another org's evidence by guessing a UUID | Policy layer + **RLS fail-closed**; UUIDv7 ids are non-enumerable but not relied on for security; every resource resolved with org predicate |
| A02 Cryptographic Failures | Evidence/PII exposure | TLS everywhere; Argon2id; private R2; short-TTL signed URLs; EU-at-rest encryption (Neon/R2) |
| A03 Injection | SQLi via raw queries | Prisma parameterized queries only; Zod-validated inputs; no string-built SQL |
| A04 Insecure Design | Mutable audit trail undermines product | Immutable records + append-only log + optional hash chain, designed in |
| A05 Security Misconfiguration | RLS off, public bucket, verbose errors | RLS FORCED + non-BYPASSRLS role; private buckets; generic error responses; secrets in env, not code |
| A06 Vulnerable Components | Supply chain | Renovate/Dependabot; `npm audit` in CI; pinned lockfile |
| A07 Auth Failures | Credential stuffing, weak sessions | Rate limiting; Argon2id; breached-password check; server-side revocable sessions; 2FA for admins |
| A08 Data Integrity Failures | Tampered exports / unsigned jobs | Hash-chained log; signed Inngest/cron payloads; deterministic @react-pdf render |
| A09 Logging/Monitoring Failures | Missed breach | Sentry + pino structured logs + activity_log; alerting on anomalies |
| A10 SSRF | User-supplied URLs | No user-fetched URLs in MVP; R2 access via SDK with fixed endpoint |

## 16.10 GDPR & data governance (DE/NL first)

- **Roles**: customer (hotel/group) is Controller; Shift Ledger is Processor. A **DPA** is offered; sub-processors listed (Neon, Cloudflare R2, Resend, Inngest, Sentry, Vercel, Upstash) — all with EU data residency or SCCs where required.
- **Lawful basis**: Art. 6(1)(b) contract (delivering the service) and 6(1)(c)/legitimate interest for the customer's own legal food-safety record-keeping. Staff evidence is processed on the controller's basis; we minimize (EXIF-stripped photos, initials over full signatures where possible).
- **EU residency**: Neon EU region + R2 EU jurisdiction + Resend/Inngest EU where offered. No US data path in the request lifecycle.
- **DSAR**: export/delete tooling per data subject scoped by org. Tension with immutability handled explicitly: compliance records may be under **legal hold / retention obligation** (HACCP documentation) that overrides erasure; we honor erasure of non-obligated personal data and pseudonymize the actor where a record must be retained for legal proof. This is documented in the DPA, not hand-waved.
- **Retention**: default evidence/audit retention configurable per org (e.g. 2–3 years to match typical food-safety documentation expectations; org-set, not our legal advice). Soft policy: purge job removes expired, non-legal-hold data. **Legal hold flag** freezes deletion for records under dispute/inspection.
- **Compliance stance**: documentation & operational-proof tool, NOT legal certification (spine §15). Copy and DPA state this plainly.

## 16.11 Backups & recovery

- **Neon PITR**: point-in-time recovery within the retention window (7–30 days by tier); enables restore to any second, covering ransomware/accidental-delete.
- **R2**: object versioning enabled on the evidence bucket; lifecycle rules for expired exports; evidence objects protected from lifecycle deletion while under retention/legal hold.
- **Restore drills**: a documented, periodically-tested restore runbook (restore Neon branch + verify R2 references). Untested backups are not backups.
- Secrets rotation runbook (DB creds, R2 keys, signing secrets) documented; rotation is activity-logged.

---

# 17. Deployment architecture

Small team, professional but simple. One monolith, managed services, no self-run infrastructure.

## 17.1 Topology

| Concern | Service | Region / notes |
|---|---|---|
| Frontend (RSC) + Server Actions + REST route handlers | **Vercel** | Single Next.js 15 monolith; EU function region (e.g. `fra1`) |
| Primary database | **Neon Postgres** | EU region; branching; PITR; PgBouncer pooling |
| Object storage (evidence, exports) | **Cloudflare R2** | EU jurisdiction; private buckets; presigned PUT/GET |
| Background jobs / scheduling | **Inngest** | Occurrence generation, overdue sweep, notification dispatch, export processing |
| Transactional email | **Resend** | EU sending; digest/batched |
| Rate limiting / ephemeral | **Upstash Redis** | EU region |
| Errors | **Sentry** | Source-mapped; EU data region |
| Logs / analytics | **Vercel logs + pino** | Structured JSON logs shipped to Vercel/Sentry |

No separate backend service, no container orchestration, no microservices. This is deliberate (spine §1).

## 17.2 Environments

- **Production** and **Staging** are fully separate: separate Neon project/DB, separate R2 buckets, separate Inngest environment, separate Resend keys, separate Vercel project (or Vercel env). No shared secrets, no shared data.
- **Preview per PR**: Vercel Preview deployment + **Neon branch per PR** (isolated copy-on-write DB seeded from a sanitized snapshot). Preview uses a dedicated R2 prefix/bucket and the Inngest branch environment. Previews never touch production data.

## 17.3 Environment variables (redacted, by category)

| Category | Keys (values redacted) |
|---|---|
| Database | `DATABASE_URL` (pooled/PgBouncer), `DIRECT_DATABASE_URL` (migrations), `SHADOW_DATABASE_URL` |
| Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_TRUST_HOST`, TOTP/issuer config |
| Storage (R2) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_EVIDENCE`, `R2_BUCKET_EXPORTS`, `R2_ENDPOINT` |
| Jobs | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Rate limit | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Monitoring | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ENV` |
| App | `APP_ENV` (production/staging/preview), `APP_BASE_URL`, `CRON_SECRET` |

Secrets live in Vercel env (per environment) and GitHub Actions secrets. Never in the repo. `DIRECT_DATABASE_URL` uses the privileged migration role (non-request-time, non-RLS-bypass at runtime).

## 17.4 CI/CD (GitHub Actions)

Pipeline on every PR:

1. **Install** (cached pnpm/npm, frozen lockfile).
2. **Typecheck** (`tsc --noEmit`).
3. **Lint** (ESLint + Prettier check).
4. **Unit/integration tests** (Vitest) — including policy-layer and RLS tests against an ephemeral Postgres (Neon branch or Testcontainers): explicitly assert that a query under org A cannot read org B.
5. **Prisma** — `prisma validate` + `prisma migrate diff` to catch drift; on merge to main, `prisma migrate deploy` against the target env using the direct/migration role.
6. **Playwright smoke** — critical paths: login, see Today dashboard, complete a task with evidence, trigger an export. Runs against the preview deployment.
7. **Deploy** — Vercel deploys preview per PR, production on merge to `main` (staging on merge to `staging`). Migrations run as a gated deploy step before the new functions go live.

Branch protection: no direct pushes to `main`; PR + green CI + review required. `npm audit` / Dependabot gate on high-severity advisories.

## 17.5 Migrations discipline

- Migrations are forward-only and reviewed. Destructive changes (drop column) use expand/contract across two deploys — never a single breaking migration on a live table.
- RLS policies and the append-only triggers are part of migrations and are tested in CI (a migration that disables RLS on a tenant table fails a CI check).

## 17.6 Logging, monitoring, error tracking

- **pino** structured JSON logs with request id, org id (never PII payloads, never signed URLs), latency, outcome. Shipped to Vercel logs; errors escalate to Sentry.
- **Sentry**: exceptions with source maps, release tracking tied to the Vercel deployment, performance tracing on Server Actions and job handlers. Alert rules on error-rate spikes.
- **Inngest dashboard** for job health: failures, retries, throughput, backlog.
- **Uptime/synthetic**: a simple external health check on `GET /api/health` (DB ping + R2 reachability) with alerting.
- **Key business alerts (cheap, high value)**: occurrence-generation job failed; overdue-sweep lag > 15 min; export failure rate; email bounce rate.

---

# 18. Scalability plan

Rule: build for the next order of magnitude, not three. The architecture already chosen (serverless monolith, managed Postgres, R2, Inngest) comfortably carries us to ~1,000 customers with mostly configuration changes. Below is what is ENOUGH at each stage and the concrete trigger to change each thing.

## 18.1 What's enough at each stage

**10 pilot customers (DE/NL).**
- Single Neon instance, default compute; PgBouncer pooling on from day one (serverless + Prisma demands it — this is not premature).
- Occurrence generation for a 3-day rolling window: trivial volume (a few hundred to low thousands of rows/day). No partitioning.
- Inngest default concurrency. Exports rare and small. Resend free/entry tier fine.
- **Do nothing clever.** The goal is correctness of tenant isolation and the audit trail, not throughput.

**100 customers.**
- Neon: right-size compute, enable autoscaling; confirm connection cap headroom (pooled `DATABASE_URL` everywhere; migrations on the direct URL only).
- Occurrence table growing but healthy with `organization_id`-leading composite indexes and status/`due_at` indexes. Overdue sweep still cheap (indexed on status + due_at).
- Notifications: turn on digest/batching (already designed) to stay well under Resend rate limits; per-org export ceiling enforced.
- Inngest: set explicit concurrency limits and per-org fan-out throttles so one large group can't starve others.

**1,000 customers.**
- Neon: scale compute vertically; consider a **read replica** for heavy read paths (audit browsing, exports) so reporting doesn't contend with the write path. RLS + org scoping unchanged.
- `activity_log` and `task_occurrence` are the two growth tables. Introduce **monthly range partitioning on `activity_log`** (by created month) and archive/rollup old partitions; occurrence table gets an archival job moving long-closed occurrences to a cold partition/table. App code unaffected (org_id is already the partition key for a future tenant lift).
- Export processing isolated on its own Inngest concurrency lane so a 2-year audit pack for a big group never blocks daily notifications.
- A single very large tenant can be **lifted to a dedicated Neon DB** with no app changes because `organization_id` is already the partition key (spine §5).

## 18.2 Bottlenecks and change triggers

| Area | Design that suffices now | Change it when (trigger) | Then do |
|---|---|---|---|
| **DB connections** | Neon PgBouncer pooling, pooled URL everywhere | Pool saturation / `too many connections` errors under normal load | Raise pool size; move heavy reads to replica |
| **Occurrence table growth** | 3-day materialization, org-led indexes | Sweep/query latency climbs, or table > tens of millions rows | Archive long-closed occurrences to cold table; consider partition by month |
| **activity_log growth** | Append-only single table, indexed | Table > ~50–100M rows or slow audit queries | Monthly range partitioning + partition pruning + cold archive |
| **File storage** | R2, private, presigned; server-generated keys | Storage cost creep from stale exports/large photos | Lifecycle-expire old export objects; enforce/normalize image size; tier evidence retention |
| **Background jobs** | Inngest default concurrency | One large org's generation fan-out delays others; retries pile up | Per-org concurrency keys + throttling; dedicated lanes per job type |
| **Generation fan-out** | Daily job iterating scheduled tasks | Job runtime approaches its window | Shard generation by org/property; parallelize with bounded concurrency |
| **Export (heavy packs)** | Async queued @react-pdf job | Large multi-month packs slow or OOM | Stream/paginate PDF generation; split into chunked packs; dedicated export lane |
| **Notifications** | In-app first, batched email via Resend | Resend rate/volume limits or spam complaints | Stronger digest windows; upgrade Resend tier; per-user preferences (post-MVP) |
| **Read latency (reporting)** | Primary reads with indexes | Reporting contends with writes at ~1k customers | Neon read replica for audit/export/report reads |

## 18.3 Explicit non-scaling (refuse scope creep)

We do NOT pre-build: sharding, microservices, a message bus, multi-region active-active, IoT/sensor ingestion pipelines, or a custom job runner. None are justified before the triggers above fire, and several (IoT, sensors) are explicit MVP non-goals. Adding them now would trade the durable, one-engineer-maintainable architecture for cleverness we don't need. The single strongest scalability lever we already hold is that `organization_id` is the partition key on every tenant table — it lets us defer the hardest scaling decision (tenant isolation at the storage layer) until a real, large customer forces it, and then execute it as a lift-and-shift rather than a rewrite.

---

# 19. Testing strategy

## 19.1 Testing philosophy for a one-engineer MVP

The single strong full-stack engineer cannot afford a 90%-coverage religion. Test **hard** where a bug is silent, tenant-crossing, legally embarrassing, or destroys the product's core promise ("can I prove it happened?"). Test **lightly** where the type system and Zod already carry the weight, or where a failure is loud and cheap to fix.

| Test hard (non-negotiable) | Test lightly (smoke / spot-check) |
|---|---|
| Tenant isolation (org scoping + RLS) | Component rendering / snapshots |
| Permission matrix (role × action) | CSS / layout / responsive breakpoints |
| Recurring-task generation: idempotency, windowing, DST | Copy, labels, empty-state text |
| Timezone correctness (DE/NL wall-clock → UTC) | Optimistic-UI rollback animations |
| Audit-log immutability (no UPDATE/DELETE) | Notification email HTML formatting |
| Completion/Evidence versioning-not-mutation | In-app toast behaviour |
| Export golden files (PDF/CSV structure) | Third-party widget internals |
| Zod schema boundaries (temp thresholds, enums) | Loading spinners / skeletons |

Guiding rule: **every bug that could let one hotel see another hotel's data, or that could let a compliance record be silently altered, gets an automated regression test the same day it is discovered.**

## 19.2 Toolchain

| Layer | Tool | Rationale |
|---|---|---|
| Unit / integration | **Vitest** | Fast, native ESM/TS, same config as the app; Jest-compatible API. |
| DB-backed integration | **Prisma against a disposable Postgres** — **Testcontainers** locally/CI (Docker), **Neon branch** for PR preview integration | Real Postgres so RLS, triggers, and UNIQUE constraints are exercised — SQLite/mocks cannot test RLS. |
| API / contract | **Vitest + Zod** driving Server Actions and route handlers; schema round-trip tests | Server Actions are just typed functions — call them directly with a seeded tenant context. |
| Permission matrix | **Custom table-driven harness on Vitest** (see 19.4) | One data-driven test enumerates role × action × scope. |
| E2E | **Playwright** | Cross-browser, mobile viewport emulation for frontline flows, trace viewer for debugging. |
| Schema | **Zod schema tests** (unit) | Assert accept/reject at threshold boundaries and enum edges. |
| Golden files | Vitest snapshot of **CSV string** + **parsed PDF text/structure** (not pixel diff) | Deterministic @react-pdf output; assert content and column order, not rendering. |

CI runs Vitest unit (no DB) on every push; DB-integration + Playwright on PR against an ephemeral Neon branch that is seeded then discarded.

## 19.3 What each layer covers

**Unit (no DB, fast):** recurrence math (next occurrence given freq/interval/byWeekday/byMonthDay/timeOfDay/timezone), DST wall-clock→UTC conversion, pass/fail evaluation against thresholds (`fridge <= 4°C`), hash-chain link computation, Zod schemas, CSV row serialization, overdue predicate (`now > due_at && status == due`).

**Integration (real Postgres, seeded tenant):** Server Actions end-to-end through Prisma including RLS session var `app.current_org_id`; UNIQUE(scheduled_task_id, occurrence_local_date) enforcement; versioned-edit creating a new TaskCompletion row + ActivityLog row; Exception → CorrectiveAction cascade; notification row emission on due→overdue.

**API/contract:** the Section-11 logical operations, whether implemented as Server Actions or REST handlers, validated against their shared Zod schemas so the canonical contract cannot silently drift from implementation.

## 19.4 Permission matrix harness (role × action)

A single data-driven test iterates every (role, action, scope) triple and asserts allow/deny. This is the highest-leverage security test in the product.

Roles: Owner, OrgAdmin, PropertyManager, KitchenManager, ShiftLeader, Staff, Auditor. Representative actions and expected outcomes (excerpt — full matrix lives in the test fixture):

| Action | Owner | OrgAdmin | PropertyManager | KitchenManager | ShiftLeader | Staff | Auditor |
|---|---|---|---|---|---|---|---|
| Create/edit TaskTemplate | allow | allow | allow (own props) | deny | deny | deny | deny |
| Create ScheduledTask | allow | allow | allow (own props) | allow (own outlet) | deny | deny | deny |
| Complete TaskOccurrence | allow | allow | allow | allow | allow | allow (assigned) | deny |
| Upload Evidence | allow | allow | allow | allow | allow | allow | deny |
| Resolve Exception / verify CorrectiveAction | allow | allow | allow | allow | allow (raise only) | deny | deny |
| Trigger ExportJob / AuditPack | allow | allow | allow (own props) | allow (own outlet) | deny | deny | allow (read-scope) |
| Read any org data | allow | allow | scoped | scoped | scoped | scoped | allow (read-only) |
| Invite member / assign Role | allow | allow | deny | deny | deny | deny | deny |
| **Cross-org read of ANY entity** | **deny** | **deny** | **deny** | **deny** | **deny** | **deny** | **deny** |

The harness also asserts **negative scope**: a PropertyManager of Property A gets `deny` on Property B within the same org, and every role gets `deny` cross-org (belt-and-suspenders with RLS). Adding a role or action fails the test until the matrix is updated — the matrix is the spec.

## 19.5 Recurring-scheduler tests (test hard)

| Scenario | Assertion |
|---|---|
| Idempotent generation | Running the daily job twice over the same window creates **zero** duplicate occurrences (UNIQUE constraint holds; job upserts, does not error-crash). |
| Rolling window | Job materializes exactly the ~3-day forward window; no occurrence beyond horizon; gap-free when run daily. |
| Catch-up after missed run | Running after a 2-day outage backfills missing local dates without duplicating existing ones. |
| Weekly byWeekday | `byWeekday=[MON,THU]`, interval 2 produces correct local dates only on selected weeks. |
| Monthly byMonthDay=31 | Months without day 31 handled per policy (skip, not crash) — assert documented behaviour. |
| Assignment carry | Generated occurrence inherits role/user assignment and denormalized org/property/outlet ids + timezone. |

## 19.6 Timezone tests (DE/NL + DST)

Both target markets are `Europe/Berlin` and `Europe/Amsterdam` (identical offsets, but test both to lock the property-timezone plumbing).

| Scenario | Assertion |
|---|---|
| Standard time | `timeOfDay=07:00` on a Jan date → `due_at` UTC = 06:00Z. |
| Summer time | `timeOfDay=07:00` on a Jul date → `due_at` UTC = 05:00Z. |
| Spring-forward gap (2026-03-29, 02:00→03:00 CET→CEST) | A task at 02:30 local (nonexistent wall time) resolves per documented policy (shift forward to 03:30 CEST); no crash, deterministic. |
| Fall-back overlap (2026-10-25, 03:00→02:00 CEST→CET) | A task at 02:30 local (ambiguous) resolves to the **first** occurrence deterministically; no duplicate occurrence. |
| Cross-DST window | A 3-day generation window spanning the DST boundary produces correct UTC due times on each side. |
| Overdue sweep across DST | due→overdue transition uses UTC comparison and is unaffected by the local clock change. |

## 19.7 Audit-log immutability (test hard)

These assert the LOCKED spine's append-only guarantee at the database level, not just in app code.

| Test | Assertion |
|---|---|
| Direct UPDATE on `activity_log` | Raw SQL `UPDATE activity_log …` **fails** (Postgres trigger / RLS rejects). |
| Direct DELETE on `activity_log` | Raw SQL `DELETE FROM activity_log …` **fails**. |
| Completion "edit" | Editing a TaskCompletion writes a **new version row** + ActivityLog entry with before/after + reason + actor; original row byte-for-byte unchanged. |
| Evidence immutability | Attempt to mutate an Evidence row fails; correction path creates a new record. |
| Hash chain (if enabled per org) | Each new log row's `prev_hash` equals the prior row's hash; tampering with any middle row breaks chain verification. |

Run these against real Postgres (Testcontainers/Neon) — a mocked Prisma client would never exercise the trigger.

## 19.8 File upload tests

| Test | Assertion |
|---|---|
| Signed PUT issuance | `POST /api/uploads` returns a short-lived presigned R2 URL scoped to the org's key prefix; rejects unauthenticated/cross-org callers. |
| Content-type / size guard | Zod + policy rejects disallowed MIME types and oversize files before issuing a URL. |
| Attachment linkage | After upload, Evidence→Attachment(R2 object key) linkage persists with org_id; download issues short-lived presigned GET only to authorized roles. |
| No direct serving | App never streams the binary itself (contract test that the download route returns a redirect/signed URL, not bytes). |

R2 itself is mocked/stubbed in CI (S3-compatible mock); a nightly job may hit a real R2 test bucket.

## 19.9 Export tests (golden PDF/CSV)

| Test | Assertion |
|---|---|
| Golden CSV | Given a seeded fixture (occurrences, completions, evidence, exceptions), exported CSV matches a checked-in golden string: exact columns, order, timezone-rendered timestamps, pass/fail. |
| Golden PDF (content) | @react-pdf output parsed to text/structure; assert audit-pack sections, filters/metadata header, and row counts match golden — **not** a pixel diff (deterministic content, fonts may vary). |
| Job lifecycle | ExportJob transitions queued→processing→completed; failure path sets `failed` with reason; completed job produces an AuditPack record with R2 key + filters used. |
| Scope integrity | Export never includes another org's rows even when filters are broad (cross-tenant regression). |
| Determinism | Same input + same filter set yields byte-identical CSV and structurally identical PDF. |

## 19.10 E2E happy paths (Playwright, small and stable)

Keep E2E to a handful of high-value flows — they are the slowest and flakiest layer, so guard the money paths only:

1. **Frontline completion (mobile viewport):** Staff logs in → Today dashboard → completes a temperature check with a photo + reading under the 10-second bar → occurrence shows done.
2. **Failed check → corrective action:** completion fails threshold → Exception auto-raised → KitchenManager assigns + verifies CorrectiveAction.
3. **Overdue path:** a due occurrence passes its `due_at` → sweep marks overdue → assignee gets an in-app notification.
4. **Manager schedule setup:** PropertyManager clones a DE HACCP starter template → creates a ScheduledTask on an outlet → occurrence appears on tomorrow's Today.
5. **Audit export:** Auditor (read-only) triggers an ExportJob → downloads the signed PDF/CSV audit pack.

Everything else (settings, edits, filters) is covered at the integration layer, which is faster and less flaky than E2E.

# 20. Implementation roadmap

Estimates assume one strong full-stack engineer. Complexity: S ≈ ≤1 wk, M ≈ 1–2 wks, L ≈ 2–4 wks. Total ≈ 22–28 weeks to pilot-ready (including Milestone 0 design sprint).

**Parallelism note:** Milestone 0 (design) and Milestone 1 (backend foundation) can and should run in parallel — Milestone 1 is entirely backend/infra, no UI. All subsequent frontend milestones (4 onward) are gated on Milestone 0 completion.

| # | Milestone | Features | Dependencies | Complexity | Risks | Acceptance criteria |
|---|---|---|---|---|---|---|
| 0 | **Design sprint (Claude designer)** — ✅ **COMPLETE (2026-07-01)** | All 14 main screens designed (mobile-first + desktop); 6 core user flows mapped screen-to-screen; component inventory (cards, badges, forms, evidence upload widget, timeline row); navigation architecture (mobile bottom bar, desktop sidebar, intercepting-route modals); design system tokens (spacing, type scale, color). **Delivered:** shadcn/ui + Radix + Tailwind v4, OKLCH tokens, indigo/Slate + status palette, self-hosted Geist (GDPR), 49 components incl. ThresholdReadout/EvidenceUpload/SignaturePad/TimelineRow + reusable Dialog/Sheet/Toaster/DateRangePicker/Combobox/EmptyState/OfflineBanner/Skeleton, all 14 screens, light + dark. ⌘K reserved (post-MVP). | none | **M (1–2 wk)** | Design decisions that feel clean on paper but fail on a real phone in a kitchen; shared-tablet PIN flow awkwardness; evidence upload widget on mobile. | ✅ All 14 screens reviewed and approved; ✅ mobile task completion flow validated for sub-10s (adaptive required-evidence gating, fast path stays one screen); ✅ design system tokens defined; no frontend code starts before approval. |
| 1 | **Foundation** | Next.js 15 App Router monolith on Vercel; Prisma + Neon EU; UUIDv7 PKs; base multi-tenant schema with `organization_id` on every tenant table; RLS scaffolding + transaction-local `set_config` wrapper (D6); cross-tenant leak test (gate); append-only `activity_log` table with Postgres trigger (rejects UPDATE/DELETE); Zod base; TanStack Query provider + query-key conventions (D10); IndexedDB write-queue scaffold (D9); Sentry + pino; Testcontainers/Neon-branch CI; Vitest + Playwright harness. | none (parallel with 0) | **L (2–4 wk)** | RLS + Prisma session-var pattern under Neon pooling (#1 build risk); UUIDv7 generation; CI Postgres flakiness; IndexedDB queue cross-browser. | RLS blocks cross-org reads in a dedicated cross-tenant test; immutability trigger rejects UPDATE/DELETE; IndexedDB queue retries a queued write on reconnect; CI pipeline green; deploy pipeline live on Vercel. |
| 2 | **Organizations, properties, users** | Better Auth (org/membership/invitation/role); Organization→Property→Outlet CRUD; Membership + property-scoped roles; Invitation flow; email via Resend; permission-matrix harness seeded. | 1 | **M (1–2 wk)** | Better Auth org/role modeling matching canonical roles; invitation edge cases. | Owner can create org, properties, outlets; invite by email → Membership; permission matrix test passes for all 7 roles; every entity carries org_id and passes RLS. |
| 3 | **Task templates & schedules** | TemplateLibrary (DE/NL HACCP starter packs); TaskTemplate (check type, required evidence, thresholds, instructions); clone-from-library; ScheduledTask (typed Recurrence, timeOfDay, assignment); Inngest wired; daily generation job (materialize ~3-day window, idempotent UNIQUE); overdue sweep (~10 min, transitions due→overdue, emits notifications). | 1, 2 | **L (2–4 wk)** | Recurrence + DST correctness; Inngest idempotency; timezone plumbing from property. | Cloning a starter pack works; ScheduledTask generates TaskOccurrences on rolling window; re-running job creates no duplicates; DE/NL DST tests (spring-forward + fall-back) green; overdue sweep transitions correctly. |
| 4 | **Today dashboard** | RSC Today view (initial render, fast); TanStack Query client island for live list updates (polling 30–60s per D10); mobile-first frontline layout per Milestone 0 designs; desktop manager outlet-rollup view; optimistic task-status updates; "pending sync" indicator for queued offline writes (D9). | 0 (designs approved), 3 | **M (1–2 wk)** | Query performance (org_id-leading composite indexes); role-scoped visibility; TanStack Query hydration with RSC initial data. | Staff sees only assigned/relevant occurrences for today; manager sees outlet rollup; list updates within polling interval when another user completes a task; overdue visually distinct; p95 load fast. |
| 5 | **Task completion & evidence** | Server-Action completion (values, pass/fail vs threshold); shared-tablet PIN/initials actor confirmation (D8); Evidence (note/photo/temperature/checkbox/initials/file); R2 presigned PUT via `POST /api/uploads`; client-side photo compression to WebP before PUT; Attachment linkage; **versioned immutable** completion (edit = new version + ActivityLog + mandatory reason); TanStack Query optimistic mutation (onMutate/onError/onSettled); IndexedDB write-queue for failed submissions (D9). | 0, 2, 3, 4 | **L (2–4 wk)** | Immutability/versioning discipline; R2 signed-URL flow; sub-10s completion UX on mobile; PIN flow on shared tablets; photo compression cross-browser. | Completing writes TaskCompletion + Evidence + ActivityLog; photo uploads via signed URL; edit creates new version, original row unchanged; frontline temp check end-to-end under 10s; offline submit queues + retries on reconnect. |
| 6 | **Exceptions & corrective actions** | Auto-create Exception on failing occurrence/completion; full Exception state machine (D2: open→acknowledged→in_progress→resolved→verified + reopened); CorrectiveAction (D2: open→assigned→done→verified + rejected); assignee/due; polymorphic Comment; notifications on raise/assign/verify; TanStack Query live exception list. | 5 | **M (1–2 wk)** | Correct auto-raise triggering; full state machine implementation; notification correctness. | Failed threshold auto-raises Exception; full state machine traversable; CorrectiveAction assignable + verifiable; assignee notified in-app + email; state-machine tests cover all transitions. |
| 7 | **Timeline & audit logs** | Polymorphic ActivityLog rendering (per occurrence / exception / property / org); every state transition + edit recorded with actor/before/after/reason; optional per-org hash chain; keyset-paginated RSC list. | 5, 6 | **M (1–2 wk)** | Complete coverage of all transitions (every Server Action + Inngest job must emit); hash-chain compute overhead. | Every completion/edit/exception/corrective-action transition appears in timeline; before/after + reason + actor visible; hash chain verifies tamper-evidence (if enabled per org); immutability audit: no UPDATE/DELETE rows in activity_log. |
| 8 | **Audit export** | ExportJob (queued→processing→completed→failed) on Inngest; @react-pdf/renderer PDF (cover page with disclaimer: "operational documentation, not legal certification") + CSV; AuditPack record (R2 key + filters/metadata); `GET /api/exports/:id/download` short-lived signed URL; golden-file tests; Auditor and Manager export access per permission matrix. | 5, 6, 7 | **L (2–4 wk)** | @react-pdf tabular layout effort; determinism; photo embedding in PDF; scope integrity across orgs. | Auditor triggers export → job completes → signed PDF/CSV download; PDF includes disclaimer; golden files match on re-run; export never includes another org's data; failure path sets `failed` with reason; download link expires. |
| 9 | **Pilot readiness** | Notification digest/batching; basic reminders (Inngest cron); GDPR: DSAR export/delete, retention policy (1095-day default, per-org override, legal hold flag), DPA-ready docs; EU residency verified (Neon EU + R2 EU); onboarding for 1–2 pilot hotels; Sentry + log dashboards; seed DE/NL starter packs; performance pass (Today dashboard p95 < 800ms); security pass (cross-tenant, IDOR, upload); notification spam audit. | 1–8 | **M (1–2 wk)** | GDPR completeness; real-kitchen UX friction; notification spam in practice. | Pilot hotel onboarded end-to-end; daily actions under 10s in the field; data residency confirmed EU; DSAR export/delete works; no cross-tenant leak in security pass; notification digest does not spam. |

**Sequencing note:** Milestones 1 and 3 are the true risk concentration (RLS/immutability and recurrence/DST/idempotency). Front-load them and their hard tests. Milestone 0 unblocks all frontend work — treat it as urgent as Milestone 1. Do not let dashboard polish (4) or export aesthetics (8) pull effort away from the correctness core.

# 21. Architecture decisions (ADRs)

## ADR-a — Application shape: Next.js full-stack monolith vs separate backend
- **Decision:** How to structure app + API for the MVP.
- **Options considered:** (1) Single Next.js 15 App Router monolith (RSC reads + Server Action writes + thin REST surface); (2) Next.js frontend + separate Node/Nest API service; (3) microservices.
- **Chosen:** Option 1 — single Next.js 15 TypeScript monolith on Vercel.
- **Reason:** One engineer, one deploy target, one type system end-to-end; RSC + Server Actions remove an entire API/client-fetching layer; matches the "simple durable architecture" mandate.
- **Tradeoff:** Business logic coupled to the Next.js runtime; heavy CPU work must be pushed to Inngest jobs, not request handlers.
- **Reconsider when:** A separate native mobile client or third-party API consumers need a stable server independent of the web runtime, or when non-web compute dominates.

## ADR-b — API style: GraphQL for reads + Server Actions for writes (revised 2026-07-01)
- **Decision:** How typed client↔server calls are made.
- **Options considered:** (1) REST contract + Server Actions (original); (2) tRPC; (3) GraphQL for client reads + Server Actions for writes; (4) GraphQL end-to-end including mutations.
- **Chosen:** Option 3 — **GraphQL for all client-side reads; Server Actions for all writes**.
- **Reason:** A single typed GraphQL schema serves as the stable read contract for the web client today and a future native mobile client (React Native/Expo) without modification. Client components request exactly the fields they need — no over-fetching on mobile. graphql-codegen auto-generates fully typed TanStack Query hooks from the schema + query documents, keeping the client type-safe without manual maintenance. GraphQL subscriptions provide a clean upgrade path from polling to real-time without component refactoring. Server Actions remain for writes because they are typed, colocated, and optimistic-friendly in Next.js — GraphQL mutations would be redundant overhead on top of them.
- **Architecture shape:**
  - `POST /api/graphql` — graphql-yoga embedded in a Next.js route handler; Pothos for TypeScript-first schema building (no schema-first SDL file to maintain).
  - **RSC reads Prisma directly** (no GraphQL hop for server-rendered initial data — that would be pointless overhead). RSC initial data is hydrated into TanStack Query cache via `HydrationBoundary` so client components pick up instantly without a duplicate fetch.
  - **Client components query GraphQL** via TanStack Query with a typed GraphQL fetcher generated by graphql-codegen.
  - **DataLoader is mandatory**: Pothos DataLoader plugin from day one. Without it, the Today dashboard makes N+1 queries (one per occurrence to load its completion + evidence count). This is not optional.
  - Thin REST surface (unchanged): `POST /api/uploads` (presigned URL), `GET /api/exports/:id/download`, cron/Inngest webhooks — these stay REST, GraphQL is not appropriate for file upload or binary download.
- **Required libraries:** `graphql-yoga` (embedded, lightweight), `@pothos/core` + `@pothos/plugin-dataloader` + `@pothos/plugin-scope-auth`, `graphql-codegen` (codegen pipeline: generates typed hooks from `.graphql` query files), `dataloader`.
- **Tenant scoping in GraphQL:** Every Pothos resolver receives the org context from the request session and passes it to the Prisma tenant-scoped wrapper (D6). The `@pothos/plugin-scope-auth` enforces role/property scoping at the resolver level — GraphQL does not bypass RLS or the application permission layer.
- **Tradeoff:** DataLoader is mandatory from day one (adds setup complexity); codegen pipeline is an extra build step; two read paths (RSC → Prisma and Client → GraphQL → Prisma) require discipline about which path each query takes. Schema changes require regenerating client types.
- **Reconsider when:** The schema becomes so large that the codegen pipeline is a bottleneck, or subscriptions prove unnecessary and the simpler REST+polling approach would have sufficed.

## ADR-c — ORM: Prisma vs Drizzle
- **Decision:** Data-access layer.
- **Options considered:** (1) Prisma; (2) Drizzle; (3) raw SQL / Kysely.
- **Chosen:** Prisma.
- **Reason:** Best-in-class DX and migrations for one engineer; first-class Better Auth adapter; strong typed model layer; mature Neon/Postgres support.
- **Tradeoff:** RLS session var (`app.current_org_id`) must be set per request/transaction — a known Prisma friction point requiring a connection/middleware pattern; less raw-SQL ergonomics than Drizzle.
- **Reconsider when:** RLS session-var handling or query-shape control becomes a recurring pain, or hot paths need finer SQL control (Drizzle/Kysely as escape hatch).

## ADR-d — Auth provider: Better Auth vs Auth.js vs Supabase Auth
- **Decision:** Authentication + org/membership primitives.
- **Options considered:** (1) Better Auth (self-hosted, Prisma+Postgres adapter); (2) Auth.js v5; (3) Supabase Auth.
- **Chosen:** Better Auth.
- **Reason:** First-class organization / membership / invitation / role primitives map directly onto the canonical entities, self-hosted on our own Neon Postgres — no third-party identity dependency.
- **Tradeoff:** Younger project than Auth.js; we own more of the auth surface.
- **Reconsider when:** Better Auth maturity/maintenance becomes a concern — Auth.js v5 is the documented fallback (Supabase Auth rejected to avoid Supabase coupling since DB is Neon).

## ADR-e — File storage: Cloudflare R2 vs AWS S3
- **Decision:** Where evidence photos and export packs live.
- **Options considered:** (1) Cloudflare R2; (2) AWS S3; (3) Vercel Blob.
- **Chosen:** Cloudflare R2 (S3-compatible), presigned PUT/GET, EU jurisdiction.
- **Reason:** Zero egress fees matter for photo-heavy evidence + repeated audit-pack downloads; S3-compatible API keeps us portable; EU residency for GDPR.
- **Tradeoff:** Slightly less mature ecosystem/tooling than S3; another vendor alongside Neon/Vercel.
- **Reconsider when:** We standardize on AWS for other infra, or R2 EU residency/features no longer satisfy compliance.

## ADR-f — Recurring-task generation: materialize-ahead vs on-read
- **Decision:** How TaskOccurrences come into existence.
- **Options considered:** (1) Materialize ahead on a rolling ~3-day window via daily Inngest job; (2) compute occurrences on-read/virtually; (3) full-horizon precompute.
- **Chosen:** Option 1 — materialize ahead, idempotent via `UNIQUE(scheduled_task_id, occurrence_local_date)`.
- **Reason:** Occurrences are first-class rows needing status, completions, exceptions, notifications, and audit — they must physically exist; a bounded window keeps the table small and overdue sweeps cheap.
- **Tradeoff:** Requires a reliable scheduler and idempotent backfill; recurrence edits must reconcile already-materialized future occurrences.
- **Reconsider when:** Occurrence volume or scheduling flexibility demands a different windowing horizon or on-demand hydration.

## ADR-g — Immutable audit: append-only + versioning + optional hash chain
- **Decision:** How to make compliance records tamper-evident and inspection-trustworthy.
- **Options considered:** (1) Append-only `activity_log` (RLS + Postgres trigger) + versioned immutable TaskCompletion/Evidence + optional per-org hash chain; (2) mutable rows with a soft "updated_at" audit column; (3) external WORM/ledger service.
- **Chosen:** Option 1.
- **Reason:** The product's core promise is "can I prove it happened" — records must never be silently altered; edits create new versions, and DB-level triggers make immutability enforceable, not merely conventional; hash chain adds tamper-evidence for demanding tenants.
- **Tradeoff:** More rows, more write paths (version rows + log rows); no in-place edits; hash chain adds compute.
- **Reconsider when:** A regulator or enterprise tenant demands a certified external ledger, or storage growth requires archival/partitioning.

## ADR-h — PDF export: @react-pdf/renderer vs Puppeteer
- **Decision:** How audit-pack PDFs are rendered.
- **Options considered:** (1) @react-pdf/renderer; (2) headless Chromium (Puppeteer/Playwright); (3) server-side LaTeX/wkhtmltopdf.
- **Chosen:** @react-pdf/renderer.
- **Reason:** No headless-Chromium binary in a serverless runtime; deterministic, tabular-friendly output ideal for audit packs; runs cleanly inside an Inngest job.
- **Tradeoff:** Less flexible layout than full HTML/CSS; complex visual designs are harder.
- **Reconsider when:** Exports need rich HTML-fidelity layouts that @react-pdf cannot express, justifying a dedicated rendering worker.

## ADR-i — Jobs/scheduling: Inngest vs Trigger.dev vs Vercel Cron
- **Decision:** Durable background jobs and scheduling.
- **Options considered:** (1) Inngest; (2) Trigger.dev; (3) raw Vercel Cron.
- **Chosen:** Inngest.
- **Reason:** Durable, retriable, cron + event-driven, serverless-native — fits occurrence generation, overdue sweeps, notification dispatch, and export processing; Vercel Cron lacks retries/fan-out.
- **Tradeoff:** External dependency for critical scheduling; another dashboard/vendor.
- **Reconsider when:** Job volume/cost or control needs shift — Trigger.dev is the documented viable alternative.

## ADR-j — Multi-tenancy: shared DB + org_id + RLS
- **Decision:** Tenant isolation model.
- **Options considered:** (1) Shared database / shared schema with `organization_id` on every tenant table + application scoping + Postgres RLS; (2) schema-per-tenant; (3) database-per-tenant.
- **Chosen:** Option 1, with every composite index leading with `organization_id` and property/outlet scoping layered on top.
- **Reason:** Simplest operable model for one engineer; RLS provides defense-in-depth behind mandatory app scoping; `org_id` as partition key means a large tenant can later be lifted to a dedicated DB without app changes.
- **Tradeoff:** A single app-layer scoping bug is high-blast-radius (mitigated by RLS + the permission/tenant test suite); noisy-neighbor risk on shared resources.
- **Reconsider when:** A large enterprise tenant needs isolation/residency guarantees — lift that org to a dedicated DB using the existing `org_id` partition key.

## ADR-k — Offline/connectivity: write-queue resilience vs true offline-first sync engine
- **Decision:** How to handle connectivity gaps in kitchen environments (walk-in fridges, basements).
- **Options considered:** (1) True offline-first with a sync engine (Electric SQL + PGlite, PowerSync, or CRDT); (2) lightweight IndexedDB write-queue + retry on reconnect; (3) ignore — require connectivity for all writes.
- **Chosen:** Option 2 — IndexedDB write-queue for failed task-completion submits; read operations require connectivity; true offline deferred to V2.
- **Reason:** Our immutable audit trail + versioned completions creates genuine conflict-resolution ambiguity when two offline devices complete the same task occurrence. Which is the authoritative compliance record? That is a legal/product question, not a code problem. Write-queue covers the primary walk-in scenario (submit fails → retry silently on reconnect) with a fraction of the complexity.
- **Tradeoff:** Staff cannot view their task list if the kitchen network is down; only submitted-but-unsynced writes are resilient, not reads.
- **Reconsider when:** Pilot data shows kitchens are dark for extended periods and the read-offline gap matters; V2 path is Electric SQL (Postgres-native, Neon-compatible) once conflict semantics are defined with a food-safety/legal advisor.

## ADR-l — Client-side data layer: TanStack Query v5 alongside RSC
- **Decision:** How live client-side state, caching, and optimistic mutations are managed.
- **Options considered:** (1) TanStack Query v5 for client components + RSC for initial server render; (2) RSC-only with router.refresh() / revalidatePath for all updates; (3) SWR.
- **Chosen:** Option 1 — TanStack Query v5 for interactive client islands (Today list, exceptions, notifications); RSC for all initial page renders (stays unchanged).
- **Reason:** RSC alone requires a full route re-render or tag revalidation to update a list — acceptable for infrequent manager screens, but the Today dashboard needs to reflect task completions from other users within 30–60 seconds without a full refresh. TanStack Query's stale-while-revalidate + background polling + typed optimistic mutations (onMutate/onError/onSettled) gives us the "diff method" — explicit, typed cache invalidation keyed by `[org, outlet, 'today']`. Also primes us for an SSE upgrade (swap polling for a stream) without refactoring components.
- **Tradeoff:** Adds client-side JS; requires discipline on query-key conventions; RSC initial data must be properly hydrated into TanStack Query cache (via `HydrationBoundary`).
- **Reconsider when:** The polling + optimistic pattern proves sufficient and SSE is never needed — TanStack Query could be removed from simpler screens; or a true reactive sync (Electric SQL) renders the polling layer redundant.

## ADR-m — Design-first: Claude designer sprint before frontend code
- **Decision:** When frontend component development starts.
- **Options considered:** (1) Design all 14 screens + flows first, gate frontend milestones on approval; (2) start coding with wireframes, iterate; (3) no upfront design, discover in code.
- **Chosen:** Option 1 — Milestone 0 design sprint using Claude designer; Milestone 4 and all frontend milestones gated on Milestone 0 approval.
- **Reason:** Mobile-first kitchen UX is hard to discover in code; a 10-second task completion and a shared-tablet PIN flow require intentional design decisions (tap-target size, camera trigger placement, error states for threshold failures) that are cheap to change in a design tool and expensive to refactor in code. Milestone 1 (backend/infra) runs in parallel — no delay.
- **Tradeoff:** Adds 1–2 weeks before frontend code starts; designs may not survive first contact with real devices.
- **Reconsider when:** Design sprint reveals a flow too complex to design upfront — in that case prototype one screen in code to validate, then return to full design.

---

# 22. Risks and hard questions

Each risk below is stated as **Risk → Mitigation**. These are the questions a skeptical investor, a design-partner chef, or a food-safety auditor will actually ask. I answer them the way I'd answer in a room, not with hedging.

### Product / market risks

**Customers asking for ERP / inventory / POS / PMS / recipe features → Mitigation:** This is the single most likely way the product dies — death by "just one more module." The stance is explicit and repeated in sales and onboarding: Shift Ledger answers *"what must happen today, what was missed, can I prove it."* Anything touching stock levels, purchase orders, tabs, room folios, or recipe costing is a hard "no, and here's the integration story later." We hold the line by (a) never shipping a feature that requires a new top-level noun outside the canonical entities, and (b) tracking these requests as *integration* candidates (read-only webhooks/export), never as owned domains. Scope creep here is not a roadmap discussion; it's a strategy violation.

**Compliance liability — accidentally claiming legal certification → Mitigation:** We never say "HACCP compliant," "certified," or "legally compliant." Approved language is "HACCP-*style* daily evidence," "documentation and operational proof," "inspection-ready export." A persistent footer on every audit pack and a clause in the ToS/DPA state the tool records evidence the operator is responsible for; it does not certify legal compliance and is not a substitute for the operator's HACCP plan or official inspection. Legal review of all compliance-adjacent copy before GA. This is a founder-level guardrail, not marketing's discretion.

**Staff adoption — frontline speed and language (DE/NL) → Mitigation:** If a line cook won't log a fridge temp in under 10 seconds on a greasy phone, nothing else matters. Mitigations: mobile-first, giant tap targets, the daily action is 1–2 taps (open occurrence → enter value/photo → done), no free-text required for the happy path, optimistic UI so it *feels* instant even on 3G. Full DE and NL localization of the frontline flows and of the starter templates from day one — not just the manager UI. Numbers, thresholds, and pass/fail must read natively. We measure median time-to-complete per occurrence as a first-class product metric; if it drifts above 10s we treat it as a P1 bug.

### Technical risks

**Mobile speed on cheap devices / poor kitchen Wi-Fi → Mitigation:** Server Components keep JS payloads small; the Today view is the only route that must be fast and is aggressively optimized (minimal client JS, prefetched, cached). Evidence photos upload via presigned R2 PUT directly from the device so the app server is never a bottleneck, with client-side downscaling before upload. Optimistic completion marks the task done locally and reconciles. We budget the Today route: < 2s interactive on a mid-range Android over 4G.

**Timezone / DST bugs → Mitigation:** This is where "correct-looking" code silently corrupts an audit trail. Recurrence is a typed object carrying the property's IANA timezone; occurrences are materialized by computing the local wall-clock due time in that timezone and converting to UTC at generation (per the locked spine). All storage in UTC, all display in property-local time. Dedicated test matrix around the DE/NL spring-forward and fall-back transitions (Europe/Berlin, Europe/Amsterdam), including a task scheduled at 02:30 on a skipped/duplicated hour. Idempotency via `UNIQUE(scheduled_task_id, occurrence_local_date)` prevents double-generation across DST.

**Audit-record trust — why should an inspector believe it? → Mitigation:** This is the whole value proposition, so it must be defensible. `TaskCompletion` and `Evidence` are immutable; edits create new version rows plus an `activity_log` entry with before/after, reason, and actor. The `activity_log` is append-only, enforced by both RLS and a Postgres trigger (no UPDATE/DELETE). An optional per-org hash chain (each row stores `prev_hash`) makes tampering detectable — an inspector can be shown that the chain is unbroken. Every record carries actor, server timestamp, and device metadata. The export pack states the methodology. We are honest that this is *tamper-evident*, not *tamper-proof*, and not a qualified electronic signature.

**Custom workflow requests vs. templates-only stance → Mitigation:** No per-customer code, no custom forms engine, no workflow builder in MVP — configuration is *templates only* (check type, required evidence, thresholds, instructions, recurrence). When a customer wants a genuinely new check *shape*, that becomes a new template in the curated `TemplateLibrary`, shipped to everyone, not a bespoke fork. If a request cannot be expressed as a TaskTemplate + Recurrence + evidence types, the honest answer is "not yet / not us." A general workflow builder is explicitly a non-goal.

**File storage cost (evidence photos + PDFs) → Mitigation:** R2 chosen specifically for zero egress fees, which is the cost that would otherwise explode when auditors and managers repeatedly download packs. Control ingest with client-side image downscaling/compression (cap ~1–2MB per photo, strip unneeded EXIF but retain capture timestamp), enforce a per-photo and per-occurrence evidence cap, and apply a retention/lifecycle policy aligned to the legal retention period rather than keeping originals forever. Files are never proxied through the app (presigned GET), so we don't pay egress there either.

**Notification fatigue → Mitigation:** In-app first, email second (Resend), with digest/batching by default. A shift leader gets *one* rolled-up "3 checks overdue" nudge, not three pings. Only genuinely urgent events (a failed critical check, an overdue corrective action) escalate individually. WhatsApp/SMS deliberately out of MVP because they're the fastest route to being muted. Future `NotificationPreference` gives control, but the default must already be respectful.

**Data migration from paper / spreadsheets → Mitigation:** The honest MVP position: we do *not* build a general spreadsheet importer (it's a scope trap and every customer's sheet is different). Onboarding value is the *starter template packs* (DE/NL HACCP) that get a kitchen live in an afternoon without importing history. Historical paper records stay as-is; Shift Ledger is the system of record *going forward*. If a pilot insists on backfill, that's a one-off manual/CSV assist by us, never a shipped feature. Set this expectation in the sales conversation.

### Non-obvious risks I foresee

**Connectivity dead zones — walk-in fridges, basements, prep cellars, no offline mode → Mitigation:** The exact moment you record a fridge temperature is often the moment you have no signal. Offline-first sync is explicitly a non-goal (it's a huge complexity and conflict-resolution burden), so we mitigate pragmatically: the completion form is a small client component that holds the entered value/photo locally and submits when connectivity returns, with clear "not yet saved" state and retry — a lightweight queue, *not* a full offline CRDT sync engine. Photos captured offline queue the presigned upload. We validate the real connectivity situation in pilots (see §23) before deciding whether even this lightweight queue is enough; if kitchens are truly dark for minutes, we widen the client-side buffer, not the architecture.

**"Who actually signed?" — repudiation / shared-device problem → Mitigation:** Kitchens share one wall tablet; ten people tap "done" as whoever is logged in. An inspector's killer question is "can you prove *this person* did this check?" We are honest about the ceiling: initials/signature evidence and per-user login raise assurance but this is not a qualified electronic signature (eIDAS). Mitigations: capture actor + device metadata + server timestamp on every completion; support a fast per-user PIN/initials step on shared devices so the actor recorded is the actor who tapped, not just "the tablet's session"; record it plainly in the audit pack. We do not overclaim non-repudiation.

**Multi-language template drift and correctness → Mitigation:** A HACCP threshold or instruction mistranslated between DE and NL isn't a cosmetic bug — it's a food-safety and liability bug. Starter templates must be authored/reviewed by a native-language food-safety professional per locale, not machine-translated. Template content is versioned; a threshold change creates a new template version rather than silently editing live tasks. Numeric thresholds (e.g. fridge ≤ 4°C) are locale-independent data, not translated strings, to avoid "4°C" becoming garbled in translation.

**Cross-property Ops Manager scope leakage → Mitigation (bonus):** Multi-property viewers are exactly where a tenant-isolation bug leaks one hotel's records into another's export. Every query is org-scoped at the application layer *and* by RLS (`app.current_org_id`); property/outlet scoping layers on top; every composite index leads with `organization_id`. Export jobs re-assert scope at generation time so a stale filter can never widen access.

# 23. Final recommendation

### Recommended architecture summary

Build Shift Ledger as a **single Next.js 15 (App Router) TypeScript monolith on Vercel** backed by **PostgreSQL on Neon (EU)** via **Prisma**. Reads are tenant-scoped Prisma queries issued from React Server Components; writes are typed Server Actions colocated with the UI. A **thin REST surface** exists only for what must live outside React — presigned upload issuance, export downloads, and Inngest/cron triggers — and Section 11's REST contract documents the *logical* domain API even though most of it is implemented as Server Actions in the MVP. This is deliberately boring, and boring is the point: one engineer can hold the whole thing in their head, there is no service mesh to operate, and every piece is durable and well-trodden.

Multi-tenancy is **shared-schema with `organization_id` denormalized onto every tenant table**, enforced twice — mandatory application scoping *plus* Postgres RLS as defense-in-depth — with every composite index leading on `organization_id`. This buys correctness now and a clean escape hatch later: a large tenant can be lifted to a dedicated database without touching application code, because org_id is already the partition key.

The compliance core is the moat, and it's built on **immutability**: `TaskCompletion` and `Evidence` never mutate; edits write new versions; the **append-only `activity_log`** (RLS + trigger enforced, optional per-org hash chain) is the tamper-evident spine an inspector can trust. Recurring work is **materialized ahead on a rolling ~3-day window** by an idempotent daily job, with a ~10-minute sweep transitioning due → overdue — all **DST-safe** by computing local wall-clock times in the property's IANA timezone and storing UTC. **Inngest** runs generation, sweeps, notification dispatch, and async PDF export; **Cloudflare R2** stores evidence and audit packs (zero egress) behind presigned URLs; **@react-pdf/renderer** produces deterministic, serverless-friendly audit packs. Auth is **Better Auth** (self-hosted org/membership/invitation/role primitives). Everything is EU-resident and GDPR-aware.

### Recommended stack

| Concern | Choice | Why |
|---|---|---|
| App shell | Next.js 15 App Router (TS), Vercel | One monolith, RSC + Server Actions, no separate backend to run |
| Data access (initial read) | React Server Components + Prisma | Tenant-scoped queries at the edge of the render; tiny client JS |
| Data access (live client read) | GraphQL (graphql-yoga + Pothos + DataLoader) via TanStack Query | Typed, field-precise, future-mobile-ready; DataLoader mandatory (no N+1 — F1); subscription upgrade path (ADR-b, D10) |
| Data access (write) | Server Actions (Zod-validated) + idempotency keys | Typed, colocated, optimistic-friendly; no tRPC needed; idempotent under offline retry (F2) |
| Thin REST | Next route handlers | Only for uploads, export download, cron/webhooks, future mobile API |
| Database | PostgreSQL on Neon (EU) | Managed, serverless-friendly Postgres in EU jurisdiction |
| ORM | Prisma, UUID v7 PKs | Time-sortable, index-friendly, db-generated keys |
| Multi-tenancy | Shared schema + `organization_id` + RLS | Defense-in-depth isolation; future per-tenant DB lift without code change |
| Auth | Better Auth (self-hosted) | First-class org/membership/invite/role; Prisma+Postgres; Auth.js v5 fallback |
| File storage | Cloudflare R2 (S3-compatible, EU) | Zero egress fees for photos + PDF packs; presigned PUT/GET |
| Background jobs | Inngest | Durable, retriable, cron + event fan-out; serverless-native |
| PDF export | @react-pdf/renderer | Deterministic tabular packs, no headless Chromium |
| Notifications | In-app table first, Resend email second | Digest/batched; WhatsApp/SMS deferred |
| Validation | Zod (shared) | One schema across Server Actions and REST |
| Monitoring | Sentry + pino + Vercel logs | Errors, structured logs, platform analytics |
| Compliance stance | Documentation/proof tool, GDPR-aware, EU-resident | Never legal certification; DPA-ready |

### What to build first

The **Today dashboard → task completion → evidence → immutable activity log → audit export** vertical slice, for a single outlet, in German. That is the entire product promise ("what must happen today, was it missed, can I prove it") in one path. Everything else (multi-property rollups, corrective-action workflows, notification digests) hangs off this spine and can follow once the core loop is fast and trustworthy.

### What to avoid

- Any ERP/inventory/procurement/POS/PMS/recipe/allergen-DB/payroll/scheduling module — hard no, forever in MVP.
- A custom forms engine or workflow builder — configuration is **templates only**.
- Offline-first CRDT sync — use a lightweight client submit-queue instead (see §22).
- tRPC, microservices, headless-Chromium PDF, and any "clever" architecture that a single engineer can't operate at 2am.
- Overclaiming: no "certified/legally compliant," no "non-repudiation," no qualified e-signature.
- General spreadsheet import as a shipped feature.

### What MUST be validated before writing code

1. **Pilot commitment:** 2–3 real DE/NL hotel kitchens signed as design partners *before* build, with a named Executive Chef or Food Safety Manager per site.
2. **HACCP template content with a real chef:** the DE and NL starter packs — check types, thresholds (fridge ≤ 4°C, hot-hold ≥ 63°C, etc.), required evidence, instructions — reviewed by a native-language food-safety professional, not invented by engineering.
3. **DE/NL legal-record retention expectations:** how long food-safety records must be retained and in what form, so retention/lifecycle and export format are right from day one. (Validate; do not assume.)
4. **Connectivity reality:** physically test signal in walk-in fridges, cellars, and prep areas at pilot sites to size the client submit-queue and confirm offline-first remains a non-goal.
5. **Shared-device / actor-identity reality:** how staff actually log in on shared tablets, to design the PIN/initials actor-capture step.
6. **Time-to-complete target:** confirm the < 10s single-occurrence completion is achievable on the pilots' actual devices and network.

### First 10 engineering tasks, in order

1. **Foundations:** Next.js 15 + TS + Prisma + Neon (EU) project; Sentry + pino wiring; base CI. TanStack Query provider + graphql-yoga/Pothos `/api/graphql` scaffold with DataLoader plugin, query depth/complexity limits, and introspection disabled in prod (D10, F1, F7). Deploy a hello-world to Vercel to prove the pipeline. *(Runs in parallel with Milestone 0 design sprint — D11.)*
2. **Auth + tenancy skeleton:** Better Auth with Organization / Membership / Invitation / Role; seed one org, one user. Establish the org-scoped request context.
3. **RLS + tenant scoping:** enable Postgres RLS keyed on `app.current_org_id`; set the session var per request; add the org-leading composite index convention. Write an isolation test proving org A cannot read org B.
4. **Core schema migration:** Organization → Property → Outlet, User/Membership, TaskTemplate, ScheduledTask, TaskOccurrence, TaskCompletion, Evidence, Attachment, Exception, CorrectiveAction, ActivityLog, Notification, ExportJob/AuditPack — with the canonical relationships and UUID v7 PKs.
5. **Append-only ActivityLog:** the Postgres trigger + RLS forbidding UPDATE/DELETE; write helper for state transitions; optional `prev_hash` chain scaffold. Test that a DELETE/UPDATE is rejected.
6. **Recurrence + occurrence generation (Inngest):** typed Recurrence object, DST-safe local→UTC computation in the property timezone, daily rolling ~3-day materialization, idempotent on `UNIQUE(scheduled_task_id, occurrence_local_date)`. Include the DST spring/fall test matrix.
7. **Overdue sweep (Inngest):** ~10-minute job transitioning due → overdue and emitting the events that later feed notifications.
8. **Today dashboard + task completion:** the fast Today RSC route (initial render) + a DataLoader-backed GraphQL query for live list updates (constant query count — F1); completion Server Action (Zod-validated) writing an immutable TaskCompletion + ActivityLog entry, with a **client-submission idempotency key** (F2) and a **server-authoritative `recorded_at`** (F3); optimistic UI; German localization of the frontline flow. This is the product's heartbeat — budget it to < 2s interactive / < 10s to complete.
9. **Evidence upload:** `POST /api/uploads` presigned R2 PUT, client-side image downscale, Evidence + Attachment records; short-lived presigned GET for viewing. Enforce per-occurrence evidence caps.
10. **Audit export pipeline:** ExportJob (queued → processing → completed → failed) on Inngest, @react-pdf/renderer audit pack, stored in R2, delivered via `GET /api/exports/:id/download` signed URL — with the "documentation, not certification" methodology footer.

Keep it narrow. This is a scope one strong full-stack engineer can build and operate, precisely because every decision above favors **durable over clever**: a boring monolith, a boring database, twice-enforced tenancy, immutable records, and jobs that retry themselves. The way this product wins is not architectural sophistication — it's a kitchen manager tapping "done" in eight seconds and an inspector believing the record six months later.

---

# Appendix A — Milestone 0 design brief (Claude designer prompt)

This is the copy-pasteable brief to hand to the Claude designer to produce the Milestone 0 screen designs (D11). Paste it as-is; it is self-contained.

> **Product:** "Shift Ledger" — a fast, opinionated daily food-safety command center for hotel kitchens. It answers one question for a kitchen manager: *"What must happen today, what was missed, and can I prove it happened?"* Think the speed and restraint of **Linear, Stripe, and Vercel** — NOT enterprise hotel software. Launch market: Germany & Netherlands (design in English, but every label must be short enough to also work in German, which runs ~30% longer).
>
> **Who uses it:** Frontline kitchen staff and shift leaders on **phones and shared wall-mounted tablets** (they complete checks); kitchen/property managers and food-safety managers on **desktop and phone** (they review, resolve, export); owners/auditors as viewers. Frontline = mobile-first, one-handed, often with greasy hands in a hot kitchen. Managers = desktop-dense but still clean.
>
> **Non-negotiable feel:** Every daily action completes in **under 10 seconds**; the most common flow (open Today → tap a task → enter a value/photo → done) is **1–2 taps**. Big tap targets. No deep menus. No modal stacked more than one level. Optimistic — tapping "done" feels instant.
>
> **Design these 14 screens.** For each: a mobile (375px) and, where noted, a desktop (1280px) frame. Show realistic content (fridge temperatures, cleaning checks, allergen checks — not lorem ipsum), and show the **empty**, **loading**, and **error/failed** states, not just the happy state.
>
> **A. Frontline / mobile-first (design mobile 375px first):**
> 1. **Login** — email + password, "select your organization" if the user belongs to more than one. Minimal.
> 2. **Today dashboard (frontline)** — the home screen. A scannable list of *this outlet's* tasks for today grouped by status: **Due now**, **Upcoming**, **Overdue** (visually loud/red), **Done** (collapsed). Each row: task name, check type icon (temperature/cleaning/allergen/opening/closing), due time, one-tap complete affordance. A bottom nav bar (Today / Exceptions / Timeline / More). Show a "3 pending sync" indicator for queued-offline submissions.
> 3. **Task detail** — opened from a row: what the check is, its target (e.g. "Fridge must be ≤ 4°C"), instructions, and a big primary "Complete" button.
> 4. **Complete-task flow** — the heart of the product. A focused sheet where the user: enters a **temperature** on a big numeric keypad with the pass/fail threshold shown inline (green if ≤4°C, red if over); and/or takes a **photo** (camera-first, shows a compressing thumbnail); and/or ticks a **checkbox**; and/or adds **initials/signature**. One clear "Submit" that returns to Today with the row flipping to Done. Must feel completable in seconds.
> 5. **Failed check flow** — when a value fails the threshold (e.g. fridge reads 9°C): the UI clearly flags FAIL, explains a corrective action is needed, and lets the user note what they did / will do, then submit. This must feel serious but fast, not punishing.
> 6. **Shared-tablet actor confirmation** — a lightweight "Who are you?" step for shared devices: pick your name from the outlet's staff + a 4-digit PIN (or initials). Fast, big keypad. This stamps *who* did the check.
>
> **B. Manager / desktop (design desktop 1280px, with a mobile variant for 7, 8, 9):**
> 7. **Manager Today (multi-outlet rollup)** — a manager's overview across their property's outlets: a compliance-health summary (e.g. "Main Kitchen 12/14 done, 1 overdue, 1 failed"), drill into any outlet's Today.
> 8. **Exceptions view** — a list/board of open exceptions (failed checks) with severity, outlet, age, status (open → acknowledged → in progress → resolved → verified). Filterable. This is where a manager triages problems.
> 9. **Corrective actions view** — actions arising from exceptions: assignee, due date, status (open → assigned → done → verified/rejected). Assign, complete, verify.
> 10. **Timeline** — a clean, single append-only activity stream: *who · did what · to what · when*, with before/after for edits and the reason. This is the "proof" surface; it should read like a trustworthy ledger, calm and legible.
> 11. **Audit export** — pick a date range, property, outlet, check type, status; a preview of what the pack will contain (completed, missed, failed, corrective actions, evidence); a "Generate" button that produces a PDF (async — show queued/processing/ready states with a download when ready). Include a visible footer note: *"Operational documentation, not a legal compliance certification."*
> 12. **Templates** — a flat list of the org's task templates (check type, target threshold, required evidence, instructions), plus "add from starter library (DE/NL HACCP)". Minimal, opinionated — no complex form builder.
> 13. **Schedule settings** — turn a template into a recurring scheduled task: daily/weekly/monthly, time of day, assign to a role or person. Keep it simple.
> 14. **User management + Property/outlet settings** — invite users by email with a role; list members; manage properties and their kitchens/outlets. Flat, short forms.
>
> **Also deliver:**
> - **Navigation architecture**: mobile bottom bar + top header; desktop left sidebar + content; the task-detail-as-modal-over-Today pattern on desktop.
> - **Component inventory / mini design system**: color tokens (with a clear semantic set — pass/green, fail/red, overdue/amber, neutral), type scale, spacing, and the reusable pieces — buttons, inputs, the numeric keypad, status badges, task cards, the evidence/photo upload widget, and the timeline row.
> - **User-flow diagrams** for the 6 core journeys: (A) manager creates a recurring daily task; (B) staff completes a task with evidence; (C) a failed check creates an exception + corrective action; (D) manager reviews and resolves open exceptions; (E) inspector arrives → manager generates and hands over an audit pack; (F) multi-property manager reviews compliance health across sites.
>
> **Constraints:** mobile-first, thumb-reachable primary actions, WCAG-AA contrast (kitchens are bright/glare-y), color-blind-safe status (never rely on red/green alone — pair with icon/label), and restraint everywhere. When in doubt, remove. This should look like a tool a busy chef *wants* to use, not compliance software they're forced to.

**Delivery note:** review the designs against the D-decisions before approving — especially that the Complete-task flow (screen 4) genuinely hits < 10s, the shared-tablet PIN step (screen 6) exists, and the audit export (screen 11) carries the non-certification disclaimer. Approval of these designs unblocks Milestones 4+ (D11 gate).

---

# Appendix B — Design system specification (and designer prompt)

The single source of truth for Shift Ledger's visual language. **Design and code share these exact tokens** — the design system IS shadcn/ui + Radix + Tailwind, so a component in the design maps 1:1 to a component in the build. This appendix is complete enough to hand to the designer AND to seed `globals.css` + `tailwind.config`.

## B.1 Theming tech
- **Tailwind CSS v4** (CSS-first `@theme`), **shadcn/ui** components, **Radix UI** primitives (behavior + a11y), **Lucide** icons.
- **Fonts are self-hosted (vendored `.woff2`), never CDN-loaded** — via the `geist` npm package / `next/font` (zero layout shift). This is a **GDPR decision, not just performance**: German courts have penalized sites for leaking visitor IPs to the Google Fonts CDN, so for a DE/NL launch we self-host. It also gives faster first paint (no third-party round-trip) and works offline on flaky kitchen networks — and keeps design==code fully offline.
- **Light + dark themes** via a `.dark` class on `<html>`, managed by **next-themes**. **Light is the primary theme** (kitchens are bright/glare-y); dark is a first-class secondary.
- Tokens are **OKLCH CSS variables** in `globals.css` (the current shadcn + Tailwind v4 default — perceptually uniform, easier to derive dark theme and hover/active shades; `--background`, `--primary`, …). Hex values below are the designer's reference; convert to OKLCH in code.
- Do **not** invent component patterns — compose from shadcn primitives. The only additions to stock shadcn are the **status tokens** (B.3) and the **domain components** (B.7).

## B.2 Color tokens

Base (shadcn semantic variables):

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#FFFFFF` | `#0F172A` | App canvas |
| `foreground` | `#0F172A` | `#F8FAFC` | Primary text |
| `card` | `#FFFFFF` | `#1E293B` | Cards, task rows, sheets |
| `card-foreground` | `#0F172A` | `#F8FAFC` | Text on cards |
| `popover` / `popover-foreground` | `#FFFFFF` / `#0F172A` | `#1E293B` / `#F8FAFC` | Menus, dropdowns |
| `muted` | `#F1F5F9` | `#1E293B` | Subtle fills, disabled |
| `muted-foreground` | `#64748B` | `#94A3B8` | Secondary text, meta |
| `border` | `#E2E8F0` | `#334155` | Dividers, outlines |
| `input` | `#E2E8F0` | `#334155` | Field borders |
| `ring` | `#4F46E5` | `#6366F1` | Focus ring |
| `primary` | `#4F46E5` (indigo-600) | `#6366F1` (indigo-500) | Brand, primary actions |
| `primary-foreground` | `#FFFFFF` | `#FFFFFF` | Text on primary |
| `secondary` | `#F1F5F9` | `#1E293B` | Secondary buttons |
| `secondary-foreground` | `#0F172A` | `#F8FAFC` | Text on secondary |
| `accent` | `#EEF2FF` (indigo-50) | `#312E81` (indigo-900) | Hover/selected tint |
| `destructive` | `#DC2626` | `#EF4444` | Dangerous actions |
| `destructive-foreground` | `#FFFFFF` | `#FFFFFF` | Text on destructive |

**Brand = indigo, deliberately NOT green** — green is reserved exclusively for the *pass* status so a green control never reads as "this passed." Neutrals are **Slate** (cool, calm, Linear/Vercel-adjacent).

## B.3 Status semantics (LOCKED — this is a compliance product)

| Status | Solid | Subtle bg (light) | Text (light) | Lucide icon | Meaning |
|---|---|---|---|---|---|
| `status-pass` | `#16A34A` | `#F0FDF4` | `#15803D` | `CheckCircle2` | Check passed / done |
| `status-fail` | `#DC2626` | `#FEF2F2` | `#B91C1C` | `XCircle` | Threshold failed |
| `status-overdue` | `#D97706` | `#FFFBEB` | `#B45309` | `AlertCircle` | Past due, not done |
| `status-pending` | `#64748B` | `#F1F5F9` | `#475569` | `Circle` | Not yet due / upcoming |
| `status-critical` | `#B91C1C` | `#FEF2F2` | `#991B1B` | `AlertOctagon` | Critical severity (cold-chain breach) |
| `status-info` | `#2563EB` | `#EFF6FF` | `#1D4ED8` | `Info` | Neutral system info |

In dark theme use the brighter variants (`pass #22C55E`, `fail #EF4444`, `overdue #F59E0B`, `info #3B82F6`) with subtle backgrounds at ~15% opacity of the solid.

**Color-blind-safe rule (non-negotiable):** status is NEVER conveyed by color alone — always **color + icon + text label**. A red dot without an icon/word is a bug.

## B.4 Typography
- **Geist Sans** for all UI; **Geist Mono** for numeric readouts (temperatures), timestamps, and codes (tabular alignment + unmistakable digits).
- **Inputs render at ≥16px on mobile** to prevent iOS auto-zoom.

| Role | Size / Line-height / Weight | Notes |
|---|---|---|
| Display | 36 / 40 / 700 | Marketing / big empty states |
| H1 | 30 / 36 / 700 | Page title |
| H2 | 24 / 32 / 600 | Section |
| H3 | 20 / 28 / 600 | Card title |
| Body-lg | 18 / 28 / 400 | Task detail body |
| Body | 16 / 24 / 400 | Default |
| Body-sm | 14 / 20 / 400 | Secondary/meta |
| Caption | 12 / 16 / 500 | Labels, badges |
| **Readout (mono)** | 24–32 / 1.1 / 600 | Temperature value; colored by pass/fail |

Heading tracking −0.02em; body normal.

## B.5 Spacing · radius · shadow · motion · breakpoints · z-index
- **Spacing:** 4px base; scale 4·8·12·16·20·24·32·40·48·64. **Minimum touch target 44×44px** (frontline is a priority).
- **Radius:** `--radius` = 8px. Buttons/inputs 8, cards/sheets 12, badges/pills full, avatars full.
- **Shadow:** `sm` 0 1 2 rgba(0,0,0,.05) · `md` 0 4 6 −1 rgba(0,0,0,.08) · `lg` 0 10 15 −3 rgba(0,0,0,.10). Use sparingly; dark theme prefers borders over shadows.
- **Motion:** micro 150ms · default 200ms · sheets/modals 300ms; easing `cubic-bezier(0.16,1,0.3,1)` for enter (snappy Linear feel). **Respect `prefers-reduced-motion`.** No gratuitous animation on the completion flow — it must feel instant.
- **Breakpoints (mobile-first):** base 0 · sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536. Design targets: **phone 375**, tablet 768/834, desktop 1280.
- **Z-index:** dropdown 1000 · sticky 1100 · backdrop 1200 · modal/sheet 1300 · popover 1400 · toast 1500 · tooltip 1600.

## B.6 Iconography
**Lucide**, stroke width 2. Sizes: 16 inline, 20 default (buttons/nav), 24 large. Check-type icons: temperature `Thermometer`, cleaning `SprayCan`, allergen `Wheat`/`ShieldAlert`, opening `Sunrise`, closing `Moon`, generic `ClipboardCheck`.

## B.7 Component inventory (with states & phase)

States shorthand: **D**efault · **H**over · **F**ocus-visible · **A**ctive · **Disabled** · **Loading** · **Error**. All primitives are shadcn/ui.

| Component | Variants | Key states | Phase needed |
|---|---|---|---|
| **Button** | primary, secondary, ghost, outline, destructive, link; sizes sm/md/lg/icon | D/H/F/A/Disabled/**Loading** (spinner + disabled) | M0/M2 |
| **Input (text/email/password)** | with label, hint, error, prefix/suffix icon | D/F/Error/Disabled | M0/M2 |
| **Numeric keypad** (domain) | large on-screen keypad for temperature | live pass/fail recolor of the readout vs threshold | M0 → M5 |
| **Threshold readout** (domain) | mono value + unit (°C) + pass/fail icon+label | pass (green), fail (red), empty | M0 → M5 |
| **Textarea / Select / Combobox** | shadcn | D/F/Error/Disabled | M2/M3 |
| **Checkbox / Radio / Switch** | shadcn | D/checked/F/Disabled | M0/M3 |
| **Date & time picker** | range (for exports), single | D/F/selected | M3/M8 |
| **Status badge** (domain) | the 6 status tokens (B.3) | color+icon+label; sizes sm/md | M0 |
| **Task card / Today row** (domain) | due, upcoming, overdue, done (collapsed), failed, **pending-sync** | swipe/tap-to-complete affordance; loading skeleton | M0 → M4 |
| **Evidence upload widget** (domain) | photo (camera-first), file | idle, capturing, **compressing** (thumb + progress), uploaded, **error/retry**, offline-queued | M0 → M5 |
| **Signature / initials pad** (domain) | draw (canvas) or typed initials | empty, drawn, cleared | M0 → M5 |
| **Timeline row** (domain) | actor · action · subject · time; edit shows before→after + reason | default, system-actor style, edit-highlight | M0 → M7 |
| **Toast** | success, error, info; with action | enter/exit; auto-dismiss | M0/M2 |
| **Dialog / Sheet / Drawer** | center dialog (desktop), bottom sheet (mobile) | open/close; one level deep max | M0/M4 |
| **Dropdown / Context menu** | shadcn (Radix) | roving focus, disabled items | M2 |
| **Data table** (manager) | sortable, filterable, empty; keyset "load more" | loading skeleton, empty, error | M6/M8 |
| **Filter bar** | date range, property, outlet, check type, status | applied/clear | M8 |
| **Tabs / Segmented control** | Today status groups, exception states | selected/hover | M4/M6 |
| **Avatar / user chip** | initials fallback, image | — | M2 |
| **Navigation — mobile bottom bar** | Today · Exceptions · Timeline · More (4 max) | active tab, badge count | M0/M4 |
| **Navigation — desktop sidebar** | collapsible; org/property switcher at top | active, hover, collapsed | M0/M4 |
| **Header/top bar** | title, actions, org switcher, notifications bell (badge) | — | M0/M2 |
| **Empty state** (domain) | per screen (no tasks today, no exceptions, no members) | illustration/icon + one CTA | M0 (all screens) |
| **Loading skeleton** | list, card, table shapes | shimmer (respect reduced-motion) | M0/M4 |
| **Error / offline banner** | inline + full-page | retry action | M0/M4 |
| **Command menu (⌘K)** | RESERVED — visual placeholder only | — | post-MVP (reserve now) |

## B.8 Accessibility (WCAG-AA, baked in)
Contrast ≥ 4.5:1 body text / 3:1 large text & UI borders · visible `focus-visible` ring (2px, offset 2, `ring` token) · min 44px touch targets · **status = color + icon + label** always · labels always visible (never placeholder-as-label) · error text tied via `aria-describedby` · Radix provides roving focus, aria roles, focus trapping for dialogs/menus for free — use it, don't rebuild it.

## B.9 Content & i18n
Design in EN, but **German runs ~30% longer** — no fixed-width labels, allow wrap/truncation with tooltip, test the longest DE string per control. **24-hour clock** and **°C** for DE/NL. Numbers/temps in Geist Mono. Microcopy: plain, calm, imperative ("Enter fridge temperature"), never alarmist except genuine critical failures.

## B.10 Paste-in prompt (condensed, for the designer)

> Build all screens on the **shadcn/ui design system** (Radix primitives, Tailwind v4 tokens, Lucide icons, **Geist Sans** + **Geist Mono**). Do not invent component patterns — compose from shadcn.
> **Theme:** light-primary + dark, via CSS variables. **Brand = indigo** (`#4F46E5` light / `#6366F1` dark). Neutrals = **Slate**. Radius 8px (cards 12). Motion snappy (150–200ms), respect reduced-motion.
> **Status colors (locked, always color+icon+label):** pass green `#16A34A` (CheckCircle2), fail red `#DC2626` (XCircle), overdue amber `#D97706` (AlertCircle), pending slate `#64748B` (Circle), critical `#B91C1C` (AlertOctagon), info blue `#2563EB` (Info). Green is ONLY for pass — never a primary button.
> **Type scale:** H1 30/700, H2 24/600, H3 20/600, body 16/400, sm 14, caption 12/500; temperature readout in Geist Mono 24–32/600, recolored live by pass/fail. Inputs ≥16px on mobile.
> **Spacing** 4px base; **min touch target 44px**. **Breakpoints** mobile-first, targets 375 / 768 / 1280.
> **Deliver these components with all states (default/hover/focus/active/disabled/loading/error):** buttons, inputs, numeric keypad + threshold readout, checkbox/radio/switch, select/combobox, date-range picker, status badge, Today task card (due/upcoming/overdue/done/failed/pending-sync), evidence upload widget (idle/compressing/uploaded/error/offline-queued), signature pad, timeline row (with before→after edit), toast, dialog + bottom sheet, dropdown menu, data table (sortable/empty/skeleton), filter bar, tabs, avatar, mobile bottom nav (4 items), desktop sidebar with org switcher, header with notifications bell, empty states, loading skeletons, offline/error banners. Reserve a ⌘K command-menu placeholder (do not build it).
> **Accessibility:** WCAG-AA contrast, visible focus rings, status never color-only, labels always visible.
> **i18n:** allow ~30% longer German labels; 24h clock; °C.