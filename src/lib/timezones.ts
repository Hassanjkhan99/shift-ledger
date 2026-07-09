// The runtime's IANA time-zone list, for datalist suggestions in the site forms (#133). Intl
// .supportedValuesOf is available in modern browsers and Node 18+; we degrade to an empty list (a
// plain free-text input) where it is missing. Server-side validation (luxon) is the real gate — this
// is only a UX affordance.
export function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    return intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}
