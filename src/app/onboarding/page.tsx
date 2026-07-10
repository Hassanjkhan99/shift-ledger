// Onboarding landing (#132, #133). Where an AUTHENTICATED user with no active membership is routed — they
// have an identity but belong to no organization yet. As of #133 this hosts the real create-organization
// flow (the creator becomes Owner); accepting an invite is still a separate M6 issue.
//
// Guarded so it can't be reached in the wrong state: no session -> sign-in; already has an org -> back to
// `/` (which routes into the app), so this screen only ever shows for the genuine zero-membership case.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { listMemberOrganizations, resolveUserIdByEmail } from "@/lib/member-orgs";
import { SignOutButton } from "@/app/(app)/[org]/SignOutButton";
import { NewOrganizationForm } from "./NewOrganizationForm";

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
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Set up your organization
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Your account isn’t part of an organization yet. Create one to start recording daily
          operational proof — you’ll be its owner. If you were expecting an invitation, ask your
          administrator to send it.
        </p>
      </div>
      <NewOrganizationForm />
      <div className="text-center">
        <SignOutButton className="text-sm font-medium text-zinc-500 underline hover:text-zinc-700 disabled:opacity-60 dark:text-zinc-400 dark:hover:text-zinc-200" />
      </div>
    </main>
  );
}
