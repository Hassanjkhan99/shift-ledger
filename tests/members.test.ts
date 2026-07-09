import { describe, it, expect, inject, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant, disconnect } from "../src/lib/db";
import { resolveMemberForEmail } from "../src/lib/http-auth";
import {
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  updateMembership,
  setMembershipStatus,
} from "../src/lib/members";

// #134 — invitation lifecycle + membership management. Accept bootstraps the domain user + membership so
// resolveMemberForEmail then resolves; expired/revoked/cross-tenant tokens are rejected; deactivation
// removes access (mirrors http-auth's inactive test). All under withTenant() (D6).
const orgAId = inject("orgAId");
const orgBId = inject("orgBId");

afterAll(async () => {
  await disconnect();
});

async function makeActor(orgId: string): Promise<string> {
  return withTenant(orgId, async (tx) => {
    const u = await tx.user.create({
      data: { email: `inviter-${randomUUID()}@example.com`, name: "Inviter" },
      select: { id: true },
    });
    await tx.membership.create({
      data: { organizationId: orgId, userId: u.id, role: "Owner", propertyScope: [] },
    });
    return u.id;
  });
}

async function invite(
  orgId: string,
  actorUserId: string,
  opts: { email?: string; expiresAt?: Date; role?: "Staff" | "KitchenManager" } = {},
): Promise<{ token: string; email: string }> {
  const email = opts.email ?? `invitee-${randomUUID()}@example.com`;
  const token = randomUUID();
  const res = await withTenant(orgId, (tx) =>
    createInvitation(tx, {
      organizationId: orgId,
      actorUserId,
      email,
      role: opts.role ?? "Staff",
      propertyScope: [],
      token,
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 3600_000),
    }),
  );
  if (res.status !== "ok") throw new Error(`invite setup failed: ${res.status}`);
  return { token, email };
}

describe("invitations (#134)", () => {
  it("accept creates an active membership + links the user, so resolveMemberForEmail resolves", async () => {
    const actor = await makeActor(orgAId);
    const { token } = await invite(orgAId, actor, { role: "KitchenManager" });
    const accepterEmail = `accepter-${randomUUID()}@example.com`;

    const res = await withTenant(orgAId, (tx) =>
      acceptInvitation(tx, {
        organizationId: orgAId,
        token,
        email: accepterEmail,
        userName: "Accepter",
        now: new Date(),
      }),
    );
    expect(res.status).toBe("ok");

    const ctx = await resolveMemberForEmail(accepterEmail, orgAId);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("KitchenManager");
  });

  it("rejects an expired token", async () => {
    const actor = await makeActor(orgAId);
    const { token } = await invite(orgAId, actor, { expiresAt: new Date(Date.now() - 1000) });
    const res = await withTenant(orgAId, (tx) =>
      acceptInvitation(tx, {
        organizationId: orgAId,
        token,
        email: `x-${randomUUID()}@example.com`,
        now: new Date(),
      }),
    );
    expect(res.status).toBe("expired");
  });

  it("rejects a revoked token", async () => {
    const actor = await makeActor(orgAId);
    const { token } = await invite(orgAId, actor);
    // find the invitation id to revoke
    const inv = await withTenant(orgAId, (tx) =>
      tx.invitation.findFirst({ where: { token }, select: { id: true } }),
    );
    const rev = await withTenant(orgAId, (tx) =>
      revokeInvitation(tx, { organizationId: orgAId, actorUserId: actor, invitationId: inv!.id }),
    );
    expect(rev.status).toBe("ok");

    const res = await withTenant(orgAId, (tx) =>
      acceptInvitation(tx, {
        organizationId: orgAId,
        token,
        email: `y-${randomUUID()}@example.com`,
        now: new Date(),
      }),
    );
    expect(res.status).toBe("invalid");
  });

  it("rejects a duplicate pending invite for the same email (conflict)", async () => {
    const actor = await makeActor(orgAId);
    const email = `dup-${randomUUID()}@example.com`;
    await invite(orgAId, actor, { email });
    const second = await withTenant(orgAId, (tx) =>
      createInvitation(tx, {
        organizationId: orgAId,
        actorUserId: actor,
        email,
        role: "Staff",
        propertyScope: [],
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    );
    expect(second.status).toBe("conflict");
  });

  it("does not accept an org A token under org B's scope (RLS, D6)", async () => {
    const actor = await makeActor(orgAId);
    const { token } = await invite(orgAId, actor);
    const res = await withTenant(orgBId, (tx) =>
      acceptInvitation(tx, {
        organizationId: orgBId,
        token,
        email: `z-${randomUUID()}@example.com`,
        now: new Date(),
      }),
    );
    expect(res.status).toBe("invalid");
  });
});

describe("membership management (#134)", () => {
  it("updates role + scope", async () => {
    const actor = await makeActor(orgAId);
    const { token } = await invite(orgAId, actor);
    const email = `upd-${randomUUID()}@example.com`;
    await withTenant(orgAId, (tx) =>
      acceptInvitation(tx, { organizationId: orgAId, token, email, now: new Date() }),
    );
    const m = await withTenant(orgAId, (tx) =>
      tx.membership.findFirst({
        where: { user: { email } },
        select: { id: true },
      }),
    );

    const res = await withTenant(orgAId, (tx) =>
      updateMembership(tx, {
        organizationId: orgAId,
        actorUserId: actor,
        membershipId: m!.id,
        role: "ShiftLeader",
        propertyScope: [],
      }),
    );
    expect(res.status).toBe("ok");
    const ctx = await resolveMemberForEmail(email, orgAId);
    expect(ctx!.role).toBe("ShiftLeader");
  });

  it("deactivation removes access (mirrors http-auth inactive)", async () => {
    const actor = await makeActor(orgAId);
    const { token } = await invite(orgAId, actor);
    const email = `deact-${randomUUID()}@example.com`;
    await withTenant(orgAId, (tx) =>
      acceptInvitation(tx, { organizationId: orgAId, token, email, now: new Date() }),
    );
    const m = await withTenant(orgAId, (tx) =>
      tx.membership.findFirst({ where: { user: { email } }, select: { id: true } }),
    );

    const res = await withTenant(orgAId, (tx) =>
      setMembershipStatus(tx, {
        organizationId: orgAId,
        actorUserId: actor,
        membershipId: m!.id,
        active: false,
      }),
    );
    expect(res.status).toBe("ok");
    expect(await resolveMemberForEmail(email, orgAId)).toBeNull();

    // Reactivate restores access.
    await withTenant(orgAId, (tx) =>
      setMembershipStatus(tx, {
        organizationId: orgAId,
        actorUserId: actor,
        membershipId: m!.id,
        active: true,
      }),
    );
    expect(await resolveMemberForEmail(email, orgAId)).not.toBeNull();
  });
});
