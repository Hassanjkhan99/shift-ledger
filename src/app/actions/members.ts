"use server";
// Members & invitations Server Actions (#134). Zod-validated, session-authenticated, D7 role/scope-gated
// writes over the members.ts domain. Invite tokens + expiries are minted server-side (never client). The
// accept action is the one member write that needs only a session (the invite link carries the org id).
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withTenant } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { resolveMemberForOrg, type MemberContext } from "@/lib/http-auth";
import { canManageMembers, canAssignMembership } from "@/lib/permissions";
import {
  createInvitation,
  revokeInvitation,
  resendInvitation,
  acceptInvitation,
  updateMembership,
  setMembershipStatus,
} from "@/lib/members";
import {
  inviteInput,
  revokeInvitationInput,
  resendInvitationInput,
  acceptInvitationInput,
  updateMemberInput,
  setMemberStatusInput,
} from "@/lib/member-input";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type MemberActionResult =
  | { status: "ok"; token?: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "validation"; issues: unknown[] }
  | { status: "conflict" }
  | { status: "invalid" } // accept: bad/consumed token
  | { status: "expired" }; // accept: expired token

class ForbiddenError extends Error {}

async function ctxFor(organizationId: string): Promise<MemberContext | null> {
  return resolveMemberForOrg((await headers()) as unknown as Headers, organizationId);
}

function revalidateMembers(org: string): void {
  revalidatePath(`/${org}/settings/members`);
}

export async function inviteMemberAction(raw: unknown): Promise<MemberActionResult> {
  const parsed = inviteInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageMembers(ctx.role)) return { status: "forbidden" };
  if (!canAssignMembership(ctx.role, ctx.propertyScope, input.role, input.propertyScope)) {
    return { status: "forbidden" };
  }

  const result = await withTenant(ctx.organizationId, (tx) =>
    createInvitation(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      email: input.email,
      role: input.role,
      propertyScope: input.propertyScope,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }),
  );
  if (result.status === "conflict") return { status: "conflict" };
  revalidateMembers(ctx.organizationId);
  return { status: "ok", token: result.token };
}

export async function revokeInvitationAction(raw: unknown): Promise<MemberActionResult> {
  const parsed = revokeInvitationInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageMembers(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    revokeInvitation(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      invitationId: input.invitationId,
    }),
  );
  if (result.status === "not-found") return { status: "not-found" };
  revalidateMembers(ctx.organizationId);
  return { status: "ok" };
}

export async function resendInvitationAction(raw: unknown): Promise<MemberActionResult> {
  const parsed = resendInvitationInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageMembers(ctx.role)) return { status: "forbidden" };

  const result = await withTenant(ctx.organizationId, (tx) =>
    resendInvitation(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      invitationId: input.invitationId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }),
  );
  if (result.status === "not-found") return { status: "not-found" };
  revalidateMembers(ctx.organizationId);
  return { status: "ok", token: result.token };
}

export async function acceptInvitationAction(raw: unknown): Promise<MemberActionResult> {
  const parsed = acceptInvitationInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const session = await getAuth().api.getSession({
    headers: (await headers()) as unknown as Headers,
  });
  const email = session?.user?.email;
  if (!email) return { status: "unauthorized" };

  const result = await withTenant(input.organizationId, (tx) =>
    acceptInvitation(tx, {
      organizationId: input.organizationId,
      token: input.token,
      email,
      userName: session?.user?.name ?? null,
      now: new Date(),
    }),
  );
  if (result.status === "invalid") return { status: "invalid" };
  if (result.status === "expired") return { status: "expired" };
  return { status: "ok" };
}

export async function updateMemberAction(raw: unknown): Promise<MemberActionResult> {
  const parsed = updateMemberInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageMembers(ctx.role)) return { status: "forbidden" };

  try {
    const result = await withTenant(ctx.organizationId, async (tx) => {
      const current = await tx.membership.findFirst({
        where: { id: input.membershipId, deletedAt: null },
        select: { role: true, propertyScope: true },
      });
      if (!current) return { status: "not-found" as const };
      // The actor must be allowed to touch BOTH the member's current grant and the requested new grant
      // (so a PM can't reach an admin member, nor escalate one out of scope).
      if (
        !canAssignMembership(ctx.role, ctx.propertyScope, current.role, current.propertyScope) ||
        !canAssignMembership(ctx.role, ctx.propertyScope, input.role, input.propertyScope)
      ) {
        throw new ForbiddenError();
      }
      return updateMembership(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        membershipId: input.membershipId,
        role: input.role,
        propertyScope: input.propertyScope,
      });
    });
    if (result.status === "not-found") return { status: "not-found" };
    revalidateMembers(ctx.organizationId);
    return { status: "ok" };
  } catch (err) {
    if (err instanceof ForbiddenError) return { status: "forbidden" };
    throw err;
  }
}

export async function setMemberStatusAction(raw: unknown): Promise<MemberActionResult> {
  const parsed = setMemberStatusInput.safeParse(raw);
  if (!parsed.success) return { status: "validation", issues: parsed.error.issues };
  const input = parsed.data;

  const ctx = await ctxFor(input.organizationId);
  if (!ctx) return { status: "unauthorized" };
  if (!canManageMembers(ctx.role)) return { status: "forbidden" };

  try {
    const result = await withTenant(ctx.organizationId, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: input.membershipId, deletedAt: null },
        select: { userId: true, role: true, propertyScope: true },
      });
      if (!target) return { status: "not-found" as const };
      // Never let a user lock themselves out.
      if (target.userId === ctx.userId) throw new ForbiddenError();
      // PM may only act within scope / on non-admins.
      if (!canAssignMembership(ctx.role, ctx.propertyScope, target.role, target.propertyScope)) {
        throw new ForbiddenError();
      }
      // Don't deactivate the last active Owner (org must always have one).
      if (!input.active && target.role === "Owner") {
        const activeOwners = await tx.membership.count({
          where: { role: "Owner", status: "active", deletedAt: null },
        });
        if (activeOwners <= 1) throw new ForbiddenError();
      }
      return setMembershipStatus(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        membershipId: input.membershipId,
        active: input.active,
      });
    });
    if (result.status === "not-found") return { status: "not-found" };
    revalidateMembers(ctx.organizationId);
    return { status: "ok" };
  } catch (err) {
    if (err instanceof ForbiddenError) return { status: "forbidden" };
    throw err;
  }
}
