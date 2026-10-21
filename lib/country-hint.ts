import { getCountries } from "react-phone-number-input/input";

const codes = getCountries();
const names = new Intl.DisplayNames(["en"], { type: "region" });

export function countryHintName(value?: string | null) {
  const code = codes.find(code => code === value?.toUpperCase() || names.of(code) === value);
  return code ? names.of(code) : undefined;
}

/** Only unambiguous, named zones are country hints; never infer a state. */
const zoneCountries: Record<string, string> = {
  "America/Toronto": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA",
  "America/Winnipeg": "CA", "America/Halifax": "CA", "America/St_Johns": "CA",
  "America/Regina": "CA", "America/Moncton": "CA", "America/Whitehorse": "CA",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US",
  "America/Los_Angeles": "US", "America/Phoenix": "US", "America/Anchorage": "US",
  "Pacific/Honolulu": "US", "Europe/London": "GB", "Europe/Dublin": "IE",
  "Europe/Paris": "FR", "Europe/Berlin": "DE", "Asia/Kolkata": "IN",
  "Asia/Tokyo": "JP", "Asia/Singapore": "SG", "Pacific/Auckland": "NZ",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Perth": "AU",
};

export function browserCountryHint(timeZone: string, languages: readonly string[]) {
  const zone = countryHintName(zoneCountries[timeZone]);
  if (zone) return zone;
  for (const language of languages) {
    try {
      const country = countryHintName(new Intl.Locale(language).region);
      if (country) return country;
    } catch { /* Ignore nonstandard browser locale strings. */ }
  }
}
