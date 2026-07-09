// Better Auth request handler (#114). Mounts all Better Auth endpoints (sign-up/in/out, session, etc.)
// under /api/auth/*. The handler is resolved lazily (getAuth) so importing this route at `next build`
// page-data collection does not require DATABASE_URL.
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "../../../../lib/auth";

export const POST = (req: Request): Promise<Response> => toNextJsHandler(getAuth()).POST(req);
export const GET = (req: Request): Promise<Response> => toNextJsHandler(getAuth()).GET(req);
