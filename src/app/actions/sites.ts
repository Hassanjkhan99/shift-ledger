"use server";
// Sites Server Actions (#133) — Property + Outlet CRUD for the org settings screens. Each action:
//   1. Zod-validates its input (invalid -> { status: "validation" }); IANA tz via luxon.
//   2. Resolves the authenticated member context for the named org (fail-closed -> "unauthorized").
//   3. Enforces D7: Owner/OrgAdmin manage properties; PropertyManager manages outlets within scope.
//   4. Runs the domain write inside withTenant() (RLS, D6), which pairs it with an activity_log entry.
//   5. Revalidates the affected settings RSC paths.
//
// The write semantics (unique-name conflicts, soft-delete, audit) live in the tested domain lib
// (src/lib/sites.ts); this file is the thin Zod + auth + cache glue Next requires of a Server Action.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { resolveMemberForOrg, type MemberContext } from "@/lib/http-auth";
import { canManageProperties, canManageOutlets } from "@/lib/permissions";
import {
  createProperty,
  updateProperty,
  archiveProperty,
  createOutlet,
  updateOutlet,
  archiveOutlet,
} from "@/lib/sites";
import {
  createPropertyInput,
  updatePropertyInput,
  archivePropertyInput,
  createOutletInput,
  updateOutletInput,
  archiveOutletInput,
} from "@/lib/site-input";

export type SiteActionResult =
  | { status: "ok"; id?: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "validation"; issues: unknown[] }
  | { status: "conflict"; field: string };

async function ctxFor(organizationId: string): Promise<MemberContext | null> {
  return resolveMemberForOrg((await headers()) as unknown as Headers, organizationId);
}

function revalidateProperties(organizationId: string, propId?: string): void {
  revalidatePath(`/${organizationId}/settings/properties`);
  if (propId) revalidatePath(`/${organizationId}/settings/properties/${propId}`);
}

// ---- Property actions -----------------------------------------------------------

export async function createPropertyAction(raw: unknown): Promise<SiteActionResult> {
  const parsed = createPropertyInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageProperties(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    createProperty(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      name: input.name,
      timezone: input.timezone,
      countryCode: input.countryCode,
      address: input.address,
    }),
  );
  if (result.status === "conflict") return { status: "conflict", field: result.field };
  revalidateProperties(ctx.organizationId, result.propertyId);
  return { status: "ok", id: result.propertyId };
}

export async function updatePropertyAction(raw: unknown): Promise<SiteActionResult> {
  const parsed = updatePropertyInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageProperties(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    updateProperty(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      propertyId: input.propertyId,
      name: input.name,
      timezone: input.timezone,
      countryCode: input.countryCode,
      address: input.address,
    }),
  );
  if (result.status === "conflict") return { status: "conflict", field: result.field };
  if (result.status === "not-found") return { status: "not-found" };
  revalidateProperties(ctx.organizationId, input.propertyId);
  return { status: "ok" };
}

export async function archivePropertyAction(raw: unknown): Promise<SiteActionResult> {
  const parsed = archivePropertyInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageProperties(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    archiveProperty(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      propertyId: input.propertyId,
    }),
  );
  if (result.status === "not-found") return { status: "not-found" };
  revalidateProperties(ctx.organizationId, input.propertyId);
  return { status: "ok" };
}

// ---- Outlet actions -------------------------------------------------------------

export async function createOutletAction(raw: unknown): Promise<SiteActionResult> {
  const parsed = createOutletInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  // Scope-check against the target property (the outlet's parent). RLS + the domain fn also verify the
  // property exists and is active for this tenant.
  if (!canManageOutlets(ctx.role, ctx.propertyScope, input.propertyId)) {
    return { status: "forbidden" };
  }

  const result = await withTenant(ctx.organizationId, (tx) =>
    createOutlet(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      propertyId: input.propertyId,
      name: input.name,
    }),
  );
  if (result.status === "conflict") return { status: "conflict", field: result.field };
  if (result.status === "not-found") return { status: "not-found" };
  revalidateProperties(ctx.organizationId, input.propertyId);
  return { status: "ok", id: result.outletId };
}

export async function updateOutletAction(raw: unknown): Promise<SiteActionResult> {
  const parsed = updateOutletInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };

  try {
    const result = await withTenant(ctx.organizationId, async (tx) => {
      // Resolve the outlet's TRUE parent property from the DB before the scope check — never trust a
      // client-supplied propertyId, and never let a PropertyManager edit an out-of-scope outlet.
      const outlet = await tx.outlet.findFirst({
        where: { id: input.outletId, deletedAt: null },
        select: { propertyId: true },
      });
      if (!outlet) return { status: "not-found" as const };
      if (!canManageOutlets(ctx.role, ctx.propertyScope, outlet.propertyId)) {
        throw new ForbiddenError();
      }
      const r = await updateOutlet(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        outletId: input.outletId,
        name: input.name,
      });
      return { ...r, propertyId: outlet.propertyId };
    });

    if (result.status === "not-found") return { status: "not-found" };
    if (result.status === "conflict") return { status: "conflict", field: result.field };
    revalidateProperties(ctx.organizationId, result.propertyId);
    return { status: "ok" };
  } catch (err) {
    if (err instanceof ForbiddenError) return { status: "forbidden" };
    throw err;
  }
}

export async function archiveOutletAction(raw: unknown): Promise<SiteActionResult> {
  const parsed = archiveOutletInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };

  try {
    const result = await withTenant(ctx.organizationId, async (tx) => {
      const outlet = await tx.outlet.findFirst({
        where: { id: input.outletId, deletedAt: null },
        select: { propertyId: true },
      });
      if (!outlet) return { status: "not-found" as const };
      if (!canManageOutlets(ctx.role, ctx.propertyScope, outlet.propertyId)) {
        throw new ForbiddenError();
      }
      const r = await archiveOutlet(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        outletId: input.outletId,
      });
      return { ...r, propertyId: outlet.propertyId };
    });

    if (result.status === "not-found") return { status: "not-found" };
    revalidateProperties(ctx.organizationId, result.propertyId);
    return { status: "ok" };
  } catch (err) {
    if (err instanceof ForbiddenError) return { status: "forbidden" };
    throw err;
  }
}

/** Internal control-flow signal to unwind a tenant transaction when the scope check fails. */
class ForbiddenError extends Error {}
