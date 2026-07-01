// Next.js instrumentation hook. Initializes Sentry on the server only when a DSN is
// configured, so local/dev and DSN-less environments are a no-op. Full Sentry wiring
// (client SDK, source maps via withSentryConfig) is tracked in SECURITY.md for later.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV,
    });
  }
}
