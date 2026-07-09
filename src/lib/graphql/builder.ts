// Pothos code-first schema builder (#15) — the single builder every object type + Query field
// registers against. Two plugins are wired in from day one, both non-negotiable per the design:
//
//  - @pothos/plugin-scope-auth: resolver-level authorization ON TOP OF Postgres RLS (D6). Every read
//    is at minimum `member`-scoped (an authenticated active org member); management/triage reads add a
//    `minRole` scope. Scope-auth is a defence-in-depth layer: RLS still tenant-isolates every query, so
//    a cross-org id is masked as not-found regardless of scope (see resolvers).
//  - @pothos/plugin-dataloader: batches per-row relation loads (F1). The Today list resolves each
//    occurrence's current completion + evidence count through a per-request DataLoader, so the query
//    count stays constant (a bounded number of round-trips) regardless of how many occurrences load.
//
// ScopeAuthPlugin MUST be listed first (Pothos requirement so it wraps every resolver).
import SchemaBuilder from "@pothos/core";
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
import DataloaderPlugin from "@pothos/plugin-dataloader";
import { OrgRole } from "../../generated/prisma/enums";
import type { GraphQLContext } from "./context";

// Read-access rank for the `minRole` scope. This orders roles for READ gating ONLY and is deliberately
// distinct from the write role matrices in src/lib/permissions.ts (which govern state transitions, #17).
// The read-only external roles (Auditor / ExternalInspector) are ranked as read-privileged — they exist
// to review the compliance record, so they clear triage/management read gates — but they never write.
const READ_RANK: Record<OrgRole, number> = {
  [OrgRole.Owner]: 100,
  [OrgRole.OrgAdmin]: 90,
  [OrgRole.Auditor]: 85, // read-privileged external reviewer (read-only)
  [OrgRole.ExternalInspector]: 85, // read-privileged external reviewer (read-only)
  [OrgRole.PropertyManager]: 80,
  [OrgRole.KitchenManager]: 70,
  [OrgRole.ShiftLeader]: 60,
  [OrgRole.Staff]: 50,
};

/** True if `role` meets or exceeds the read-access rank required by `minimum`. */
export function readRankMeets(role: OrgRole, minimum: OrgRole): boolean {
  return READ_RANK[role] >= READ_RANK[minimum];
}

export const builder = new SchemaBuilder<{
  Context: GraphQLContext;
  // Passthrough JSON scalar for the frozen config_snapshot blob (§8.13).
  Scalars: {
    JSON: { Input: unknown; Output: unknown };
  };
  // Output fields are NON-NULL by default (a stable read contract for the client + a future native
  // mobile client, ADR-b); genuinely-optional fields opt in with `nullable: true`.
  DefaultFieldNullability: false;
  // `member`: any authenticated active org member. `minRole`: a parametrized scope — the field declares
  // the minimum read rank and scope-auth resolves it against the caller's role.
  AuthScopes: {
    member: boolean;
    minRole: OrgRole;
  };
}>({
  defaultFieldNullability: false,
  plugins: [ScopeAuthPlugin, DataloaderPlugin],
  scopeAuth: {
    // Resolved once per request from the tenant/member context. A null member fails every scope closed.
    authScopes: (context) => ({
      member: context.member !== null,
      minRole: (minimum: OrgRole) =>
        context.member !== null && readRankMeets(context.member.role, minimum),
    }),
  },
});

// Passthrough JSON scalar for the frozen config_snapshot blob (§8.13). Output-only for the read layer:
// the dashboard renders the threshold config as-is, and preserving the object shape (rather than a
// stringified blob) keeps the GraphQL node shape aligned with the RSC Prisma read (Path A parity, D10).
builder.scalarType("JSON", {
  serialize: (value) => value as unknown,
  parseValue: (value) => value as unknown,
});
