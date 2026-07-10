// Sign-in page (#131). RSC guard: an already-authenticated visitor is bounced straight into the app
// (to returnTo, sanitized) rather than shown the form again. Otherwise render the client form.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { sanitizeReturnTo } from "@/lib/auth-gate";
import { SignInForm } from "./SignInForm";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const safeReturnTo = sanitizeReturnTo(returnTo);
  const session = await getAuth().api.getSession({
    headers: (await headers()) as unknown as Headers,
  });
  if (session?.user) redirect(safeReturnTo);

  return <SignInForm returnTo={safeReturnTo} />;
}
