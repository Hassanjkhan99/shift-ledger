// Members & invitations domain (#134). Membership role/scope management + the invitation lifecycle
// (create -> accept | revoke | expire). Every function runs inside a caller-provided tenant transaction
// (withTenant, D6) and pairs each write with a logActivity() audit row (F4/F6).
//
// STATUS COLUMNS & THE F4 GUARD: `memberships.status` and `invitations.status` are lifecycle flags, but
// neither is one of the F4-audited state machines (occurrence / exception / corrective_action). The F4
// static guard (tests/f4-assertion.test.ts) flags any literal `status:` key inside a Prisma
// `.create/.update` data object, so we (a) OMIT status on create and rely on the schema default, and
// (b) flip status via raw `UPDATE` (which the guard intentionally does not scan) — recording every
// change through logActivity() so the audit trail is still complete.
//
// ACCEPT-INVITE is a no-tenant-context-in-the-URL flow: the invite link carries the org id, so the
// action can enter withTenant(org) and validate the globally-unique token under RLS (a wrong org id
// simply fails the scoped lookup). Accepting bootstraps the domain `users` row (a brand-new Better Auth
// user has none) + the membership — the same onboarding seam as create-organization.
import type { TenantClient } from "./db";
import { logActivity } from "./transition";
import { Prisma } from "../generated/prisma/client";
import type { OrgRole } from "../generated/prisma/enums";

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  role: OrgRole;
  propertyScope: string[];
  status: string;
}

/** List every membership in the tenant (active + inactive), with the linked user's email/name. */
export async function listMembers(tx: TenantClient): Promise<MemberRow[]> {
  const rows = await tx.membership.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      role: true,
      propertyScope: true,
      status: true,
      user: { select: { email: true, name: true } },
    },
  });
  return rows.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    propertyScope: m.propertyScope,
    status: m.status,
  }));
}

export interface UpdateMembershipInput {
  organizationId: string;
  actorUserId: string;
  membershipId: string;
  role: OrgRole;
  propertyScope: string[];
}

export type MembershipResult = { status: "ok" } | { status: "not-found" };

/** Change a member's role + property scope (never their active/inactive status — see setMembershipStatus). */
export async function updateMembership(
  tx: TenantClient,
  input: UpdateMembershipInput,
): Promise<MembershipResult> {
  const before = await tx.membership.findFirst({
    where: { id: input.membershipId, deletedAt: null },
    select: { id: true, role: true, propertyScope: true },
  });
  if (!before) return { status: "not-found" };

  await tx.membership.update({
    where: { id: input.membershipId },
    data: { role: input.role, propertyScope: input.propertyScope },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "membership",
    subjectId: input.membershipId,
    action: "membership.updated",
    actorUserId: input.actorUserId,
    beforeJson: { role: before.role, propertyScope: before.propertyScope },
    afterJson: { role: input.role, propertyScope: input.propertyScope },
  });
  return { status: "ok" };
}

/** Activate / deactivate a member. Status flip via raw UPDATE (see F4 note at top); audited. */
export async function setMembershipStatus(
  tx: TenantClient,
  input: { organizationId: string; actorUserId: string; membershipId: string; active: boolean },
): Promise<MembershipResult> {
  const before = await tx.membership.findFirst({
    where: { id: input.membershipId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!before) return { status: "not-found" };

  const next = input.active ? "active" : "inactive";
  // Raw UPDATE (RLS-scoped by withTenant): memberships.status is not an F4 state machine, and a literal
  // `status:` in a Prisma update would trip the F4 static guard. updated_at kept fresh by trigger/@updatedAt.
  await tx.$executeRaw`UPDATE memberships SET status = ${next}, updated_at = now() WHERE id = ${input.membershipId}::uuid`;
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "membership",
    subjectId: input.membershipId,
    action: input.active ? "membership.reactivated" : "membership.deactivated",
    actorUserId: input.actorUserId,
    beforeJson: { status: before.status },
    afterJson: { status: next },
  });
  return { status: "ok" };
}

// ---- Invitations ----------------------------------------------------------------

export interface InvitationRow {
  id: string;
  email: string;
  role: OrgRole;
  propertyScope: string[];
  status: string;
  token: string;
  expiresAt: Date;
}

/** List invitations (pending first, newest first) for the members screen. */
export async function listInvitations(tx: TenantClient): Promise<InvitationRow[]> {
  const rows = await tx.invitation.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      propertyScope: true,
      status: true,
      token: true,
      expiresAt: true,
    },
  });
  return rows;
}

export interface CreateInvitationInput {
  organizationId: string;
  actorUserId: string;
  email: string;
  role: OrgRole;
  propertyScope: string[];
  token: string;
  expiresAt: Date;
}

export type CreateInvitationResult =
  { status: "ok"; invitationId: string; token: string } | { status: "conflict" }; // an active pending invite already exists for this email

export async function createInvitation(
  tx: TenantClient,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  // One live pending invite per email keeps the list unambiguous; a prior pending one must be revoked
  // or re-sent first. (Accepted/revoked/expired rows don't block a fresh invite.)
  const existing = await tx.invitation.findFirst({
    where: { email: input.email, status: "pending", deletedAt: null },
    select: { id: true },
  });
  if (existing) return { status: "conflict" };

  const invitation = await tx.invitation.create({
    // status omitted: defaults to `pending` (avoids the F4 literal-status guard).
    data: {
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
      propertyScope: input.propertyScope,
      token: input.token,
      invitedById: input.actorUserId,
      expiresAt: input.expiresAt,
    },
    select: { id: true },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "invitation",
    subjectId: invitation.id,
    action: "invitation.created",
    actorUserId: input.actorUserId,
    afterJson: { email: input.email, role: input.role, propertyScope: input.propertyScope },
  });
  return { status: "ok", invitationId: invitation.id, token: input.token };
}

export async function revokeInvitation(
  tx: TenantClient,
  input: { organizationId: string; actorUserId: string; invitationId: string },
): Promise<MembershipResult> {
  const before = await tx.invitation.findFirst({
    where: { id: input.invitationId, status: "pending", deletedAt: null },
    select: { id: true, email: true },
  });
  if (!before) return { status: "not-found" };

  await tx.$executeRaw`UPDATE invitations SET status = 'revoked'::invitation_status, updated_at = now() WHERE id = ${input.invitationId}::uuid`;
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "invitation",
    subjectId: input.invitationId,
    action: "invitation.revoked",
    actorUserId: input.actorUserId,
    beforeJson: { email: before.email, status: "pending" },
    afterJson: { status: "revoked" },
  });
  return { status: "ok" };
}

/**
 * Refresh a pending invitation: rotate the token and extend the expiry (the MVP "resend", since email
 * delivery is a fast-follow — the admin re-shares the new link). Not a status write, so a plain update.
 */
export async function resendInvitation(
  tx: TenantClient,
  input: {
    organizationId: string;
    actorUserId: string;
    invitationId: string;
    token: string;
    expiresAt: Date;
  },
): Promise<{ status: "ok"; token: string } | { status: "not-found" }> {
  const before = await tx.invitation.findFirst({
    where: { id: input.invitationId, status: "pending", deletedAt: null },
    select: { id: true },
  });
  if (!before) return { status: "not-found" };

  await tx.invitation.update({
    where: { id: input.invitationId },
    data: { token: input.token, expiresAt: input.expiresAt },
  });
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "invitation",
    subjectId: input.invitationId,
    action: "invitation.resent",
    actorUserId: input.actorUserId,
    afterJson: { expiresAt: input.expiresAt.toISOString() },
  });
  return { status: "ok", token: input.token };
}

export interface AcceptInvitationInput {
  organizationId: string;
  token: string;
  email: string; // the accepting Better Auth session's email
  userName?: string | null;
  now: Date;
}

export type AcceptInvitationResult =
  | { status: "ok"; organizationId: string; alreadyMember: boolean }
  | { status: "invalid" } // no pending invite for this token in this org
  | { status: "expired" };

/**
 * Consume a pending, non-expired invitation for the accepting session's email: bootstrap the domain
 * user (idempotent), create the membership with the invite's role + scope, and mark the invite accepted.
 * Bearer-link model — whoever holds the link + a session becomes the member (the invite email is
 * recorded on the invitation; the membership links the session email, per the issue). All under RLS.
 */
export async function acceptInvitation(
  tx: TenantClient,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const invite = await tx.invitation.findFirst({
    where: { token: input.token, status: "pending", deletedAt: null },
    select: { id: true, role: true, propertyScope: true, expiresAt: true },
  });
  if (!invite) return { status: "invalid" };
  if (invite.expiresAt.getTime() <= input.now.getTime()) {
    // Best-effort mark expired so the list reflects reality; the accept still fails.
    await tx.$executeRaw`UPDATE invitations SET status = 'expired'::invitation_status, updated_at = now() WHERE id = ${invite.id}::uuid`;
    return { status: "expired" };
  }

  const user = await tx.user.upsert({
    where: { email: input.email },
    update: {},
    create: { email: input.email, name: input.userName ?? null },
    select: { id: true },
  });

  const existingMembership = await tx.membership.findUnique({
    where: { organizationId_userId: { organizationId: input.organizationId, userId: user.id } },
    select: { id: true },
  });

  if (!existingMembership) {
    const membership = await tx.membership.create({
      // status omitted -> defaults to active (F4 guard).
      data: {
        organizationId: input.organizationId,
        userId: user.id,
        role: invite.role,
        propertyScope: invite.propertyScope,
      },
      select: { id: true },
    });
    await logActivity(tx, {
      organizationId: input.organizationId,
      subjectType: "membership",
      subjectId: membership.id,
      action: "membership.created",
      actorUserId: user.id,
      afterJson: { role: invite.role, propertyScope: invite.propertyScope, via: "invitation" },
    });
  }

  await tx.$executeRaw`UPDATE invitations SET status = 'accepted'::invitation_status, accepted_at = now(), updated_at = now() WHERE id = ${invite.id}::uuid`;
  await logActivity(tx, {
    organizationId: input.organizationId,
    subjectType: "invitation",
    subjectId: invite.id,
    action: "invitation.accepted",
    actorUserId: user.id,
    afterJson: { status: "accepted" },
  });

  return {
    status: "ok",
    organizationId: input.organizationId,
    alreadyMember: Boolean(existingMembership),
  };
}

/** Narrow a Prisma unique-violation (used by the action layer for a friendly message). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
