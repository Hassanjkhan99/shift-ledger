// Sites domain (#133) — Property (physical site) and Outlet (kitchen) CRUD. Each function runs inside a
// caller-provided tenant transaction (withTenant, D6) and pairs its write with a logActivity() audit row
// in the SAME transaction (F4/F6), so the mutation and its audit entry commit or roll back together.
//
// Names are unique per parent at the DB level (@@unique([organizationId, name]) for properties,
// @@unique([propertyId, name]) for outlets). We rely on those constraints and translate P2002 into a
// typed `conflict` rather than pre-checking (a read cannot see a soft-deleted clashing row anyway).
//
// Archiving is soft-delete (deleted_at, F3 server-authoritative). The occurrence generator (#8) already
// skips archived sites, so archiving is the supported "remove" — rows are never hard-deleted (retention).
import type { TenantClient } from "./db";
import { logActivity } from "./transition";
import { Prisma } from "../generated/prisma/client";

/** Optional freeform postal address, stored in properties.address_json as { text }. */
function toAddressJson(address: string | undefined): Prisma.InputJsonValue | undefined {
  const trimmed = address?.trim();
  return trimmed ? { text: trimmed } : undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

// ---- Property -------------------------------------------------------------------

export interface CreatePropertyInput {
  organizationId: string;
  actorUserId: string;
  name: string;
  timezone: string; // IANA — validated at the action layer (luxon) before it reaches here
  countryCode: string; // ISO 3166-1 alpha-2
  address?: string;
}

export type CreatePropertyResult =
  { status: "ok"; propertyId: string } | { status: "conflict"; field: "name" };

export async function createProperty(
  tx: TenantClient,
  input: CreatePropertyInput,
): Promise<CreatePropertyResult> {
  try {
    const property = await tx.property.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        timezone: input.timezone,
        countryCode: input.countryCode.toUpperCase(),
        addressJson: toAddressJson(input.address),
      },
      select: { id: true, name: true, timezone: true, countryCode: true },
    });
    await logActivity(tx, {
      organizationId: input.organizationId,
      subjectType: "property",
      subjectId: property.id,
      action: "property.created",
      actorUserId: input.actorUserId,
      afterJson: {
        name: property.name,
        timezone: property.timezone,
        countryCode: property.countryCode,
      },
    });
    return { status: "ok", propertyId: property.id };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "conflict", field: "name" };
    throw err;
  }
}

export interface UpdatePropertyInput {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  name: string;
  timezone: string;
  countryCode: string;
  address?: string;
}

export type UpdatePropertyResult =
  { status: "ok" } | { status: "not-found" } | { status: "conflict"; field: "name" };

export async function updateProperty(
  tx: TenantClient,
  input: UpdatePropertyInput,
): Promise<UpdatePropertyResult> {
  const before = await tx.property.findFirst({
    where: { id: input.propertyId, deletedAt: null },
    select: { id: true, name: true, timezone: true, countryCode: true },
  });
  if (!before) return { status: "not-found" };

  try {
    const after = await tx.property.update({
      where: { id: input.propertyId },
      data: {
        name: input.name,
        timezone: input.timezone,
        countryCode: input.countryCode.toUpperCase(),
        addressJson: toAddressJson(input.address) ?? Prisma.DbNull,
      },
      select: { name: true, timezone: true, countryCode: true },
    });
    await logActivity(tx, {
      organizationId: input.organizationId,
      subjectType: "property",
      subjectId: input.propertyId,
      action: "property.updated",
      actorUserId: input.actorUserId,
      beforeJson: { name: before.name, timezone: before.timezone, countryCode: before.countryCode },
      afterJson: after,
    });
    return { status: "ok" };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "conflict", field: "name" };
    throw err;
  }
}

export interface ArchiveInput {
  organizationId: string;
  actorUserId: string;
}

export type ArchiveResult = { status: "ok" } | { status: "not-found" };

export async function archiveProperty(
  tx: TenantClient,
  input: ArchiveInput & { propertyId: string },
): Promise<ArchiveResult> {
  const before = await tx.property.findFirst({
    where: { id: input.propertyId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!before) return { status: "not-found" };

  await tx.property.update({
    where: { id: input.propertyId },
    data: { deletedAt: new Date() },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "property",
    subjectId: input.propertyId,
    action: "property.archived",
    actorUserId: input.actorUserId,
    beforeJson: { name: before.name },
  });
  return { status: "ok" };
}

// ---- Outlet ---------------------------------------------------------------------

export interface CreateOutletInput {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  name: string;
}

export type CreateOutletResult =
  | { status: "ok"; outletId: string }
  | { status: "not-found" } // parent property missing or archived
  | { status: "conflict"; field: "name" };

export async function createOutlet(
  tx: TenantClient,
  input: CreateOutletInput,
): Promise<CreateOutletResult> {
  // The parent property must exist and be active — an outlet cannot hang off an archived/absent site.
  const property = await tx.property.findFirst({
    where: { id: input.propertyId, deletedAt: null },
    select: { id: true },
  });
  if (!property) return { status: "not-found" };

  try {
    const outlet = await tx.outlet.create({
      data: {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        name: input.name,
      },
      select: { id: true, name: true, propertyId: true },
    });
    await logActivity(tx, {
      organizationId: input.organizationId,
      subjectType: "outlet",
      subjectId: outlet.id,
      action: "outlet.created",
      actorUserId: input.actorUserId,
      afterJson: { name: outlet.name, propertyId: outlet.propertyId },
    });
    return { status: "ok", outletId: outlet.id };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "conflict", field: "name" };
    throw err;
  }
}

export interface UpdateOutletInput {
  organizationId: string;
  actorUserId: string;
  outletId: string;
  name: string;
}

export type UpdateOutletResult =
  { status: "ok" } | { status: "not-found" } | { status: "conflict"; field: "name" };

export async function updateOutlet(
  tx: TenantClient,
  input: UpdateOutletInput,
): Promise<UpdateOutletResult> {
  const before = await tx.outlet.findFirst({
    where: { id: input.outletId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!before) return { status: "not-found" };

  try {
    const after = await tx.outlet.update({
      where: { id: input.outletId },
      data: { name: input.name },
      select: { name: true },
    });
    await logActivity(tx, {
      organizationId: input.organizationId,
      subjectType: "outlet",
      subjectId: input.outletId,
      action: "outlet.updated",
      actorUserId: input.actorUserId,
      beforeJson: { name: before.name },
      afterJson: after,
    });
    return { status: "ok" };
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "conflict", field: "name" };
    throw err;
  }
}

export async function archiveOutlet(
  tx: TenantClient,
  input: ArchiveInput & { outletId: string },
): Promise<ArchiveResult> {
  const before = await tx.outlet.findFirst({
    where: { id: input.outletId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!before) return { status: "not-found" };

  await tx.outlet.update({
    where: { id: input.outletId },
    data: { deletedAt: new Date() },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "outlet",
    subjectId: input.outletId,
    action: "outlet.archived",
    actorUserId: input.actorUserId,
    beforeJson: { name: before.name },
  });
  return { status: "ok" };
}
