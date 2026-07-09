// New-property screen (#133). Owner/OrgAdmin only (canManageProperties); everyone else is a 404.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { canManageProperties } from "@/lib/permissions";
import { PropertyForm } from "../PropertyForm";

export default async function NewPropertyPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !canManageProperties(ctx.role)) notFound();

  return (
    <div className="mx-auto w-full max-w-md">
      <Link
        href={`/${org}/settings/properties`}
        className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Properties
      </Link>
      <h1 className="mb-4 mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New property
      </h1>
      <PropertyForm org={org} mode="create" />
    </div>
  );
}
