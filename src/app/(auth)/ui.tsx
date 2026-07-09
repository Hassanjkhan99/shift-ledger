// Shared presentational bits for the auth forms (#131). Pure styling + a stateless error banner, no
// hooks, so both the sign-in and sign-up client forms import them without duplicating Tailwind.
import type { ReactNode } from "react";

export const cardClass =
  "rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950";

export const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

export const inputClass =
  "mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export const buttonClass =
  "mt-2 flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

/** Inline, role=alert error banner. Renders nothing when message is empty. */
export function FormError({ message }: { message: string | null }): ReactNode {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
    >
      {message}
    </p>
  );
}
