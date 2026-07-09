// Auth gate for protected `(app)/[org]` routes (#131). Pure decision logic, split from the layout so it
// is unit-testable without next/navigation (whose redirect()/notFound() throw control-flow signals).
//
// Three outcomes, fail-closed:
//   - no session            -> redirect to /sign-in?returnTo=<path> (visitor must authenticate)
//   - session, no membership -> notFound() (authenticated, but not a member of THIS org; a redirect to
//                               sign-in would loop them straight back here after re-auth)
//   - session + membership   -> allow, carrying the resolved MemberContext into the RSC tree
import type { MemberContext } from "./http-auth";

export type AuthGate =
  | { kind: "allow"; ctx: MemberContext }
  | { kind: "sign-in"; returnTo: string }
  | { kind: "not-found" };

export function decideAuthGate(input: {
  hasSession: boolean;
  ctx: MemberContext | null;
  pathname: string;
}): AuthGate {
  if (input.ctx) return { kind: "allow", ctx: input.ctx };
  if (!input.hasSession) return { kind: "sign-in", returnTo: sanitizeReturnTo(input.pathname) };
  return { kind: "not-found" };
}

/**
 * Constrain a `returnTo` to a same-origin, absolute path so it cannot be turned into an open redirect
 * (e.g. `//evil.com` or `https://evil.com`). Anything that is not a single-slash-prefixed local path
 * collapses to "/". Applied both when BUILDING the sign-in URL (here) and when CONSUMING returnTo after
 * login (the sign-in page), so a hand-crafted `?returnTo=` query can never bounce a user off-site.
 */
export function sanitizeReturnTo(returnTo: string | null | undefined): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
  return returnTo;
}

/** Build the sign-in URL for a gated `returnTo` path (sanitized + encoded). */
export function signInUrl(returnTo: string): string {
  return `/sign-in?returnTo=${encodeURIComponent(sanitizeReturnTo(returnTo))}`;
}
