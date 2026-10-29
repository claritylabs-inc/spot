import {
  coverageOption,
  type CoverageId,
  type IntakeAddress,
  type IntakeDetails,
} from "../../lib/insurance-intake-details";
import {
  submittedIntakeApplication,
  type IntakeApplication,
} from "../../lib/intake-application";
import { followupQuestionVisible } from "../../lib/intake-followups";
import { parseWorkJurisdictions } from "../../lib/intake-jurisdictions";
import {
  assertExternalBrokerIdentity,
  BROKER_COUNTRY_CODES,
  BROKER_REGION_CODES,
  brokerRegionCountry,
  brokerWritingCountries,
  brokerAreaFit,
  CANADIAN_PROVINCES,
  USPS_STATE_NAMES,
} from "./brokerProfileValidation";
import { providerCodesForCoverage } from "./coverageLobMapping";

// ---------------------------------------------------------------------------
// Request side
// ---------------------------------------------------------------------------

type RequestApplicationSource = Parameters<
  typeof submittedIntakeApplication
>[0] & {
  intakeDetails?: IntakeDetails;
};
type OrgApplicationSource = {
  intakeBusinessProfile?: { details: IntakeDetails } | null;
} | null;

/** Submitted application, then the request draft details, then the saved company profile. */
export function requestApplicationDetails(
  request: RequestApplicationSource,
  org?: OrgApplicationSource,
): IntakeDetails | null {
  const submitted: IntakeApplication | null =
    submittedIntakeApplication(request);
  return (
    submitted?.details ??
    request.intakeDetails ??
    org?.intakeBusinessProfile?.details ??
    null
  );
}

/** A normalized place: ISO2 country plus a US state / CA province code when known. */
export type OutreachPlace = { country: string; region?: string };
export type RequestGeography = {
  /** Deduplicated, ordered: locations, coverage property addresses, work jurisdictions. */
  places: OutreachPlace[];
  /** First operating location, otherwise mailing or registration region. Null when none resolves. */
  primary: OutreachPlace | null;
  /** The places came from the registration address because nothing else resolved. */
  fromRegistration: boolean;
};

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US",
  "u s": "US",
  "u s a": "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
};
function normalizedKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
const COUNTRY_BY_NAME = new Map<string, string>();
for (const code of BROKER_COUNTRY_CODES) {
  const name = countryNames.of(code);
  if (name && name !== code) COUNTRY_BY_NAME.set(normalizedKey(name), code);
}
const REGION_BY_NAME = new Map<string, string>();
for (const [code, name] of Object.entries(USPS_STATE_NAMES))
  REGION_BY_NAME.set(normalizedKey(name), code);
for (const [code, name] of Object.entries(CANADIAN_PROVINCES))
  REGION_BY_NAME.set(normalizedKey(name), code);
const REGION_CODES = new Set<string>(BROKER_REGION_CODES);
const COUNTRY_CODES = new Set<string>(BROKER_COUNTRY_CODES);

/** Country text to ISO2. "CA" is Canada here; use `normalizeRegion` for state fields. */
export function normalizeCountry(value?: string | null) {
  const text = value?.trim();
  if (!text) return undefined;
  const upper = text.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper))
    return COUNTRY_CODES.has(upper) ? upper : undefined;
  const key = normalizedKey(text);
  return COUNTRY_ALIASES[key] ?? COUNTRY_BY_NAME.get(key);
}
/** US state / CA province text to its code. "CA" is California here. */
export function normalizeRegion(value?: string | null) {
  const text = value?.trim().replace(/^(?:US|CA)-/i, "");
  if (!text) return undefined;
  const upper = text.toUpperCase();
  if (REGION_CODES.has(upper)) return upper;
  return REGION_BY_NAME.get(normalizedKey(text));
}
/**
 * One address or jurisdiction row. A region implies its country; a stated country
 * that conflicts with the region's wins, as the region is then not a US/CA one.
 */
export function normalizePlace(input: {
  country?: string | null;
  region?: string | null;
}): OutreachPlace | null {
  const country = normalizeCountry(input.country);
  const region = normalizeRegion(input.region);
  if (region) {
    const regionCountry = brokerRegionCountry(region);
    if (!country || country === regionCountry)
      return { country: regionCountry, region };
  }
  if (country) return { country };
  return null;
}
function addressPlace(address?: IntakeAddress | null) {
  return address
    ? normalizePlace({ country: address.country, region: address.state })
    : null;
}
function samePlace(a: OutreachPlace, b: OutreachPlace) {
  return a.country === b.country && a.region === b.region;
}
const WC_JURISDICTIONS_SOURCE = " · wc.terms.covered_jurisdictions";

export function requestGeography(
  details: IntakeDetails | null | undefined,
): RequestGeography {
  if (!details) return { places: [], primary: null, fromRegistration: false };
  const locations = (details.locations ?? []).flatMap((location) => {
    const place = addressPlace(location.address);
    return place ? [place] : [];
  });
  const others: OutreachPlace[] = [];
  for (const coverage of details.coverages ?? [])
    for (const property of coverage.properties ?? []) {
      const place = addressPlace(property.address);
      if (place) others.push(place);
    }
  for (const row of details.followups ?? []) {
    if (
      !row.source?.endsWith(WC_JURISDICTIONS_SOURCE) ||
      row.skipped ||
      !followupQuestionVisible(row, details.followups)
    )
      continue;
    for (const jurisdiction of parseWorkJurisdictions(row.answer)?.locations ??
      []) {
      const place = normalizePlace(jurisdiction);
      if (place) others.push(place);
    }
  }
  const mailing = addressPlace(details.mailingAddress);
  const registration =
    addressPlace(details.registrationAddress) ??
    normalizePlace({
      country: details.registrationCountry,
      region: details.registrationState,
    });
  const places: OutreachPlace[] = [];
  for (const place of [
    ...(locations.length ? locations : mailing ? [mailing] : []),
    ...others,
  ])
    if (!places.some((known) => samePlace(known, place))) places.push(place);
  const fromRegistration = !places.length && !!registration;
  if (fromRegistration && registration) places.push(registration);
  return {
    places,
    primary: locations[0] ?? mailing ?? registration ?? places[0] ?? null,
    fromRegistration,
  };
}

export type LobNeed = {
  coverage: CoverageId;
  label: string;
  /** Provider appetite codes that can write this coverage. */
  acceptedCodes: readonly string[];
};
export type RequestLobNeeds = {
  needs: LobNeed[];
  /** Requested coverages with no appetite mapping (`other`, `unknown`). */
  unevaluated: CoverageId[];
};

export function requestLobNeeds(
  details: IntakeDetails | null | undefined,
): RequestLobNeeds {
  const needs: LobNeed[] = [];
  const unevaluated: CoverageId[] = [];
  for (const { coverage } of details?.coverages ?? []) {
    if (
      needs.some((need) => need.coverage === coverage) ||
      unevaluated.includes(coverage)
    )
      continue;
    const acceptedCodes = providerCodesForCoverage(coverage);
    if (acceptedCodes)
      needs.push({
        coverage,
        label: coverageOption(coverage).label,
        acceptedCodes,
      });
    else unevaluated.push(coverage);
  }
  return { needs, unevaluated };
}

/** Every provider code that could satisfy the request, for contact line overlap. */
export function needAcceptedCodes(needs: readonly LobNeed[]) {
  return [...new Set(needs.flatMap((need) => need.acceptedCodes))];
}

export type RequestMatchBanner =
  | "geography_undeterminable"
  | "lines_undeterminable"
  | "lines_partly_unevaluated";
export type RequestMatchContext = {
  geography: RequestGeography;
  needs: RequestLobNeeds;
  banners: RequestMatchBanner[];
};

/** Everything `classifyProvider` needs, derived once per request. */
export function requestMatchContext(
  details: IntakeDetails | null | undefined,
): RequestMatchContext {
  const geography = requestGeography(details);
  const needs = requestLobNeeds(details);
  const banners: RequestMatchBanner[] = [];
  if (!geography.places.length) banners.push("geography_undeterminable");
  if (!needs.needs.length) banners.push("lines_undeterminable");
  else if (needs.unevaluated.length) banners.push("lines_partly_unevaluated");
  return { geography, needs, banners };
}

// ---------------------------------------------------------------------------
// Provider fit
// ---------------------------------------------------------------------------

export type ProviderFitProfile = {
  isTest?: boolean;
  networkStatus: "prospect" | "active" | "inactive" | "blacklisted";
  writingCountries?: string[];
  nationwideCountries?: string[];
  excludedStates?: string[];
  writingStates: string[];
  lineOfBusinessCodes: string[];
};
export type ProviderFitReason =
  | "blacklisted"
  | "test_mode"
  | "no_profile"
  | "request_not_evaluable"
  | "geography_primary_not_serviced"
  | "geography_none_serviced"
  | "geography_partial"
  | "geography_region_unknown"
  | "geography_appetite_empty"
  | "lines_none_covered"
  | "lines_partial"
  | "lines_appetite_empty";
export type DimensionFit =
  | "match"
  | "partial"
  | "excluded"
  | "unknown"
  | "skipped";
export type ProviderFit = {
  verdict: "matched" | "unknown" | "excluded";
  /** Matched in every recorded location, but only some lines are covered. */
  partial: boolean;
  reasons: ProviderFitReason[];
  geography: {
    fit: DimensionFit;
    serviced: OutreachPlace[];
    unserviced: OutreachPlace[];
  };
  lines: { fit: DimensionFit; covered: LobNeed[]; missing: LobNeed[] };
};

function placeServiced(place: OutreachPlace, profile: ProviderFitProfile) {
  return brokerAreaFit(profile, place.country, place.region) === "match";
}

export function classifyProvider(
  profile: ProviderFitProfile | null | undefined,
  geography: RequestGeography,
  { needs: needList }: Pick<RequestLobNeeds, "needs">,
  /** The client is in test mode: only test providers are eligible. */
  testMode = false,
): ProviderFit {
  const result: ProviderFit = {
    verdict: "unknown",
    partial: false,
    reasons: [],
    geography: { fit: "skipped", serviced: [], unserviced: [] },
    lines: { fit: "skipped", covered: [], missing: [] },
  };
  if (!profile) {
    result.reasons.push("no_profile");
    return result;
  }
  if (profile.networkStatus === "blacklisted") {
    result.verdict = "excluded";
    result.reasons.push(profile.networkStatus);
    return result;
  }
  if (testMode && !profile.isTest) {
    result.verdict = "excluded";
    result.reasons.push("test_mode");
    return result;
  }

  // Geography
  const countries = new Set(brokerWritingCountries(profile));
  const geographyEvaluable = geography.places.length > 0;
  const geographyAppetiteEmpty =
    !countries.size && !profile.writingStates.length;
  if (!geographyEvaluable) {
    result.geography.fit = "unknown";
    result.reasons.push("request_not_evaluable");
  } else if (geographyAppetiteEmpty) {
    result.geography.fit = "unknown";
    result.reasons.push("geography_appetite_empty");
  } else {
    for (const place of geography.places)
      (placeServiced(place, profile)
        ? result.geography.serviced
        : result.geography.unserviced
      ).push(place);
    const hasUnknownRegion = geography.places.some(
      (place) =>
        brokerAreaFit(profile, place.country, place.region) === "unknown",
    );
    const primaryExcluded = geography.primary
      ? brokerAreaFit(
          profile,
          geography.primary.country,
          geography.primary.region,
        ) === "excluded"
      : false;
    const hasExcludedPlace = geography.places.some(
      (place) =>
        brokerAreaFit(profile, place.country, place.region) === "excluded",
    );
    if (hasExcludedPlace) {
      result.geography.fit = "excluded";
      result.reasons.push(
        primaryExcluded
          ? "geography_primary_not_serviced"
          : "geography_partial",
      );
    } else if (hasUnknownRegion) {
      result.geography.fit = "unknown";
      result.reasons.push("geography_region_unknown");
    } else result.geography.fit = "match";
  }

  // Lines
  if (needList.length && !profile.lineOfBusinessCodes.length) {
    result.lines.fit = "unknown";
    result.reasons.push("lines_appetite_empty");
  } else if (needList.length) {
    const appetite = new Set(profile.lineOfBusinessCodes);
    for (const need of needList)
      (need.acceptedCodes.some((code) => appetite.has(code))
        ? result.lines.covered
        : result.lines.missing
      ).push(need);
    if (!result.lines.covered.length) {
      result.lines.fit = "excluded";
      result.reasons.push("lines_none_covered");
    } else if (result.lines.missing.length) {
      result.lines.fit = "partial";
      result.reasons.push("lines_partial");
    } else result.lines.fit = "match";
  }

  const dimensions = [result.geography.fit, result.lines.fit];
  if (dimensions.includes("excluded")) result.verdict = "excluded";
  else if (dimensions.includes("unknown")) result.verdict = "unknown";
  else if (dimensions.every((fit) => fit === "skipped")) {
    // Nothing about the request could be compared, so no provider is a known fit.
    result.verdict = "unknown";
    result.reasons.push("request_not_evaluable");
  } else {
    result.verdict = "matched";
    result.partial = dimensions.includes("partial");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Recipient
// ---------------------------------------------------------------------------

export type OutreachContact = {
  _id?: string;
  name: string;
  role:
    | "general"
    | "submissions"
    | "underwriting"
    | "claims"
    | "billing"
    | "other";
  email?: string;
  lineOfBusinessCodes: readonly string[];
  primary?: boolean;
  deletedAt?: number;
};
export type OutreachRecipient = {
  contactId?: string;
  email: string;
  name?: string;
  source: "outreach" | "contact";
  role?: OutreachContact["role"];
};
export type RecipientSelection =
  | { ok: true; recipient: OutreachRecipient }
  | { ok: false; reason: "no_contact_email" | "spot_owned_contact" };

const ROLE_RANK: Record<OutreachContact["role"], number> = {
  submissions: 0,
  general: 1,
  underwriting: 2,
  other: 3,
  claims: 4,
  billing: 4,
};
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function usableEmail(value?: string | null) {
  const email = value
    ?.trim()
    .toLowerCase()
    .replace(/^mailto:/, "");
  return email && EMAIL_PATTERN.test(email) ? email : undefined;
}

/**
 * Picks the outreach recipient: an explicit outreach email, then the primary
 * broker contact, then contacts by role and line overlap. Spot-owned identities are never eligible.
 */
export function selectRecipient(
  contacts: readonly OutreachContact[],
  needCodes: readonly string[],
  outreach?: {
    contactEmail?: string | null;
    contactName?: string | null;
  } | null,
  broker?: {
    name?: string | null;
    website?: string | null;
    slug?: string | null;
  } | null,
): RecipientSelection {
  const live = contacts.filter((contact) => !contact.deletedAt);
  let spotOwned = false;
  const external = (email: string, name?: string | null) => {
    try {
      assertExternalBrokerIdentity({ ...broker, email, name });
      return true;
    } catch {
      spotOwned = true;
      return false;
    }
  };

  const explicit = usableEmail(outreach?.contactEmail);
  if (outreach?.contactEmail?.trim()) {
    if (!explicit) return { ok: false, reason: "no_contact_email" };
    if (!external(explicit, outreach.contactName))
      return { ok: false, reason: "spot_owned_contact" };

    const known = live.find(
      (contact) => usableEmail(contact.email) === explicit,
    );
    return {
      ok: true,
      recipient: {
        ...(known?._id ? { contactId: known._id } : {}),
        email: explicit,
        name: outreach?.contactName?.trim() || known?.name || undefined,
        source: "outreach",
        ...(known ? { role: known.role } : {}),
      },
    };
  }

  const wanted = new Set(needCodes);
  const overlap = (contact: OutreachContact) =>
    !contact.lineOfBusinessCodes.length
      ? 1
      : contact.lineOfBusinessCodes.some((code) => wanted.has(code))
        ? 0
        : 2;
  const candidates = live
    .flatMap((contact, index) => {
      const email = usableEmail(contact.email);
      return email ? [{ contact, email, index }] : [];
    })
    .sort(
      (a, b) =>
        Number(!a.contact.primary) - Number(!b.contact.primary) ||
        ROLE_RANK[a.contact.role] - ROLE_RANK[b.contact.role] ||
        overlap(a.contact) - overlap(b.contact) ||
        a.index - b.index,
    );
  for (const { contact, email } of candidates)
    if (external(email, contact.name))
      return {
        ok: true,
        recipient: {
          ...(contact._id ? { contactId: contact._id } : {}),
          email,
          name: contact.name,
          source: "contact",
          role: contact.role,
        },
      };
  return {
    ok: false,
    reason: spotOwned ? "spot_owned_contact" : "no_contact_email",
  };
}
