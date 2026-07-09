// Members & invitations screen (#134). Owner/OrgAdmin manage the whole roster; a PropertyManager manages
// within their scope (server-enforced per action). Everyone else is a 404 (the [org] layout already
// proved membership; this adds the role gate). Loads the roster, pending invitations, and the active
// properties (for the scope picker) in one tenant transaction.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { canManageMembers } from "@/lib/permissions";
import { listMembers, listInvitations } from "@/lib/members";
import { MembersManager } from "./MembersManager";

export default async function MembersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !canManageMembers(ctx.role)) notFound();

  const { members, invitations, properties } = await withTenant(ctx.organizationId, async (tx) => {
    const [members, invitations, properties] = await Promise.all([
      listMembers(tx),
      listInvitations(tx),
      tx.property.findMany({
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
    return { members, invitations, properties };
  });

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Members
      </h1>
      <MembersManager
        org={ctx.organizationId}
        actorRole={ctx.role}
        actorScope={ctx.propertyScope}
        currentUserId={ctx.userId}
        members={members}
        invitations={invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          propertyScope: i.propertyScope,
          status: i.status,
          token: i.token,
          expiresAt: i.expiresAt.toISOString(),
        }))}
        properties={properties}
      />
    </div>
  );
}
