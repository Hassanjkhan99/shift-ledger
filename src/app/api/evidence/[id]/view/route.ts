// GET /api/evidence/:id/view (#107) — 302 to a short-lived presigned GET for an uploaded attachment.
//
// Files are never served from this origin (§22): we redirect to a signed R2 URL (<= 5 min) issued only
// after the tenant policy (RLS via withTenant) confirms the caller may see the object. A cross-tenant
// or nonexistent id resolves to null -> 404-style non-disclosure (we never confirm the object exists).
// The signed URL is a response-only secret: it goes in the Location header, never into logs.
import { withTenant } from "../../../../../lib/db";
import { logger } from "../../../../../lib/logger";
import { getObjectStore, type ObjectStore } from "../../../../../lib/storage";
import { resolveMemberContext, type MemberContext } from "../../../../../lib/http-auth";
import { resolveEvidenceViewUrl } from "../../../../../lib/evidence-view";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ViewDeps {
  resolveContext: (req: Request) => Promise<MemberContext | null>;
  store: ObjectStore;
}

export async function handleEvidenceView(
  req: Request,
  id: string,
  deps: ViewDeps,
): Promise<Response> {
  const ctx = await deps.resolveContext(req);
  if (!ctx) return new Response(null, { status: 401 });

  // A malformed id is treated as "not found" (same non-disclosure as a cross-tenant miss).
  if (!UUID_RE.test(id)) return new Response(null, { status: 404 });

  const view = await withTenant(ctx.organizationId, (tx) =>
    resolveEvidenceViewUrl(deps.store, tx, id),
  );
  if (!view) return new Response(null, { status: 404 }); // cross-tenant / not-found / pending / deleted

  // Log the access WITHOUT the signed URL (a response-only secret) or any object content.
  logger.info({ attachmentId: id, organizationId: ctx.organizationId }, "evidence view issued");
  return new Response(null, { status: 302, headers: { Location: view.url } });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return handleEvidenceView(req, id, {
    resolveContext: resolveMemberContext,
    store: getObjectStore(),
  });
}
