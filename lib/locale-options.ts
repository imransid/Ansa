// The menus of the setup's hours and orders forms (step 45): every time zone
// and currency this server knows, built on the server and passed to the
// browser as they are (the browser's own lists may differ by a few, and the
// page must look the same before and after it loads).

// Every time zone ("Europe/Rome"), plus the saved one if this server's list
// lacks it (a zone renamed since it was saved).
export function timeZoneOptions(saved: string | null): string[] {
  const zones = [...Intl.supportedValuesOf("timeZone")];
  if (saved && !zones.includes(saved)) {
    zones.push(saved);
  }
  return zones.sort();
}

// Every currency, named in English: { code: "EUR", label: "Euro (EUR)" }.
export function currencyOptions(): { code: string; label: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "currency" });
  return Intl.supportedValuesOf("currency")
    .map((code) => ({ code, label: `${names.of(code) ?? code} (${code})` }))
    .sort((first, second) => first.label.localeCompare(second.label));
}
