"use client";
// Today error boundary (M4 #16, §12.6) — a recoverable section error with a retry that re-renders the
// segment. Framing stays honest: an operational-proof tool, no compliance-certification claims.
export default function TodayError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950">
        <p className="mb-3 text-sm text-red-800 dark:text-red-200">
          Couldn&apos;t load today&apos;s tasks.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
