// Responsive org nav (M4 #16, §12.7) — desktop sidebar and mobile bottom-bar are BOTH rendered; CSS
// breakpoints show one, so there is no JS branch and no layout shift. The Exceptions notification badge
// is a client island, shown only to triage+ roles (Staff cannot read the openExceptionsCount field —
// scope-auth minRole ShiftLeader, #15).
import Link from "next/link";
import type { OrgRole } from "@/generated/prisma/enums";
import type { MemberOrg } from "@/lib/member-orgs";
import { canManageProperties, canManageMembers, canManageTemplates } from "@/lib/permissions";
import { NotificationBadge } from "./NotificationBadge";
import { SignOutButton } from "./SignOutButton";
import { OrgSwitcher } from "./OrgSwitcher";

// Staff is the only role below the exceptions read scope; everyone else (incl. read-only Auditor) sees it.
function canSeeExceptions(role: OrgRole): boolean {
  return role !== "Staff";
}

// Settings (org & sites setup, #133): property managers reach it for outlet management, admins for the
// full site CRUD. Others don't see it.
function canSeeSettings(role: OrgRole): boolean {
  return canManageProperties(role) || role === "PropertyManager";
}

export function OrgNav({ org, role, orgs }: { org: string; role: OrgRole; orgs: MemberOrg[] }) {
  const showBadge = canSeeExceptions(role);
  const showSettings = canSeeSettings(role);
  const showMembers = canManageMembers(role);
  const showTemplates = canManageTemplates(role);
  const currentName = orgs.find((o) => o.id === org)?.name ?? "Shift Ledger";
  const multiOrg = orgs.length > 1;
  return (
    <>
      {/* Desktop sidebar */}
      <nav className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 md:flex">
        <div className="mb-6">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Shift Ledger
          </div>
          {multiOrg ? (
            <OrgSwitcher
              orgs={orgs}
              current={org}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          ) : (
            <div className="mt-1 truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {currentName}
            </div>
          )}
        </div>
        <Link
          href={`/${org}/today`}
          prefetch
          className="rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Today
        </Link>
        {showBadge && (
          <Link
            href={`/${org}/exceptions`}
            className="mt-1 flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Exceptions
            <NotificationBadge org={org} />
          </Link>
        )}
        {showTemplates && (
          <Link
            href={`/${org}/settings/templates`}
            className="mt-1 rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Templates
          </Link>
        )}
        {showMembers && (
          <Link
            href={`/${org}/settings/members`}
            className="mt-1 rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Members
          </Link>
        )}
        {showSettings && (
          <Link
            href={`/${org}/settings/properties`}
            className="mt-1 rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Settings
          </Link>
        )}
        <SignOutButton className="mt-auto rounded-md px-3 py-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-900" />
      </nav>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-around border-t border-zinc-200 bg-white py-2 dark:border-zinc-800 dark:bg-zinc-950 md:hidden">
        {multiOrg && (
          <OrgSwitcher
            orgs={orgs}
            current={org}
            className="max-w-[7rem] rounded-md border border-zinc-300 bg-white px-1 py-1 text-xs font-medium text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          />
        )}
        <Link
          href={`/${org}/today`}
          prefetch
          className="px-4 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300"
        >
          Today
        </Link>
        {showBadge && (
          <Link
            href={`/${org}/exceptions`}
            className="flex items-center gap-1 px-4 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Exceptions
            <NotificationBadge org={org} />
          </Link>
        )}
        {showTemplates && (
          <Link
            href={`/${org}/settings/templates`}
            className="px-4 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Templates
          </Link>
        )}
        {showMembers && (
          <Link
            href={`/${org}/settings/members`}
            className="px-4 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Members
          </Link>
        )}
        {showSettings && (
          <Link
            href={`/${org}/settings/properties`}
            className="px-4 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Settings
          </Link>
        )}
        <SignOutButton className="px-4 py-1 text-xs font-medium text-zinc-700 disabled:opacity-60 dark:text-zinc-300" />
      </nav>
    </>
  );
}
