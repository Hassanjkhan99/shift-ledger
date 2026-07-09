"use server";
// Task-template Server Actions (#135). Zod-validated, session-authenticated, D7-gated (Owner/OrgAdmin/
// PropertyManager/KitchenManager) writes over templates.ts. The temperature threshold (minC/maxC) is
// folded into targetConfig only for temperature check types.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { resolveMemberForOrg, type MemberContext } from "@/lib/http-auth";
import { canManageTemplates } from "@/lib/permissions";
import { createTemplate, updateTemplate, setTemplateActive } from "@/lib/templates";
import {
  createTemplateInput,
  updateTemplateInput,
  setTemplateActiveInput,
} from "@/lib/template-input";

export type TemplateActionResult =
  | { status: "ok"; id?: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "validation"; issues: unknown[] };

async function ctxFor(organizationId: string): Promise<MemberContext | null> {
  return resolveMemberForOrg((await headers()) as unknown as Headers, organizationId);
}

function revalidateTemplates(org: string, id?: string): void {
  revalidatePath(`/${org}/settings/templates`);
  if (id) revalidatePath(`/${org}/settings/templates/${id}`);
}

function targetConfigFrom(input: {
  checkType: string;
  minC?: number;
  maxC?: number;
}): { minC: number; maxC: number } | null {
  if (input.checkType === "temperature" && input.minC !== undefined && input.maxC !== undefined) {
    return { minC: input.minC, maxC: input.maxC };
  }
  return null;
}

export async function createTemplateAction(raw: unknown): Promise<TemplateActionResult> {
  const parsed = createTemplateInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageTemplates(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    createTemplate(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      title: input.title,
      checkType: input.checkType,
      requiredEvidence: input.requiredEvidence,
      instructions: input.instructions,
      targetConfig: targetConfigFrom(input),
    }),
  );
  revalidateTemplates(ctx.organizationId, result.templateId);
  return { status: "ok", id: result.templateId };
}

export async function updateTemplateAction(raw: unknown): Promise<TemplateActionResult> {
  const parsed = updateTemplateInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageTemplates(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    updateTemplate(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      templateId: input.templateId,
      title: input.title,
      checkType: input.checkType,
      requiredEvidence: input.requiredEvidence,
      instructions: input.instructions,
      targetConfig: targetConfigFrom(input),
    }),
  );
  if (result.status === "not-found") return { status: "not-found" };
  revalidateTemplates(ctx.organizationId, input.templateId);
  return { status: "ok", id: input.templateId };
}

export async function setTemplateActiveAction(raw: unknown): Promise<TemplateActionResult> {
  const parsed = setTemplateActiveInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageTemplates(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    setTemplateActive(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      templateId: input.templateId,
      active: input.active,
    }),
  );
  if (result.status === "not-found") return { status: "not-found" };
  revalidateTemplates(ctx.organizationId, input.templateId);
  return { status: "ok" };
}
