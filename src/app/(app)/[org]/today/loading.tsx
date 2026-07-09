// Today loading skeleton (M4 #16, §12.6) — outlet-grouped skeleton rows matching the final list layout
// so there is no layout shift (CLS) when the streamed content replaces it.
export default function TodayLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 h-7 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      {[0, 1].map((group) => (
        <section key={group} className="mb-6">
          <div className="mb-2 h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <ul className="space-y-2">
            {[0, 1, 2].map((row) => (
              <li
                key={row}
                className="h-14 animate-pulse rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
