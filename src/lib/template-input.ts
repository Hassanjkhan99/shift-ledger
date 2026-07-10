// Input schemas for the task-template Server Actions (#135). Plain module (testable without a Next
// request context). The temperature threshold is required + ordered (minC <= maxC) only when
// check_type is temperature; ignored otherwise.
import { z } from "zod";
import { CheckType, EvidenceType } from "../generated/prisma/enums";

const orgIdField = z.string().uuid();
const templateIdField = z.string().uuid();

const baseTemplateShape = {
  organizationId: orgIdField,
  title: z.string().trim().min(1).max(200),
  checkType: z.nativeEnum(CheckType),
  requiredEvidence: z.array(z.nativeEnum(EvidenceType)).default([]),
  instructions: z.string().trim().max(2000).optional(),
  minC: z.number().optional(),
  maxC: z.number().optional(),
};

const temperatureRefine = (
  data: { checkType: CheckType; minC?: number; maxC?: number },
  ctx: z.RefinementCtx,
): void => {
  if (data.checkType !== CheckType.temperature) return;
  if (data.minC === undefined || data.maxC === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Temperature templates need a min and max °C.",
      path: ["minC"],
    });
    return;
  }
  if (data.minC > data.maxC) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Min °C must not exceed max °C.",
      path: ["minC"],
    });
  }
};

export const createTemplateInput = z.object(baseTemplateShape).superRefine(temperatureRefine);

export const updateTemplateInput = z
  .object({ ...baseTemplateShape, templateId: templateIdField })
  .superRefine(temperatureRefine);

export const setTemplateActiveInput = z.object({
  organizationId: orgIdField,
  templateId: templateIdField,
  active: z.boolean(),
});
