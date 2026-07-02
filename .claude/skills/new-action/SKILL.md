---
name: new-action
description: Scaffold a tenant-safe Server Action for Shift Ledger — a Zod-validated write routed through withTenant(), with an append-only activity_log entry, F2 idempotency key, and F3 server-authoritative timestamps, plus a colocated Vitest. Use when adding a write/mutation, creating a Server Action, or when asked to "add an action", "scaffold a mutation", or "let users create/update/delete X".
---

# new-action

Generates a write path that is **RLS-safe by construction** per `conventions.md` and the F-principles. In this repo: **reads = RSC → Prisma; writes = Server Actions (Zod-validated); GraphQL is read-only; no tRPC.** Every tenant-scoped query goes through `withTenant()` — a raw query outside it returns zero rows by design (default-deny), and bypassing the wrapper is a security bug.

## Preflight

1. **Issue-first.** There must be a GitHub issue for this write (§1). If not, stop and create one (use **start-issue**).
2. **`zod` installed.** It's prescribed but not yet a dependency. Check `package.json`; if absent: `npm install zod` (that install is itself in-scope for the write's issue).
3. **Auth seam.** Tenant + actor identity come from the Better Auth session (`#39–#42`), never from the client. If `src/lib/auth.ts` doesn't yet export a session/org helper, scaffold against `requireOrgContext()` and leave a clear `TODO(#39)` so the action is not exposed until it resolves. **Do not** accept `organizationId` or `actorUserId` as client input.

## Gather

- **Feature / resource** (e.g. `outlet`), **verb** (`create` | `update` | `delete` | a domain transition), and the **input fields** the client actually supplies.
- **`subjectType`** — must be a value of the `ActivitySubjectType` enum (`organization | property | outlet | membership | invitation | user`; extend the enum via a migration if you need a new one — that's a separate schema issue).
- **`action` string** — canonical `"<subject>.<verb>"`, e.g. `"outlet.created"`.

## Template — `src/app/<feature>/actions.ts`

```ts
"use server";

import { z } from "zod";
import { withTenant } from "@/lib/db";
import { requireOrgContext } from "@/lib/auth"; // Better Auth session (#39–#42): { organizationId, actorUserId }

// Client supplies ONLY the payload + an idempotency key (F2). Tenant + actor are
// server-derived from the session — never trust them from the client.
const CreateOutletInput = z.object({
  clientSubmissionId: z.string().uuid(), // F2: dedupe key for retryable submits
  propertyId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

export async function createOutlet(raw: unknown) {
  const input = CreateOutletInput.parse(raw); // validate at the boundary
  const { organizationId, actorUserId } = await requireOrgContext();

  return withTenant(organizationId, async (tx) => {
    // F2 idempotency: if this clientSubmissionId already produced a row, return it
    // instead of creating a duplicate (add the dedupe column/lookup on the target table).

    const outlet = await tx.outlet.create({
      data: { organizationId, propertyId: input.propertyId, name: input.name },
      // F3: created_at defaults to now() in the DB — server-authoritative, never client-set.
    });

    // F4: single state-transition choke point → append-only activity_log.
    await tx.activityLog.create({
      data: {
        organizationId,
        subjectType: "outlet",
        subjectId: outlet.id,
        action: "outlet.created",
        actorUserId,
        afterJson: outlet,
      },
    });

    return outlet;
  });
}
```

Adapt names/fields to the resource. Rules that don't change:
- **Validate with Zod** first; parse `unknown`, never cast.
- **`organizationId`/`actorUserId` from the session**, inside `withTenant(organizationId, …)`.
- **The domain write and its `activity_log` entry share the one transaction** (F4) so they commit or roll back together.
- **`activity_log` is append-only** — only ever `create`; never update/delete it (the DB trigger rejects that anyway).
- For updates, capture `beforeJson` (pre-image) and `afterJson`; compliance records are immutable → edits create versions, never mutate.

## Test — `tests/<feature>-action.test.ts`

Mirror `tests/foundation.test.ts`: inject the seeded org ids, and assert both the happy path **and** tenant isolation.

```ts
import { describe, it, expect, inject, afterAll } from "vitest";
import { withTenant, disconnect } from "../src/lib/db";
import { createOutlet } from "../src/app/<feature>/actions";

const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => { await disconnect(); });

describe("createOutlet", () => {
  it("writes the row and an activity_log entry in Org A's scope", async () => {
    // ...call the action (stub requireOrgContext to return orgAId) and assert the row +
    // the "outlet.created" activity_log entry both exist under orgAId.
  });

  it("never lets Org A's write appear in Org B's scope", async () => {
    // create under orgAId, then assert withTenant(orgBId, …) cannot see it.
  });
});
```

## Finish

Run `npm run typecheck && npm test`. Keep the change scoped to the issue; anything extra → a new issue. Then use **open-pr**.
