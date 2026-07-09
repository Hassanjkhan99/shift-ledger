// GraphQL request context (#15) — resolved once per request and shared by every resolver + DataLoader.
//
// It carries two things and nothing more:
//  - `member`: the authenticated tenant/authorization context ({ organizationId, userId, role, ... }) or
//    null. Resolved through the SAME fail-closed Better Auth seam the thin REST surface uses
//    (resolveMemberContext), so GraphQL gets no bypass of authentication.
//  - `run`: the D6 tenant-scoped transaction runner (withTenant by default). EVERY resolver and loader
//    issues its DB work through `run(member.organizationId, tx => …)`, so Postgres RLS sees
//    app.current_org_id and default-denies anything outside the caller's org. Nothing in the GraphQL
//    layer touches the raw prisma client directly.
//
// Both dependencies are injectable so tests can drive the schema with a stub member and a query-counting
// runner (the F1 N+1 gate) without standing up HTTP or a session backend.
import { withTenant, type TenantClient } from "../db";
import { resolveMemberContext, type MemberContext } from "../http-auth";

/** The D6 tenant-scoped transaction runner signature (withTenant). */
export type TenantRunner = <T>(
  organizationId: string,
  fn: (tx: TenantClient) => Promise<T>,
) => Promise<T>;

export interface GraphQLContext {
  member: MemberContext | null;
  run: TenantRunner;
}

export interface ContextDeps {
  /** Override the member/tenant resolver (default: the Better Auth-backed resolveMemberContext). */
  resolveContext?: (req: Request) => Promise<MemberContext | null>;
  /** Override the tenant-scoped transaction runner (default: withTenant). */
  run?: TenantRunner;
}

/** Build the per-request GraphQL context from the incoming Request. */
export async function buildContext(req: Request, deps: ContextDeps = {}): Promise<GraphQLContext> {
  const resolve = deps.resolveContext ?? resolveMemberContext;
  const member = await resolve(req);
  return { member, run: deps.run ?? withTenant };
}
