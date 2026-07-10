// App entry (#132). Replaces the Create-Next-App template with an authed router:
//   - no session               -> /sign-in?returnTo=…
//   - explicit non-root returnTo -> honor it (post-auth deep-link)
//   - authed, no membership     -> /onboarding (create org / accept invite)
//   - authed, exactly one org   -> /{org}/today
//   - authed, multiple orgs     -> org picker
// The decision itself is pure (decideEntry, lib/app-entry) so the redirect matrix is unit-tested; this
// RSC only wires the session + membership reads to redirect()/render.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { signInUrl } from "@/lib/auth-gate";
import { decideEntry } from "@/lib/app-entry";
import { listMemberOrganizations, resolveUserIdByEmail } from "@/lib/member-orgs";
import { OrgPicker } from "./OrgPicker";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const session = await getAuth().api.getSession({
    headers: (await headers()) as unknown as Headers,
  });
  const email = session?.user?.email ?? null;

  // Resolve the caller's org list only when authenticated (and only when we still need routing — an
  // explicit returnTo short-circuits before this, but decideEntry needs the list for the 0/1/N split).
  let orgs: Awaited<ReturnType<typeof listMemberOrganizations>> = [];
  if (email) {
    const userId = await resolveUserIdByEmail(email);
    orgs = userId ? await listMemberOrganizations(userId) : [];
  }

  const decision = decideEntry({ hasSession: Boolean(email), returnTo, orgs });
  switch (decision.kind) {
    case "sign-in":
      return redirect(signInUrl(decision.returnTo));
    case "redirect":
      return redirect(decision.path);
    case "onboarding":
      return redirect("/onboarding");
    case "picker":
      return <OrgPicker orgs={decision.orgs} />;
  }
}
