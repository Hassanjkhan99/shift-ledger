// Input schemas for the members & invitations Server Actions (#134). Plain module (not the "use server"
// action file) so the validation contract is unit-testable without a Next request context.
import { z } from "zod";
import { OrgRole } from "../generated/prisma/enums";

const orgIdField = z.string().uuid();
const idField = z.string().uuid();
const roleField = z.nativeEnum(OrgRole);
const scopeField = z.array(z.string().uuid()).default([]);

export const inviteInput = z.object({
  organizationId: orgIdField,
  email: z.string().trim().toLowerCase().email(),
  role: roleField,
  propertyScope: scopeField,
});

export const revokeInvitationInput = z.object({
  organizationId: orgIdField,
  invitationId: idField,
});

export const resendInvitationInput = z.object({
  organizationId: orgIdField,
  invitationId: idField,
});

export const acceptInvitationInput = z.object({
  organizationId: orgIdField,
  token: z.string().min(1),
});

export const updateMemberInput = z.object({
  organizationId: orgIdField,
  membershipId: idField,
  role: roleField,
  propertyScope: scopeField,
});

export const setMemberStatusInput = z.object({
  organizationId: orgIdField,
  membershipId: idField,
  active: z.boolean(),
});
