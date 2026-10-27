import {
  ACORD_LOB_CODES,
  ProviderAcordLobCodeSchema,
  PROVIDER_ACORD_LOB_CODES,
  lobLabel,
  type AcordLobCode,
} from "./linesOfBusiness";
import { getCountries } from "libphonenumber-js";
import { NoWriteInputError } from "./noWriteInputError";

const SPOT_OWNED_DOMAINS = [
  "spot.insure",
  "claritylabs.inc",
  "toolsforenlightenment.org",
  "glass.insure",
];

function normalizedBrandName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SPOT_OWNED_NAMES = new Set(
  ["Spot", "Clarity Labs", "Tools for Enlightenment"].map(normalizedBrandName),
);

// Classification only. Never use this allowlist to authorize a user or mailbox.
export function isSpotOwnedDomain(value?: string | null) {
  if (!value?.trim()) return false;
  const input = value.trim().replace(/^mailto:/i, "");
  try {
    const url = new URL(
      input.startsWith("//")
        ? `https:${input}`
        : /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
          ? input
          : `https://${input}`,
    );
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return SPOT_OWNED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

type BrokerIdentity = {
  name?: string | null;
  website?: string | null;
  slug?: string | null;
  email?: string | null;
};

export function isSpotOwnedBrokerIdentity(identity: BrokerIdentity) {
  return (
    isSpotOwnedDomain(identity.website) ||
    isSpotOwnedDomain(identity.email) ||
    [identity.name, identity.slug].some(
      (name) =>
        !!name &&
        (SPOT_OWNED_NAMES.has(normalizedBrandName(name)) ||
          isSpotOwnedDomain(name)),
    )
  );
}

export function assertExternalBrokerIdentity(identity: BrokerIdentity) {
  if (isSpotOwnedBrokerIdentity(identity)) {
    throw new NoWriteInputError(
      "spot_owned_broker_identity",
      "This is a Spot-owned brand or domain. Treat it as Spot; it cannot be registered or used as an external provider.",
    );
  }
}

export const USPS_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
] as const;

export const USPS_STATE_NAMES: Readonly<Record<string, string>> =
  Object.fromEntries(
    USPS_STATE_CODES.map((code, index) => [
      code,
      [
        "Alabama",
        "Alaska",
        "Arizona",
        "Arkansas",
        "California",
        "Colorado",
        "Connecticut",
        "Delaware",
        "Florida",
        "Georgia",
        "Hawaii",
        "Idaho",
        "Illinois",
        "Indiana",
        "Iowa",
        "Kansas",
        "Kentucky",
        "Louisiana",
        "Maine",
        "Maryland",
        "Massachusetts",
        "Michigan",
        "Minnesota",
        "Mississippi",
        "Missouri",
        "Montana",
        "Nebraska",
        "Nevada",
        "New Hampshire",
        "New Jersey",
        "New Mexico",
        "New York",
        "North Carolina",
        "North Dakota",
        "Ohio",
        "Oklahoma",
        "Oregon",
        "Pennsylvania",
        "Rhode Island",
        "South Carolina",
        "South Dakota",
        "Tennessee",
        "Texas",
        "Utah",
        "Vermont",
        "Virginia",
        "Washington",
        "West Virginia",
        "Wisconsin",
        "Wyoming",
        "District of Columbia",
      ][index],
    ]),
  );
export const CANADIAN_PROVINCES = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NT: "Northwest Territories",
  NS: "Nova Scotia",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
} as const;
export const BROKER_REGION_CODES = [
  ...USPS_STATE_CODES,
  ...Object.keys(CANADIAN_PROVINCES),
] as [string, ...string[]];
export const BROKER_COUNTRY_CODES = getCountries();
const countryCodes = new Set<string>(BROKER_COUNTRY_CODES);
const regionCodes = new Set<string>(BROKER_REGION_CODES);

export function brokerRegionCountry(code: string) {
  return Object.hasOwn(CANADIAN_PROVINCES, code) ? "CA" : "US";
}

export function brokerWritingCountries(
  profile?: { writingCountries?: string[]; writingStates: string[] } | null,
) {
  return (
    profile?.writingCountries ??
    [...new Set((profile?.writingStates ?? []).map(brokerRegionCountry))].sort()
  );
}

function closestCodes(value: string, codes: readonly string[]) {
  const query = value.slice(0, 64);
  const distance = (candidate: string) => {
    const target = candidate.toUpperCase();
    let previous = Array.from({ length: target.length + 1 }, (_, index) => index);
    for (let i = 0; i < query.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < target.length; j++) {
        next.push(
          Math.min(
            next[j] + 1,
            previous[j + 1] + 1,
            previous[j] + (query[i] === target[j] ? 0 : 1),
          ),
        );
      }
      previous = next;
    }
    return previous[target.length];
  };
  return [...codes]
    .sort((a, b) => distance(a) - distance(b) || a.localeCompare(b))
    .slice(0, 3);
}

export function normalizeBrokerWritingCountries(values: readonly string[]) {
  const countries = [
    ...new Set(
      values.map((value) => value.trim().toUpperCase()).filter(Boolean),
    ),
  ].sort();
  const invalid = countries.find((code) => !countryCodes.has(code));
  if (invalid)
    throw new NoWriteInputError(
      "invalid_writing_country",
      `Invalid writing country ${invalid}. Use ISO two-letter codes. Closest allowed values: ${closestCodes(invalid, BROKER_COUNTRY_CODES).join(", ")}.`,
    );
  return countries;
}

// Country changes remove regions outside the selected countries. Region-only
// edits add their countries, preserving compatibility with existing callers.
export function resolveBrokerAppetite(
  args: {
    writingCountries?: string[];
    writingStates?: string[];
    nationwideCountries?: string[];
    excludedStates?: string[];
  },
  existing?: {
    writingCountries?: string[];
    writingStates: string[];
    nationwideCountries?: string[];
    excludedStates?: string[];
  } | null,
) {
  let writingStates = normalizeBrokerWritingStates(
    args.writingStates ?? existing?.writingStates ?? [],
  );
  const writingCountries =
    args.writingCountries === undefined
      ? [
          ...new Set([
            ...brokerWritingCountries(existing),
            ...writingStates.map(brokerRegionCountry),
            ...normalizeBrokerWritingCountries(
              args.nationwideCountries ?? existing?.nationwideCountries ?? [],
            ),
          ]),
        ].sort()
      : normalizeBrokerWritingCountries(args.writingCountries);
  if (args.writingCountries !== undefined) {
    if (
      args.writingStates !== undefined &&
      writingStates.some(
        (code) => !writingCountries.includes(brokerRegionCountry(code)),
      )
    )
      throw new NoWriteInputError(
        "invalid_writing_region_country",
        "Select the country for every serviced state or province.",
      );
    writingStates = writingStates.filter((code) =>
      writingCountries.includes(brokerRegionCountry(code)),
    );
  }
  const nationwideCountries = normalizeBrokerWritingCountries(
    args.nationwideCountries ?? existing?.nationwideCountries ?? [],
  ).filter((code) => writingCountries.includes(code));
  if (
    args.nationwideCountries?.some(
      (code) => !writingCountries.includes(code.trim().toUpperCase()),
    )
  )
    throw new NoWriteInputError(
      "invalid_nationwide_country",
      "Select each country before marking it nationwide.",
    );
  const excludedStates = normalizeBrokerWritingStates(
    args.excludedStates ?? existing?.excludedStates ?? [],
  ).filter((code) => nationwideCountries.includes(brokerRegionCountry(code)));
  if (
    args.excludedStates?.some(
      (code) =>
        !nationwideCountries.includes(
          brokerRegionCountry(code.trim().toUpperCase()),
        ),
    )
  )
    throw new NoWriteInputError(
      "invalid_excluded_region",
      "State/province exclusions require nationwide service in that country.",
    );
  writingStates = writingStates.filter(
    (code) => !excludedStates.includes(code),
  );
  return {
    writingCountries,
    writingStates,
    nationwideCountries,
    excludedStates,
  };
}

export function normalizeBrokerWritingStates(values: readonly string[]) {
  const states = Array.from(
    new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)),
  );
  const invalid = states.filter((state) => !regionCodes.has(state));
  if (invalid.length > 0) {
    throw new NoWriteInputError(
      "invalid_writing_state",
      `Invalid writing state ${invalid.join(", ")}. Use two-letter US/Canadian codes. Closest allowed values: ${closestCodes(invalid[0], BROKER_REGION_CODES).join(", ")}.`,
    );
  }
  return states.sort();
}

export function normalizeBrokerLineOfBusinessCodes(
  values: readonly string[],
): AcordLobCode[] {
  const lines = Array.from(
    new Set(
      values
        .map((value) => {
          const normalized = value.trim().toUpperCase();
          return (
            ACORD_LOB_CODES.find((code) => code.toUpperCase() === normalized) ??
            normalized
          );
        })
        .filter(Boolean),
    ),
  );
  const invalid = lines.filter(
    (line) => !ProviderAcordLobCodeSchema.safeParse(line).success,
  );
  if (invalid.length > 0) {
    throw new NoWriteInputError(
      "invalid_acord_lob",
      `Invalid ACORD LOBCd ${invalid.join(", ")}. Closest allowed values: ${closestCodes(invalid[0], PROVIDER_ACORD_LOB_CODES).map((code) => `${code} (${lobLabel(code)})`).join(", ")}. Use exact coverage-line codes; leave the list empty when unknown. Common commercial codes: CGL, PROP, AUTOB.`,
    );
  }
  return lines.sort() as AcordLobCode[];
}

/** Positive regional evidence and explicit nationwide scope share one meaning on every surface. */
export function brokerAreaFit(
  profile: {
    writingCountries?: string[];
    writingStates: string[];
    nationwideCountries?: string[];
    excludedStates?: string[];
  },
  country: string,
  region?: string,
): "match" | "unknown" | "excluded" {
  if (region && profile.excludedStates?.includes(region)) return "excluded";
  const countries = brokerWritingCountries(profile);
  if (!countries.length) return "unknown";
  if (!countries.includes(country)) return "excluded";
  // A missing region cannot bypass country-wide exceptions.
  if ((country === "US" || country === "CA") && !region) return "unknown";
  if (profile.nationwideCountries?.includes(country)) return "match";
  if (!region || profile.writingStates.includes(region)) return "match";
  return profile.writingStates.some(
    (code) => brokerRegionCountry(code) === country,
  )
    ? "excluded"
    : "unknown";
}
