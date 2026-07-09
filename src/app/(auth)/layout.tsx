// (auth) route group (#131). No [org] segment and no tenant context — these screens render PRE-session,
// so they deliberately do NOT mount <Providers> or resolve a member. Just a centered frame for the
// sign-in / sign-up cards.
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Shift Ledger
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Daily operational-proof for kitchen food safety
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
