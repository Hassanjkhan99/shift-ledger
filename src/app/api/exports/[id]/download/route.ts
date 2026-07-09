// GET /api/exports/:id/download (#14, §11.9) - 302 to a short-lived signed GET of a completed export
// job's audit-pack PDF. Analogous to the evidence view (#107): auth seam -> RLS-scoped lookup -> signed
// URL in the Location header (never logged); 404-style non-disclosure for cross-tenant / not-found /
// not-yet-complete jobs.
import { withTenant } from "../../../../../lib/db";
import { logger } from "../../../../../lib/logger";
import { getObjectStore, type ObjectStore } from "../../../../../lib/storage";
import { resolveMemberContext, type MemberContext } from "../../../../../lib/http-auth";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ExportDownloadDeps {
  resolveContext: (req: Request) => Promise<MemberContext | null>;
  store: ObjectStore;
}

export async function handleExportDownload(
  req: Request,
  jobId: string,
  deps: ExportDownloadDeps,
): Promise<Response> {
  const ctx = await deps.resolveContext(req);
  if (!ctx) return new Response(null, { status: 401 });
  if (!UUID_RE.test(jobId)) return new Response(null, { status: 404 });

  const view = await withTenant(ctx.organizationId, async (tx) => {
    // RLS scopes this to the caller's org; a cross-tenant job id simply resolves to null.
    const job = await tx.exportJob.findUnique({
      where: { id: jobId },
      select: { status: true, auditPack: { select: { attachment: { select: { r2Key: true } } } } },
    });
    if (!job || job.status !== "completed" || !job.auditPack?.attachment) return null;
    return deps.store.presignGet(job.auditPack.attachment.r2Key);
  });
  if (!view) return new Response(null, { status: 404 });

  logger.info({ exportJobId: jobId, organizationId: ctx.organizationId }, "export download issued");
  return new Response(null, { status: 302, headers: { Location: view.url } });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return handleExportDownload(req, id, {
    resolveContext: resolveMemberContext,
    store: getObjectStore(),
  });
}
