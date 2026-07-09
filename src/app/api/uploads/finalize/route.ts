// POST /api/uploads/finalize (#106) — validate + checksum + sanitize an uploaded object, flip it to
// 'uploaded'. Thin wrapper over finalizeAttachment(): auth seam -> Zod -> finalize, failing CLOSED
// (any finalize problem is a 422, leaving the attachment unusable). Deps injected for testability.
import { z } from "zod";
import { withTenant } from "../../../../lib/db";
import { logger } from "../../../../lib/logger";
import { getObjectStore, type ObjectStore } from "../../../../lib/storage";
import { resolveMemberContext, type MemberContext } from "../../../../lib/http-auth";
import { finalizeAttachment } from "../../../../lib/finalize";
import { canWriteEvidence } from "../../../../lib/permissions";

const finalizeSchema = z.object({ attachmentId: z.string().uuid() });

export interface FinalizeDeps {
  resolveContext: (req: Request) => Promise<MemberContext | null>;
  store: ObjectStore;
}

export async function handleFinalize(req: Request, deps: FinalizeDeps): Promise<Response> {
  const ctx = await deps.resolveContext(req);
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canWriteEvidence(ctx.role)) return Response.json({ error: "forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_finalize", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  try {
    const result = await withTenant(ctx.organizationId, (tx) =>
      finalizeAttachment(deps.store, tx, {
        organizationId: ctx.organizationId,
        attachmentId: parsed.data.attachmentId,
      }),
    );
    // checksum/size are non-secret integrity metadata (safe to log, unlike a signed URL).
    logger.info(
      {
        attachmentId: result.attachmentId,
        byteSize: result.byteSize,
        checksumSha256: result.checksumSha256,
        alreadyFinalized: result.alreadyFinalized,
      },
      "attachment finalized",
    );
    return Response.json(
      {
        attachmentId: result.attachmentId,
        status: result.status,
        byteSize: result.byteSize,
        checksumSha256: result.checksumSha256,
        capturedAt: result.capturedAt,
      },
      { status: 200 },
    );
  } catch (err) {
    // Fail closed: missing object / MIME mismatch / not-found all leave the row pending & unusable.
    logger.warn(
      { attachmentId: parsed.data.attachmentId, err: (err as Error).message },
      "finalize failed",
    );
    return Response.json({ error: "finalize_failed" }, { status: 422 });
  }
}

export function POST(req: Request): Promise<Response> {
  return handleFinalize(req, { resolveContext: resolveMemberContext, store: getObjectStore() });
}
