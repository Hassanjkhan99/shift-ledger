// App-entry decision for the root `/` route (#132). Pure logic, split from the page so the redirect
// matrix (0 / 1 / N orgs, returnTo, no session) is unit-testable without next/navigation (whose
// redirect() throws a control-flow signal).
//
// Precedence, fail-closed:
//   - no session                    -> sign-in (carry a sanitized returnTo)
//   - explicit non-root returnTo     -> honor it (the destination layout re-checks membership, D6)
//   - authed, 0 active memberships   -> onboarding (create org / accept invite — separate issues)
//   - authed, exactly 1 org          -> that org's Today
//   - authed, multiple orgs          -> org picker
import { sanitizeReturnTo } from "./auth-gate";
import type { MemberOrg } from "./member-orgs";

export type EntryDecision =
  | { kind: "sign-in"; returnTo: string }
  | { kind: "redirect"; path: string }
  | { kind: "onboarding" }
  | { kind: "picker"; orgs: MemberOrg[] };

export function decideEntry(input: {
  hasSession: boolean;
  returnTo: string | null | undefined;
  orgs: MemberOrg[];
}): EntryDecision {
  const returnTo = sanitizeReturnTo(input.returnTo);
  if (!input.hasSession) return { kind: "sign-in", returnTo };
  // A non-root returnTo means the user was headed somewhere specific before authenticating; honor it
  // over the default landing. "/" is the "no specific destination" sentinel, so fall through to routing.
  if (returnTo !== "/") return { kind: "redirect", path: returnTo };
  if (input.orgs.length === 0) return { kind: "onboarding" };
  if (input.orgs.length === 1) return { kind: "redirect", path: `/${input.orgs[0].id}/today` };
  return { kind: "picker", orgs: input.orgs };
}
