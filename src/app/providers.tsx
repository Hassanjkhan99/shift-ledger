"use client";
// Client providers (M4 #16) — the TanStack Query v5 client the Today islands read through (D10). One
// QueryClient per browser session (useState so it survives re-render); RSC-seeded data arrives via each
// page's HydrationBoundary and merges into this client, so client islands find a cache hit on mount.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // Freshness comes from polling + post-write invalidation (D10), not time-based ISR.
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
