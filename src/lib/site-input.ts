// Input schemas for the org-onboarding + sites Server Actions (#133). Kept in a plain module (not the
// "use server" action files, which may only export async functions) so the validation contract — IANA
// time-zone rejection, slug shape, name/country bounds — is unit-testable without a Next request context.
import { z } from "zod";
import { IANAZone } from "luxon";

export const orgIdField = z.string().uuid();
export const propertyIdField = z.string().uuid();
export const outletIdField = z.string().uuid();
export const siteNameField = z.string().trim().min(1).max(120);

/** A valid IANA zone (luxon). The property/org time zone drives occurrence wall-clock (§9). */
export const timezoneField = z
  .string()
  .refine((tz) => IANAZone.isValidZone(tz), "Not a valid IANA time zone.");

export const countryCodeField = z
  .string()
  .trim()
  .length(2)
  .regex(/^[A-Za-z]{2}$/, "Use a 2-letter country code.");

export const addressField = z.string().trim().max(500).optional();

/** URL-safe slug: lowercase alphanumeric words joined by single hyphens. */
export const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens.");

export const createOrgInput = z.object({
  name: siteNameField,
  slug: slugField,
  defaultTimezone: timezoneField,
  defaultLocale: z.string().trim().toLowerCase().min(2).max(10),
});

export const createPropertyInput = z.object({
  organizationId: orgIdField,
  name: siteNameField,
  timezone: timezoneField,
  countryCode: countryCodeField,
  address: addressField,
});

export const updatePropertyInput = z.object({
  organizationId: orgIdField,
  propertyId: propertyIdField,
  name: siteNameField,
  timezone: timezoneField,
  countryCode: countryCodeField,
  address: addressField,
});

export const archivePropertyInput = z.object({
  organizationId: orgIdField,
  propertyId: propertyIdField,
});

export const createOutletInput = z.object({
  organizationId: orgIdField,
  propertyId: propertyIdField,
  name: siteNameField,
});

export const updateOutletInput = z.object({
  organizationId: orgIdField,
  outletId: outletIdField,
  name: siteNameField,
});

export const archiveOutletInput = z.object({
  organizationId: orgIdField,
  outletId: outletIdField,
});
