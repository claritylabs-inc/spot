"use client";
import { useEffect, useState } from "react";
import { browserCountryHint, countryHintName } from "@/lib/country-hint";

let request: Promise<string | undefined> | undefined;

/** An editable suggestion only: no location permission, external lookup or stored IP. */
export function useCountryHint(preferred?: string) {
  const [hint, setHint] = useState<string>();
  useEffect(() => {
    let active = true;
    const fallback = browserCountryHint(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.languages);
    queueMicrotask(() => { if (active) setHint(fallback); });
    request ??= fetch("/api/intake/country-hint", { cache: "no-store" })
      .then(response => response.ok ? response.json() : undefined)
      .then((result: { country?: string } | undefined) => countryHintName(result?.country))
      .catch(() => undefined);
    void request.then(country => { if (active && country) setHint(country); });
    return () => { active = false; };
  }, []);
  return countryHintName(preferred) ?? hint ?? "";
}
