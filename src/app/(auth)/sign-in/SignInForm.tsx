"use client";
// Sign-in form (#131). Talks to Better Auth via authClient.signIn.email (no bespoke fetch). Inline
// validation + loading state; errors are surfaced as a single generic message so bad credentials never
// leak whether an email exists (no user-enumeration, no stack, no PII). On success, a hard navigation to
// returnTo so the freshly-set cookie session is read by the destination RSC.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";
import { cardClass, labelClass, inputClass, buttonClass, FormError } from "../ui";

export function SignInForm({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    const { error: authError } = await signIn.email({ email: email.trim(), password });
    if (authError) {
      setPending(false);
      setError("Incorrect email or password.");
      return;
    }
    // Hard nav: the destination RSC must see the just-set cookie session.
    window.location.assign(returnTo);
  }

  return (
    <form className={cardClass} onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>
        <FormError message={error} />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </div>
      <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No account?{" "}
        <Link
          href={`/sign-up?returnTo=${encodeURIComponent(returnTo)}`}
          className="font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
