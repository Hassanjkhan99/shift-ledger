// Accept-invitation landing (#134). A signed-in user opens the invite link (which carries the org id as
// `?o=`); this page establishes they have a session, then the client form consumes the token. No session
// -> bounce to sign-in with a returnTo back here (so they land on accept after authenticating). The token
// is validated server-side under the org's RLS scope by acceptInvitationAction.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { AcceptInviteForm } from "./AcceptInviteForm";

export default async function AcceptInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ o?: string }>;
}) {
  const { token } = await params;
  const { o: org } = await searchParams;

  const session = await getAuth().api.getSession({
    headers: (await headers()) as unknown as Headers,
  });
  if (!session?.user?.email) {
    const returnTo = `/invite/${token}${org ? `?o=${org}` : ""}`;
    redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-4 py-16">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Accept your invitation
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          You’re signed in as <span className="font-medium">{session.user.email}</span>. Accept to
          join the organization and start recording operational proof.
        </p>
      </div>
      <AcceptInviteForm token={token} org={org ?? null} />
    </main>
  );
}
