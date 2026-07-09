// Onboarding landing (#132). Where an AUTHENTICATED user with no active membership is routed — they have
// an identity but belong to no organization yet. This is only the ENTRY/placeholder: actually creating an
// org or accepting an invite are their own M6 issues (out of scope here), so this page just explains the
// next step and offers a way out (sign-out) rather than stranding the user on a 404.
//
// Guarded so it can't be reached in the wrong state: no session -> sign-in; already has an org -> back to
// `/` (which routes into the app), so this screen only ever shows for the genuine zero-membership case.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { listMemberOrganizations, resolveUserIdByEmail } from "@/lib/member-orgs";
import { SignOutButton } from "@/app/(app)/[org]/SignOutButton";

export default async function OnboardingPage() {
  const session = await getAuth().api.getSession({
    headers: (await headers()) as unknown as Headers,
  });
  const email = session?.user?.email ?? null;
  if (!email) redirect("/sign-in?returnTo=%2Fonboarding");

  const userId = await resolveUserIdByEmail(email);
  const orgs = userId ? await listMemberOrganizations(userId) : [];
  if (orgs.length > 0) redirect("/");

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-4 py-16">
      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          You’re signed in
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Your account isn’t part of an organization yet. Ask an administrator to invite you, or set
          up a new organization to start recording daily operational proof.
        </p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-500">
          Organization setup and invitations are coming soon.
        </p>
        <SignOutButton className="mt-6 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900" />
      </div>
    </main>
  );
}
