"use client";
// Members & invitations manager (#134). Invite by email (role + property scope), see the roster, edit a
// member's role/scope, deactivate/reactivate, and manage pending invitations (copy link, resend, revoke).
// The server re-enforces every D7 rule; the client mirrors it (assignable roles, self-guard) only for UX.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { OrgRole } from "@/generated/prisma/enums";
import { canAssignMembership } from "@/lib/permissions";
import {
  inviteMemberAction,
  revokeInvitationAction,
  resendInvitationAction,
  updateMemberAction,
  setMemberStatusAction,
} from "@/app/actions/members";
import { inputClass, labelClass, buttonClass, FormError } from "@/app/(auth)/ui";

interface Member {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  role: OrgRole;
  propertyScope: string[];
  status: string;
}
interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  propertyScope: string[];
  status: string;
  token: string;
  expiresAt: string;
}
interface Property {
  id: string;
  name: string;
}
interface Props {
  org: string;
  actorRole: OrgRole;
  actorScope: string[];
  currentUserId: string;
  members: Member[];
  invitations: Invitation[];
  properties: Property[];
}

const ALL_ROLES = Object.values(OrgRole) as OrgRole[];

function assignableRoles(actorRole: OrgRole): OrgRole[] {
  if (actorRole === OrgRole.Owner || actorRole === OrgRole.OrgAdmin) return ALL_ROLES;
  if (actorRole === OrgRole.PropertyManager) {
    return ALL_ROLES.filter(
      (r) => r !== OrgRole.Owner && r !== OrgRole.OrgAdmin && r !== OrgRole.PropertyManager,
    );
  }
  return [];
}

const smallBtn =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

function ScopePicker({
  properties,
  selected,
  onToggle,
  disabled,
}: {
  properties: Property[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  if (properties.length === 0) {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">No properties yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {properties.map((p) => (
        <label
          key={p.id}
          className="flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300"
        >
          <input
            type="checkbox"
            checked={selected.has(p.id)}
            onChange={() => onToggle(p.id)}
            disabled={disabled}
          />
          {p.name}
        </label>
      ))}
      <span className="text-xs text-zinc-400">(none = whole org)</span>
    </div>
  );
}

export function MembersManager(props: Props) {
  const roles = assignableRoles(props.actorRole);
  return (
    <div className="space-y-8">
      <InviteForm org={props.org} roles={roles} properties={props.properties} />
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Team</h2>
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {props.members.map((m) => (
            <MemberItem key={m.membershipId} {...props} member={m} roles={roles} />
          ))}
        </ul>
      </section>
      <InvitationsList
        org={props.org}
        invitations={props.invitations}
        properties={props.properties}
      />
    </div>
  );
}

function InviteForm({
  org,
  roles,
  properties,
}: {
  org: string;
  roles: OrgRole[];
  properties: Property[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>(roles[0] ?? OrgRole.Staff);
  const [scope, setScope] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLink(null);
    if (!email.trim()) {
      setError("Enter an email address.");
      return;
    }
    setPending(true);
    const result = await inviteMemberAction({
      organizationId: org,
      email: email.trim(),
      role,
      propertyScope: [...scope],
    });
    setPending(false);
    if (result.status === "ok" && result.token) {
      setLink(`${window.location.origin}/invite/${result.token}?o=${org}`);
      setEmail("");
      setScope(new Set());
      router.refresh();
    } else if (result.status === "conflict") {
      setError("There is already a pending invitation for that email.");
    } else if (result.status === "forbidden") {
      setError("You can’t invite with that role or scope.");
    } else if (result.status === "validation") {
      setError("Enter a valid email and role.");
    } else {
      setError("Could not create the invitation.");
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Invite a teammate
      </h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1">
            <label htmlFor="invite-email" className={labelClass}>
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
              className={inputClass}
              placeholder="teammate@example.com"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className={labelClass}>
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              disabled={pending}
              className={inputClass}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <span className={labelClass}>Property scope</span>
          <div className="mt-1">
            <ScopePicker
              properties={properties}
              selected={scope}
              disabled={pending}
              onToggle={(id) =>
                setScope((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            />
          </div>
        </div>
        <FormError message={error} />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Inviting…" : "Create invitation"}
        </button>
      </form>
      {link && (
        <div className="mt-3 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
          <p className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Share this link (email delivery is coming soon):
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400">{link}</code>
            <button
              type="button"
              className={smallBtn}
              onClick={() => navigator.clipboard?.writeText(link)}
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function MemberItem(props: Props & { member: Member; roles: OrgRole[] }) {
  const { org, member, roles, actorRole, actorScope, currentUserId, properties } = props;
  const router = useRouter();
  const [role, setRole] = useState<OrgRole>(member.role);
  const [scope, setScope] = useState<Set<string>>(new Set(member.propertyScope));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelf = member.userId === currentUserId;
  const mayManage = canAssignMembership(actorRole, actorScope, member.role, member.propertyScope);
  const scopeNames =
    member.propertyScope.length === 0
      ? "Whole org"
      : member.propertyScope
          .map((id) => properties.find((p) => p.id === id)?.name ?? "—")
          .join(", ");

  async function onSave() {
    setError(null);
    setPending(true);
    const result = await updateMemberAction({
      organizationId: org,
      membershipId: member.membershipId,
      role,
      propertyScope: [...scope],
    });
    setPending(false);
    if (result.status === "ok") router.refresh();
    else setError(result.status === "forbidden" ? "Not allowed." : "Could not save.");
  }

  async function onToggleStatus() {
    setError(null);
    setPending(true);
    const result = await setMemberStatusAction({
      organizationId: org,
      membershipId: member.membershipId,
      active: member.status !== "active",
    });
    setPending(false);
    if (result.status === "ok") router.refresh();
    else setError(result.status === "forbidden" ? "Not allowed." : "Could not update.");
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {member.name ?? member.email}
            {isSelf && <span className="ml-2 text-xs text-zinc-400">(you)</span>}
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{member.email}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            member.status === "active"
              ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {member.status}
        </span>
      </div>

      {mayManage && !isSelf ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              disabled={pending}
              className={inputClass + " max-w-[10rem]"}
            >
              {[...new Set([member.role, ...roles])].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button type="button" onClick={onSave} disabled={pending} className={smallBtn}>
              Save
            </button>
            <button type="button" onClick={onToggleStatus} disabled={pending} className={smallBtn}>
              {member.status === "active" ? "Deactivate" : "Reactivate"}
            </button>
          </div>
          <ScopePicker
            properties={properties}
            selected={scope}
            disabled={pending}
            onToggle={(id) =>
              setScope((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {member.role} · {scopeNames}
        </p>
      )}
    </li>
  );
}

function InvitationsList({
  org,
  invitations,
  properties,
}: {
  org: string;
  invitations: Invitation[];
  properties: Property[];
}) {
  if (invitations.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Invitations</h2>
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {invitations.map((inv) => (
          <InvitationItem key={inv.id} org={org} invitation={inv} properties={properties} />
        ))}
      </ul>
    </section>
  );
}

function InvitationItem({
  org,
  invitation,
  properties,
}: {
  org: string;
  invitation: Invitation;
  properties: Property[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState<string | null>(
    invitation.status === "pending"
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${invitation.token}?o=${org}`
      : null,
  );
  const isPending = invitation.status === "pending";
  const scopeNames =
    invitation.propertyScope.length === 0
      ? "Whole org"
      : invitation.propertyScope
          .map((id) => properties.find((p) => p.id === id)?.name ?? "—")
          .join(", ");

  async function onRevoke() {
    setPending(true);
    await revokeInvitationAction({ organizationId: org, invitationId: invitation.id });
    setPending(false);
    router.refresh();
  }
  async function onResend() {
    setPending(true);
    const result = await resendInvitationAction({
      organizationId: org,
      invitationId: invitation.id,
    });
    setPending(false);
    if (result.status === "ok" && result.token) {
      setLink(`${window.location.origin}/invite/${result.token}?o=${org}`);
    }
    router.refresh();
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">{invitation.email}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {invitation.role} · {scopeNames} · {invitation.status}
          </p>
        </div>
        {isPending && (
          <div className="flex shrink-0 gap-2">
            {link && (
              <button
                type="button"
                className={smallBtn}
                onClick={() => navigator.clipboard?.writeText(link)}
              >
                Copy link
              </button>
            )}
            <button type="button" onClick={onResend} disabled={pending} className={smallBtn}>
              Resend
            </button>
            <button type="button" onClick={onRevoke} disabled={pending} className={smallBtn}>
              Revoke
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
