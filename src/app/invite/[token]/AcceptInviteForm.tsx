"use client";
// Accept-invite action button (#134). Calls acceptInvitationAction with the org (from the link) + token;
// on success hard-navigates into the org's Today so the destination RSC sees the fresh membership.
import { useState } from "react";
import { acceptInvitationAction } from "@/app/actions/members";
import { cardClass, buttonClass, FormError } from "@/app/(auth)/ui";

export function AcceptInviteForm({ token, org }: { token: string; org: string | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    org ? null : "This invite link is missing its organization.",
  );

  async function onAccept() {
    if (!org) return;
    setError(null);
    setPending(true);
    const result = await acceptInvitationAction({ organizationId: org, token });
    if (result.status === "ok") {
      window.location.assign(`/${org}/today`);
      return;
    }
    setPending(false);
    if (result.status === "expired") setError("This invitation has expired. Ask for a new one.");
    else if (result.status === "invalid")
      setError("This invitation is no longer valid (it may have been revoked or already used).");
    else if (result.status === "unauthorized") setError("Please sign in to accept.");
    else setError("Could not accept the invitation. Please try again.");
  }

  return (
    <div className={cardClass}>
      <button type="button" onClick={onAccept} disabled={pending || !org} className={buttonClass}>
        {pending ? "Joining…" : "Accept invitation"}
      </button>
      <div className="mt-3">
        <FormError message={error} />
      </div>
    </div>
  );
}
