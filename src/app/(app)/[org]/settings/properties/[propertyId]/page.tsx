// Property detail (#133). Edit the property (Owner/OrgAdmin) and manage its outlets (Owner/OrgAdmin, or a
// PropertyManager in scope). A PropertyManager outside this property's scope — or a request for a missing
// / archived property — is a 404. Read-only viewers see the details without controls.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { canManageProperties, canManageOutlets } from "@/lib/permissions";
import { OrgRole } from "@/generated/prisma/enums";
import { PropertyForm } from "../PropertyForm";
import { OutletManager } from "../OutletManager";
import { ArchivePropertyButton } from "../ArchivePropertyButton";

const SETTINGS_ROLES: ReadonlySet<OrgRole> = new Set([
  OrgRole.Owner,
  OrgRole.OrgAdmin,
  OrgRole.PropertyManager,
]);

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ org: string; propertyId: string }>;
}) {
  const { org, propertyId } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !SETTINGS_ROLES.has(ctx.role)) notFound();

  // A scoped PropertyManager may only reach properties in their scope.
  const scoped = ctx.propertyScope.length > 0;
  if (scoped && !ctx.propertyScope.includes(propertyId)) notFound();

  const data = await withTenant(ctx.organizationId, async (tx) => {
    const property = await tx.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { id: true, name: true, timezone: true, countryCode: true, addressJson: true },
    });
    if (!property) return null;
    const outlets = await tx.outlet.findMany({
      where: { propertyId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return { property, outlets };
  });
  if (!data) notFound();

  const { property, outlets } = data;
  const addressText =
    property.addressJson && typeof property.addressJson === "object"
      ? ((property.addressJson as { text?: string }).text ?? "")
      : "";
  const mayManageProperty = canManageProperties(ctx.role);
  const mayManageOutlets = canManageOutlets(ctx.role, ctx.propertyScope, propertyId);

  return (
    <div className="mx-auto w-full max-w-md space-y-8">
      <div>
        <Link
          href={`/${org}/settings/properties`}
          className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Properties
        </Link>
        <h1 className="mb-4 mt-2 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {property.name}
        </h1>
        {mayManageProperty ? (
          <PropertyForm
            org={org}
            mode="edit"
            initial={{
              id: property.id,
              name: property.name,
              timezone: property.timezone,
              countryCode: property.countryCode,
              address: addressText,
            }}
          />
        ) : (
          <dl className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <div className="flex justify-between py-1">
              <dt className="text-zinc-500 dark:text-zinc-400">Time zone</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{property.timezone}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-zinc-500 dark:text-zinc-400">Country</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{property.countryCode}</dd>
            </div>
          </dl>
        )}
      </div>

      <OutletManager
        org={org}
        propertyId={property.id}
        outlets={outlets}
        canManage={mayManageOutlets}
      />

      {mayManageProperty && <ArchivePropertyButton org={org} propertyId={property.id} />}
    </div>
  );
}
