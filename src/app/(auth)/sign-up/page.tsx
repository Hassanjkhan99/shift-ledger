// Sign-up page (#131). RSC guard mirrors sign-in: an already-authenticated visitor skips the form.
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { sanitizeReturnTo } from "@/lib/auth-gate";
import { SignUpForm } from "./SignUpForm";

export default async function SignUpPage({
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

  return <SignUpForm returnTo={safeReturnTo} />;
}
