// Structured logging (pino). Base logger with no transport so it is safe in every
// Next.js runtime (node/edge) and in scripts. For pretty local output, pipe through
// pino-pretty (installed): e.g. `npm run db | npx pino-pretty`.
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  // Never log secrets. Redact common sensitive paths defensively.
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "authorization",
      "*.authorization",
      "DATABASE_URL",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;
