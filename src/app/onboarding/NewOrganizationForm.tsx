"use client";
// Create-organization form (#133). A signed-in user with no org fills this to bootstrap their tenant and
// become its Owner (createOrganizationAction). Slug is auto-suggested from the name until the user edits
// it; the time zone drives occurrence wall-clock (§9), so it is validated server-side (luxon) and we
// offer the runtime's IANA zone list as suggestions. On success we hard-nav into the new org's Today so
// the destination RSC sees the fresh membership.
import { useState, type FormEvent } from "react";
import { createOrganizationAction } from "@/app/actions/organizations";
import { listTimeZones } from "@/lib/timezones";
import { cardClass, labelClass, inputClass, buttonClass, FormError } from "@/app/(auth)/ui";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

const TIME_ZONES = listTimeZones();

export function NewOrganizationForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [timezone, setTimezone] = useState("Europe/Berlin");
  const [locale, setLocale] = useState("de");
  const [country, setCountry] = useState("DE");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const zones = TIME_ZONES;

  const effectiveSlug = slugEdited ? slug : slugify(name);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Enter an organization name.");
      return;
    }
    setPending(true);
    const result = await createOrganizationAction({
      name: name.trim(),
      slug: effectiveSlug,
      defaultTimezone: timezone,
      defaultLocale: locale.trim(),
      // country isn't stored on the org itself (it lives on each property); collected here as a hint for
      // the first property the user creates next. Kept in local state only.
    });
    if (result.status === "ok") {
      window.location.assign(`/${result.organizationId}/today`);
      return;
    }
    setPending(false);
    if (result.status === "conflict") {
      setError("That URL slug is already taken. Try another.");
    } else if (result.status === "validation") {
      setError("Please check the highlighted fields and try again.");
    } else {
      setError("You need to be signed in to create an organization.");
    }
  }

  return (
    <form className={cardClass} onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="org-name" className={labelClass}>
            Organization name
          </label>
          <input
            id="org-name"
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            className={inputClass}
            placeholder="Acme Hotel Group"
          />
        </div>
        <div>
          <label htmlFor="org-slug" className={labelClass}>
            URL slug
          </label>
          <input
            id="org-slug"
            name="slug"
            type="text"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(slugify(e.target.value));
            }}
            disabled={pending}
            className={inputClass}
            placeholder="acme-hotel-group"
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Lowercase letters, numbers and hyphens. Must be unique.
          </p>
        </div>
        <div>
          <label htmlFor="org-timezone" className={labelClass}>
            Default time zone
          </label>
          <input
            id="org-timezone"
            name="timezone"
            type="text"
            required
            list="tz-list"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
          {zones.length > 0 && (
            <datalist id="tz-list">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          )}
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="org-locale" className={labelClass}>
              Default locale
            </label>
            <input
              id="org-locale"
              name="locale"
              type="text"
              required
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              disabled={pending}
              className={inputClass}
              placeholder="de"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="org-country" className={labelClass}>
              Country
            </label>
            <input
              id="org-country"
              name="country"
              type="text"
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              disabled={pending}
              className={inputClass}
              placeholder="DE"
            />
          </div>
        </div>
        <FormError message={error} />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Creating…" : "Create organization"}
        </button>
      </div>
    </form>
  );
}
