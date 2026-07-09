"use client";
// Org switcher (#132) — the small client control in the app shell that lets a multi-org member jump
// between the organizations they belong to. Rendered only when the user has more than one org (the shell
// shows a static name otherwise). Selecting an org routes to /{org}/today; that layout re-resolves
// membership under RLS (fail-closed), so the switcher never needs to authorize anything itself.
import { useRouter } from "next/navigation";
import type { MemberOrg } from "@/lib/member-orgs";

export function OrgSwitcher({
  orgs,
  current,
  className,
}: {
  orgs: MemberOrg[];
  current: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <select
      aria-label="Switch organization"
      value={current}
      onChange={(e) => {
        if (e.target.value !== current) router.push(`/${e.target.value}/today`);
      }}
      className={className}
    >
      {orgs.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
