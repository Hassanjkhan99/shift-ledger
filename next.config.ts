import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Documented contract (§11.9) is `/evidence/:id/view`; the handler lives under the app/api
      // convention at `/api/evidence/:id/view`. Rewrite so clients following the contract reach it (#119).
      { source: "/evidence/:id/view", destination: "/api/evidence/:id/view" },
    ];
  },
};

export default nextConfig;
