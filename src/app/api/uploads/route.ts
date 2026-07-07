// POST /api/uploads (#105) — thin REST presign of a direct-to-R2 PUT (§11.9).
//
// The only client -> HTTP path for evidence (spine item 7): client asks for a presigned PUT, uploads
// bytes straight to R2, then attaches the returned attachmentId to a completion (#17). Auth is resolved
// through the fail-closed http-auth seam; validation is Zod (422); the object store + context resolver
// are injected so the handler is testable without live R2 or a session backend.
import { withTenant } from "../../../lib/db";
import { logger } from "../../../lib/logger";
import { getObjectStore, type ObjectStore } from "../../../lib/storage";
import { resolveMemberContext, type MemberContext } from "../../../lib/http-auth";
import { createUpload, presignUploadSchema } from "../../../lib/uploads";

export interface UploadDeps {
  resolveContext: (req: Request) => Promise<MemberContext | null>;
  store: ObjectStore;
}

/** Testable core of the route. `deps` is injected so tests can supply an in-memory store + stub auth. */
export async function handlePresignUpload(req: Request, deps: UploadDeps): Promise<Response> {
  const ctx = await deps.resolveContext(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = presignUploadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_upload", issues: parsed.error.issues }, { status: 422 });
  }

  const result = await withTenant(ctx.organizationId, (tx) =>
    createUpload(deps.store, tx, {
      organizationId: ctx.organizationId,
      uploadedBy: ctx.userId,
      input: parsed.data,
    }),
  );

  // Log metadata only — NEVER the signed URL (a response-only secret), a filename, or object bytes.
  logger.info(
    {
      attachmentId: result.attachmentId,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
    },
    "presigned upload issued",
  );
  return Response.json(result, { status: 201 });
}

export function POST(req: Request): Promise<Response> {
  return handlePresignUpload(req, {
    resolveContext: resolveMemberContext,
    store: getObjectStore(),
  });
}
