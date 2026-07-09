// (app)/[org] layout (M4 #16, §12.1/§12.2) — resolves the member's tenant scope for every nested RSC
// read and frames the screen with the responsive nav (mobile bottom-bar + desktop sidebar, §12.7). A
// request with no valid session / membership for [org] is a 404 (fail-closed; the sign-in surface is a
// separate ticket). Client islands render under <Providers> (the TanStack Query client, D10).
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { resolveMemberForOrg } from "@/lib/http-auth";
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
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx) notFound();

  return (
    <Providers>
      <div className="flex min-h-full flex-col md:flex-row">
        <OrgNav org={org} role={ctx.role} />
        <main className="flex-1 px-4 pb-24 pt-4 md:pb-8 md:pl-64">{children}</main>
      </div>
    </Providers>
  );
}
