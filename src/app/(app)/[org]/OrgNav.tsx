// Responsive org nav (M4 #16, §12.7) — desktop sidebar and mobile bottom-bar are BOTH rendered; CSS
// breakpoints show one, so there is no JS branch and no layout shift. The Exceptions notification badge
// is a client island, shown only to triage+ roles (Staff cannot read the openExceptionsCount field —
// scope-auth minRole ShiftLeader, #15).
import Link from "next/link";
import type { OrgRole } from "@/generated/prisma/enums";
import { NotificationBadge } from "./NotificationBadge";

// Staff is the only role below the exceptions read scope; everyone else (incl. read-only Auditor) sees it.
function canSeeExceptions(role: OrgRole): boolean {
  return role !== "Staff";
}

export function OrgNav({ org, role }: { org: string; role: OrgRole }) {
  const showBadge = canSeeExceptions(role);
  return (
    <>
      {/* Desktop sidebar */}
      <nav className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 md:flex">
        <div className="mb-6 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Shift Ledger
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
      </nav>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-around border-t border-zinc-200 bg-white py-2 dark:border-zinc-800 dark:bg-zinc-950 md:hidden">
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
      </nav>
    </>
  );
}
