// Properties list (#133, settings). Owner/OrgAdmin see and manage every property; a PropertyManager
// sees only the properties in their scope (to manage their outlets). Everyone else is a 404 (the [org]
// layout already proved membership; this adds the role gate). Active (non-archived) sites only.
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveMemberForOrg } from "@/lib/http-auth";
import { withTenant } from "@/lib/db";
import { canManageProperties } from "@/lib/permissions";
import { OrgRole } from "@/generated/prisma/enums";

const SETTINGS_ROLES: ReadonlySet<OrgRole> = new Set([
  OrgRole.Owner,
  OrgRole.OrgAdmin,
  OrgRole.PropertyManager,
]);

export default async function PropertiesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await resolveMemberForOrg((await headers()) as unknown as Headers, org);
  if (!ctx || !SETTINGS_ROLES.has(ctx.role)) notFound();

  // Only PropertyManagers are limited to their scope; Owner/OrgAdmin manage every site even if their
  // membership happens to carry a non-empty propertyScope (#161).
  const scoped = !canManageProperties(ctx.role) && ctx.propertyScope.length > 0;
  const properties = await withTenant(ctx.organizationId, (tx) =>
    tx.property.findMany({
      where: { deletedAt: null, ...(scoped ? { id: { in: ctx.propertyScope } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true, timezone: true, countryCode: true },
    }),
  );

  const mayCreate = canManageProperties(ctx.role);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Properties
        </h1>
        {mayCreate && (
          <Link
            href={`/${org}/settings/properties/new`}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            New property
          </Link>
        )}
      </div>

      {properties.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No properties yet.{mayCreate ? " Create one to start scheduling tasks." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {properties.map((p) => (
            <li key={p.id}>
              <Link
                href={`/${org}/settings/properties/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {p.name}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {p.timezone} · {p.countryCode}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
