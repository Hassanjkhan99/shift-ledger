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

// The auth pages themselves — never a valid post-login destination (would re-show the form or loop).
const AUTH_PATHS = ["/sign-in", "/sign-up"];

/**
 * Constrain a `returnTo` to a same-origin, absolute path so it cannot be turned into an open redirect,
 * then collapse anything unsafe to "/". Rejects (#153):
 *   - non-strings / empty / not single-slash-prefixed absolute paths;
 *   - protocol-relative `//evil.com` AND backslash variants `/\evil.com`, `/\/evil.com` — browsers
 *     normalize `\` to `/`, so these bounce off-site; we reject ANY backslash;
 *   - the auth pages themselves (`/sign-in`, `/sign-up` and their sub/query paths) — self-redirect loop.
 * Next's App Router can supply `string[]` for a repeated `?returnTo=` key, so we also accept an array and
 * take its first element. Applied both when BUILDING the sign-in URL and when CONSUMING returnTo after
 * login, so a hand-crafted query can never bounce a user off-site or back to the form.
 */
export function sanitizeReturnTo(returnTo: string | string[] | null | undefined): string {
  const value = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  if (!value || typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  const path = value.split(/[?#]/)[0];
  if (AUTH_PATHS.includes(path)) return "/";
  return value;
}

/** Build the sign-in URL for a gated `returnTo` path (sanitized + encoded). */
export function signInUrl(returnTo: string): string {
  return `/sign-in?returnTo=${encodeURIComponent(sanitizeReturnTo(returnTo))}`;
}
