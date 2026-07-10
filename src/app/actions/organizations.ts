"use server";
// Organization onboarding Server Action (#133). The one write with no incoming tenant context: a
// signed-in user with (typically) no membership creates an org and becomes its Owner. Auth is the
// Better Auth SESSION only — we never accept an email/user id from the client. Tenant + Owner
// membership are established by createOrganizationForUser() (src/lib/organizations.ts), the sanctioned
// no-tenant -> new-tenant bootstrap.
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { createOrganizationForUser } from "@/lib/organizations";
import { createOrgInput } from "@/lib/site-input";

export type CreateOrgActionResult =
  | { status: "ok"; organizationId: string }
  | { status: "unauthorized" }
  | { status: "validation"; issues: unknown[] }
  | { status: "conflict"; field: "slug" };

export async function createOrganizationAction(raw: unknown): Promise<CreateOrgActionResult> {
  const parsed = createOrgInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };

  const session = await getAuth().api.getSession({
    headers: (await headers()) as unknown as Headers,
  });
  const email = session?.user?.email;
  if (!email) return { status: "unauthorized" };

  const result = await createOrganizationForUser({
    email,
    userName: session?.user?.name ?? null,
    name: parsed.data.name,
    slug: parsed.data.slug,
    defaultTimezone: parsed.data.defaultTimezone,
    defaultLocale: parsed.data.defaultLocale,
  });

  if (result.status === "conflict") return { status: "conflict", field: "slug" };
  return { status: "ok", organizationId: result.organizationId };
}
