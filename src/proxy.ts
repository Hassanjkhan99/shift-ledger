// Pathname stamp (#131). Next App Router RSCs (layouts/pages) cannot read the request pathname, but the
// `(app)/[org]` layout needs it to build an accurate `?returnTo=` when redirecting an unauthenticated
// visitor to sign-in. The proxy (Next 16's rename of middleware) runs with the full URL, so it copies
// pathname+search onto a request header the layout reads via headers(). This does NOT authenticate — the
// layout still runs the fail-closed session/membership gate; the proxy only carries the path.
import { NextResponse, type NextRequest } from "next/server";

export function proxy(req: NextRequest): NextResponse {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Skip static assets and the auth API (no gated route needs a returnTo there).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
