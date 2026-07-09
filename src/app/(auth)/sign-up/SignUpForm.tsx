"use client";
// Sign-up form (#131). Talks to Better Auth via authClient.signUp.email. Inline validation (email +
// min-8 password) before the round-trip; a duplicate email is surfaced explicitly, anything else as a
// generic message (no stack, no PII). On success the user is left authenticated (Better Auth sets the
// cookie session) and hard-navigated to returnTo. A brand-new user has no domain membership yet — that
// linkage is onboarding/invite (separate issues); this only establishes the session.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { signUp } from "@/lib/auth-client";
import { cardClass, labelClass, inputClass, buttonClass, FormError } from "../ui";

const MIN_PASSWORD = 8;

export function SignUpForm({ returnTo }: { returnTo: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setPending(true);
    const { error: authError } = await signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
    });
    if (authError) {
      setPending(false);
      setError(
        authError.code === "USER_ALREADY_EXISTS"
          ? "An account with this email already exists."
          : "Could not create your account. Please try again.",
      );
      return;
    }
    // Hard nav: the destination RSC must see the just-set cookie session.
    window.location.assign(returnTo);
  }

  return (
    <form className={cardClass} onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="name" className={labelClass}>
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
        </div>
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
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            At least {MIN_PASSWORD} characters.
          </p>
        </div>
        <FormError message={error} />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </div>
      <p className="mt-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Already have an account?{" "}
        <Link
          href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
          className="font-medium text-zinc-900 underline dark:text-zinc-100"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
