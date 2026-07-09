// (app)/[org] layout (M4 #16, §12.1/§12.2) — resolves the member's tenant scope for every nested RSC
// read and frames the screen with the responsive nav (mobile bottom-bar + desktop sidebar, §12.7). It is
// the route-protection gate (#131): an unauthenticated visitor is redirected to /sign-in?returnTo=<path>
// (returning here after login); an authenticated user who is not a member of THIS org is a 404
// (fail-closed, no loop). Client islands render under <Providers> (the TanStack Query client, D10).
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { getAuth } from "@/lib/auth";
import { resolveMemberForEmail } from "@/lib/http-auth";
import { decideAuthGate, signInUrl } from "@/lib/auth-gate";
import { listMemberOrganizations } from "@/lib/member-orgs";
import { Providers } from "@/app/providers";
import { OrgNav } from "./OrgNav";

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const h = (await headers()) as unknown as Headers;

  // One session lookup, then the membership check — split so we can tell "no session" (redirect) from
  // "session but not a member" (404). x-pathname is stamped by middleware.ts for the returnTo.
  const session = await getAuth().api.getSession({ headers: h });
  const email = session?.user?.email ?? null;
  const ctx = email ? await resolveMemberForEmail(email, org) : null;
  const gate = decideAuthGate({
    hasSession: Boolean(email),
    ctx,
    pathname: h.get("x-pathname") ?? `/${org}`,
  });
  if (gate.kind === "sign-in") redirect(signInUrl(gate.returnTo));
  if (gate.kind === "not-found") notFound();

  // The member's org list powers the shell's active-org label + switcher (#132). Keyed on the caller's
  // own users.id (gate.ctx.userId), so it only ever lists orgs this user actively belongs to.
  const orgs = await listMemberOrganizations(gate.ctx.userId);

  return (
    <Providers>
      <div className="flex min-h-full flex-col md:flex-row">
        <OrgNav org={org} role={gate.ctx.role} orgs={orgs} />
        <main className="flex-1 px-4 pb-24 pt-4 md:pb-8 md:pl-64">{children}</main>
      </div>
    </Providers>
  );
}
