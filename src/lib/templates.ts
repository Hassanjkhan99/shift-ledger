// Task templates domain (#135). A template is the reusable definition of a check: its check_type, the
// evidence it requires, and (for temperature) its threshold config. Each function runs inside a
// caller-provided tenant transaction (withTenant, D6) and audits via logActivity (F4/F6).
//
// SHAPE CONTRACT (must not drift from #8/#17): at generation the occurrence's config_snapshot is built as
// { targetConfig: template.targetConfigJson, requiredEvidence: template.requiredEvidence } (occurrences.ts),
// and evaluateThresholdPass reads targetConfig.{minC,maxC}. So this module stores targetConfigJson as
// `{ minC, maxC }` (temperature only; null otherwise) and requiredEvidence as the evidence_type[] column.
// Editing a template never re-judges already-materialized occurrences — they carry a frozen snapshot.
import type { TenantClient } from "./db";
import { logActivity } from "./transition";
import { Prisma } from "../generated/prisma/client";
import type { CheckType, EvidenceType } from "../generated/prisma/enums";

export interface TemplateRow {
  id: string;
  title: string;
  checkType: CheckType;
  requiredEvidence: EvidenceType[];
  targetConfig: { minC?: number; maxC?: number } | null;
  instructions: string | null;
  isActive: boolean;
}

export interface TemplateWriteInput {
  organizationId: string;
  actorUserId: string;
  title: string;
  titleI18n?: Record<string, string> | null;
  checkType: CheckType;
  requiredEvidence: EvidenceType[];
  instructions?: string | null;
  /** Temperature threshold; null for non-temperature templates. */
  targetConfig?: { minC: number; maxC: number } | null;
}

// No unique constraint on template title (duplicates are allowed), so there is no conflict variant.
export type TemplateResult = { status: "ok"; templateId: string } | { status: "not-found" };

function targetConfigJson(input: TemplateWriteInput): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (input.checkType === "temperature" && input.targetConfig) {
    return { minC: input.targetConfig.minC, maxC: input.targetConfig.maxC };
  }
  return Prisma.DbNull;
}

function parseTargetConfig(json: Prisma.JsonValue | null): TemplateRow["targetConfig"] {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as { minC?: unknown; maxC?: unknown };
    const minC = typeof o.minC === "number" ? o.minC : undefined;
    const maxC = typeof o.maxC === "number" ? o.maxC : undefined;
    if (minC !== undefined || maxC !== undefined) return { minC, maxC };
  }
  return null;
}

/** List templates. Active-only by default (the schedule picker); pass includeInactive for the admin list. */
export async function listTemplates(
  tx: TenantClient,
  opts: { includeInactive?: boolean } = {},
): Promise<TemplateRow[]> {
  const rows = await tx.taskTemplate.findMany({
    where: { deletedAt: null, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: "desc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      checkType: true,
      requiredEvidence: true,
      targetConfigJson: true,
      instructions: true,
      isActive: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    checkType: r.checkType,
    requiredEvidence: r.requiredEvidence,
    targetConfig: parseTargetConfig(r.targetConfigJson),
    instructions: r.instructions,
    isActive: r.isActive,
  }));
}

export async function getTemplate(
  tx: TenantClient,
  templateId: string,
): Promise<TemplateRow | null> {
  const r = await tx.taskTemplate.findFirst({
    where: { id: templateId, deletedAt: null },
    select: {
      id: true,
      title: true,
      checkType: true,
      requiredEvidence: true,
      targetConfigJson: true,
      instructions: true,
      isActive: true,
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    checkType: r.checkType,
    requiredEvidence: r.requiredEvidence,
    targetConfig: parseTargetConfig(r.targetConfigJson),
    instructions: r.instructions,
    isActive: r.isActive,
  };
}

export async function createTemplate(
  tx: TenantClient,
  input: TemplateWriteInput,
): Promise<{ status: "ok"; templateId: string }> {
  const template = await tx.taskTemplate.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      titleI18n: input.titleI18n ?? Prisma.DbNull,
      checkType: input.checkType,
      requiredEvidence: input.requiredEvidence,
      targetConfigJson: targetConfigJson(input),
      instructions: input.instructions ?? null,
      // isActive defaults to true.
    },
    select: { id: true },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "taskTemplate",
    subjectId: template.id,
    action: "template.created",
    actorUserId: input.actorUserId,
    afterJson: {
      title: input.title,
      checkType: input.checkType,
      requiredEvidence: input.requiredEvidence,
    },
  });
  return { status: "ok", templateId: template.id };
}

export async function updateTemplate(
  tx: TenantClient,
  input: TemplateWriteInput & { templateId: string },
): Promise<TemplateResult> {
  const before = await tx.taskTemplate.findFirst({
    where: { id: input.templateId, deletedAt: null },
    select: { id: true, title: true, checkType: true, requiredEvidence: true },
  });
  if (!before) return { status: "not-found" };

  await tx.taskTemplate.update({
    where: { id: input.templateId },
    data: {
      title: input.title,
      titleI18n: input.titleI18n ?? Prisma.DbNull,
      checkType: input.checkType,
      requiredEvidence: input.requiredEvidence,
      targetConfigJson: targetConfigJson(input),
      instructions: input.instructions ?? null,
    },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "taskTemplate",
    subjectId: input.templateId,
    action: "template.updated",
    actorUserId: input.actorUserId,
    beforeJson: { title: before.title, checkType: before.checkType },
    afterJson: { title: input.title, checkType: input.checkType },
  });
  return { status: "ok", templateId: input.templateId };
}

/** Activate / deactivate a template. isActive is not a status-machine column (no F4 concern). */
export async function setTemplateActive(
  tx: TenantClient,
  input: { organizationId: string; actorUserId: string; templateId: string; active: boolean },
): Promise<TemplateResult> {
  const before = await tx.taskTemplate.findFirst({
    where: { id: input.templateId, deletedAt: null },
    select: { id: true, isActive: true },
  });
  if (!before) return { status: "not-found" };

  await tx.taskTemplate.update({
    where: { id: input.templateId },
    data: { isActive: input.active },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "taskTemplate",
    subjectId: input.templateId,
    action: input.active ? "template.activated" : "template.deactivated",
    actorUserId: input.actorUserId,
    beforeJson: { isActive: before.isActive },
    afterJson: { isActive: input.active },
  });
  return { status: "ok", templateId: input.templateId };
}
