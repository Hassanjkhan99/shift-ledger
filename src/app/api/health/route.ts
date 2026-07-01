import { NextResponse } from "next/server";

// Liveness probe: confirms the app process is up and serving. Intentionally does no
// DB/tenant work — that's a readiness check, added later if needed. Never cached.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
