"use client";
// Property create/edit form (#133). One component serves both modes: `create` calls
// createPropertyAction, `edit` calls updatePropertyAction with the existing id. The time zone drives
// occurrence wall-clock (§9) and is validated server-side (luxon); we suggest the runtime's IANA list.
// A duplicate name (unique per org) and validation errors are surfaced inline.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createPropertyAction, updatePropertyAction } from "@/app/actions/sites";
import { listTimeZones } from "@/lib/timezones";
import { cardClass, labelClass, inputClass, buttonClass, FormError } from "@/app/(auth)/ui";

export interface PropertyInitial {
  id: string;
  name: string;
  timezone: string;
  countryCode: string;
  address: string;
}

const TIME_ZONES = listTimeZones();

export function PropertyForm({
  org,
  mode,
  initial,
  defaultTimezone,
}: {
  org: string;
  mode: "create" | "edit";
  initial?: PropertyInitial;
  /** Org default timezone, used to prefill a NEW property (#161) instead of a hard-coded zone. */
  defaultTimezone?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? defaultTimezone ?? "Europe/Berlin");
  const [countryCode, setCountryCode] = useState(initial?.countryCode ?? "DE");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const zones = TIME_ZONES;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Enter a property name.");
      return;
    }
    setPending(true);
    const payload = {
      organizationId: org,
      name: name.trim(),
      timezone,
      countryCode,
      address: address.trim() || undefined,
    };
    const result =
      mode === "create"
        ? await createPropertyAction(payload)
        : await updatePropertyAction({ ...payload, propertyId: initial!.id });

    if (result.status === "ok") {
      const id = mode === "create" ? result.id : initial!.id;
      router.push(`/${org}/settings/properties/${id ?? ""}`);
      router.refresh();
      return;
    }
    setPending(false);
    if (result.status === "conflict") {
      setError("A property with this name already exists.");
    } else if (result.status === "validation") {
      setError("Please check the highlighted fields and try again.");
    } else if (result.status === "forbidden") {
      setError("You don’t have permission to manage properties.");
    } else if (result.status === "not-found") {
      setError("This property no longer exists.");
    } else {
      setError("You need to be signed in.");
    }
  }

  return (
    <form className={cardClass} onSubmit={onSubmit} noValidate>
      <div className="space-y-4">
        <div>
          <label htmlFor="prop-name" className={labelClass}>
            Property name
          </label>
          <input
            id="prop-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            className={inputClass}
            placeholder="Main Site"
          />
        </div>
        <div>
          <label htmlFor="prop-tz" className={labelClass}>
            Time zone
          </label>
          <input
            id="prop-tz"
            type="text"
            required
            list="prop-tz-list"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
          {zones.length > 0 && (
            <datalist id="prop-tz-list">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          )}
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Sets the wall-clock for tasks scheduled at this site.
          </p>
        </div>
        <div className="flex gap-4">
          <div className="w-24">
            <label htmlFor="prop-country" className={labelClass}>
              Country
            </label>
            <input
              id="prop-country"
              type="text"
              maxLength={2}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              disabled={pending}
              className={inputClass}
              placeholder="DE"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="prop-address" className={labelClass}>
              Address <span className="text-zinc-400">(optional)</span>
            </label>
            <input
              id="prop-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
        </div>
        <FormError message={error} />
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : mode === "create" ? "Create property" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
