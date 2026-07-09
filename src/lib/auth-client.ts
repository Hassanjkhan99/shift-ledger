// Better Auth browser client (#131). The sign-in/sign-up/sign-out UI talks to /api/auth/* through this
// client — no bespoke fetch. baseURL is intentionally omitted: createAuthClient defaults to the current
// window origin, which is correct for the monolith (auth is mounted same-origin at /api/auth). This also
// sidesteps the server INVALID_ORIGIN check, since the browser and BETTER_AUTH_URL share one origin in
// every environment. The cookie session set here is the source of truth for RSC navigation; the bearer
// plugin (auth.ts) stays for API/test clients.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
