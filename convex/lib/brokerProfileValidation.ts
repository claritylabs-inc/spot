import {
  ACORD_LOB_CODES,
  isLobCode,
  type AcordLobCode,
} from "./linesOfBusiness";
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
  [
    "Spot",
    "Clarity Labs",
    "Tools for Enlightenment",
  ].map(normalizedBrandName),
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
      "This is a Spot-owned brand or domain. Treat it as Spot; it cannot be registered or used as an external broker.",
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
const USPS_STATES = new Set<string>(USPS_STATE_CODES);

export function normalizeBrokerWritingStates(values: readonly string[]) {
  const states = Array.from(
    new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)),
  );
  const invalid = states.filter((state) => !USPS_STATES.has(state));
  if (invalid.length > 0) {
    throw new NoWriteInputError(
      "invalid_writing_state",
      `Invalid writing state ${invalid.join(", ")}. Use exact two-letter USPS state codes.`,
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
  const invalid = lines.filter((line) => !isLobCode(line));
  if (invalid.length > 0) {
    throw new NoWriteInputError(
      "invalid_acord_lob",
      `Invalid ACORD LOBCd ${invalid.join(", ")}. Use exact catalog codes; common commercial codes include CGL (General Liability), PROP (Commercial Property), and AUTOB (Business Automobile).`,
    );
  }
  return lines.sort() as AcordLobCode[];
}
