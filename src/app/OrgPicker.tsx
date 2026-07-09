// Org picker (#132) — shown at `/` when the authenticated user is an active member of MORE THAN ONE
// organization. Server component: a plain list of links into each org's Today. Choosing one navigates to
// /{org}/today, where the layout re-resolves membership (fail-closed). No client JS needed here.
import Link from "next/link";
import type { MemberOrg } from "@/lib/member-orgs";

// "KitchenManager" -> "Kitchen Manager" for display; the enum stays the source of truth.
function roleLabel(role: string): string {
  return role.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function OrgPicker({ orgs }: { orgs: MemberOrg[] }) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Choose an organization
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          You’re a member of several organizations. Pick one to continue.
        </p>
      </div>
      <ul className="space-y-2">
        {orgs.map((org) => (
          <li key={org.id}>
            <Link
              href={`/${org.id}/today`}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {org.name}
              </span>
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {roleLabel(org.role)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
