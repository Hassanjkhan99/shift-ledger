"use client";
// Sign-out control (#131). Client action: authClient.signOut() clears the cookie session, then a hard
// navigation to /sign-in so the now-session-less RSC tree is re-fetched (a soft router push could serve
// a cached authenticated view). Rendered in the org nav.
import { useState } from "react";
import { signOut } from "@/lib/auth-client";

export function SignOutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await signOut();
    } finally {
      // Redirect regardless: a failed sign-out still lands the user on the sign-in surface.
      window.location.assign("/sign-in");
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={pending} className={className}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
