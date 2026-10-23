import { ConvexError } from "convex/values";
import { COVERAGE_OPTIONS } from "../../lib/insurance-intake-details";
import type { IntakeApplication } from "../../lib/intake-application";
import type { IntakeAddress } from "../../lib/insurance-intake-details";
import {
  brokerRegionCountry,
  brokerAreaFit,
  CANADIAN_PROVINCES,
  USPS_STATE_NAMES,
} from "./brokerProfileValidation";
import { normalizeCountry, normalizeRegion } from "./providerOutreachMatch";

import { COVERAGE_PROVIDER_LOB_CODES as coverageCodes } from "./coverageLobMapping";
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export function procurementBrokerCriteria(
  application: IntakeApplication | null,
) {
  if (!application)
    throw new ConvexError(
      "Save the request application before auto adding providers.",
    );
  const lines = application.details.coverages;
  const codes = [
    ...new Set(lines.flatMap((line) => coverageCodes[line.coverage] ?? [])),
  ];
  if (!codes.length)
    throw new ConvexError(
      "Choose a supported coverage type in the request application before auto adding providers.",
    );
  const addresses = [
    ...(application.details.locations.length
      ? application.details.locations.map((location) => location.address)
      : [application.details.mailingAddress]),
    ...lines.flatMap((line) =>
      (line.properties ?? []).map((property) => property.address),
    ),
  ];
  const areas = addresses.map(requestArea);
  return {
    codes,
    coverageLabels: [
      ...new Set(
        lines.map(
          (line) =>
            COVERAGE_OPTIONS.find((option) => option.id === line.coverage)
              ?.label ?? line.coverage,
        ),
      ),
    ],
    areas: [
      ...new Map(
        areas.map((area) => [`${area.country}:${area.state ?? ""}`, area]),
      ).values(),
    ],
    unmappedCoverages: lines
      .filter((line) => !coverageCodes[line.coverage])
      .map((line) => line.coverage),
  };
}

function requestArea(address: IntakeAddress) {
  const country = normalizeCountry(address.country);
  if (!country)
    throw new ConvexError(
      "Set a country for every operating and property location in the request application before auto adding providers.",
    );
  if (country !== "US" && country !== "CA") return { country };
  const normalizedRegion = normalizeRegion(address.state);
  const state =
    normalizedRegion && brokerRegionCountry(normalizedRegion) === country
      ? normalizedRegion
      : undefined;
  if (!state)
    throw new ConvexError(
      "Set a valid state or province for every US or Canadian operating and property location before auto adding providers.",
    );
  return { country, state };
}

type ProviderAppetite = {
  writingCountries?: string[];
  writingStates: string[];
  nationwideCountries?: string[];
  excludedStates?: string[];
  lineOfBusinessCodes: string[];
};

export function procurementBrokerMatch(
  profile: ProviderAppetite,
  criteria: ReturnType<typeof procurementBrokerCriteria>,
) {
  const matchingCodes = profile.lineOfBusinessCodes.filter((code) =>
    criteria.codes.includes(code),
  );
  if (profile.lineOfBusinessCodes.length && !matchingCodes.length)
    return {
      status: "coverage_mismatch" as const,
      matchingCodes,
      reason: "Requested coverage not in recorded appetite",
    };
  let unverifiedArea = false;
  for (const area of criteria.areas) {
    const fit = brokerAreaFit(profile, area.country, area.state);
    if (fit === "excluded")
      return {
        status: "outside_area" as const,
        matchingCodes,
        reason: "Outside recorded service area or explicitly excluded",
      };
    if (fit === "unknown") unverifiedArea = true;
  }
  const missing = [
    !profile.lineOfBusinessCodes.length ? "Coverage not recorded" : "",
    unverifiedArea ? "Service area not verified for this request" : "",
  ].filter(Boolean);
  return {
    status: missing.length
      ? ("needs_verification" as const)
      : ("confirmed" as const),
    matchingCodes,
    reason: missing.join("; "),
  };
}

export function matchesProcurementBroker(
  profile: ProviderAppetite,
  criteria: ReturnType<typeof procurementBrokerCriteria>,
) {
  return procurementBrokerMatch(profile, criteria).status === "confirmed";
}

export function procurementMatchAreaLabels(
  criteria: ReturnType<typeof procurementBrokerCriteria>,
) {
  return criteria.areas.map((area) =>
    [
      area.state
        ? (USPS_STATE_NAMES[area.state] ??
          CANADIAN_PROVINCES[area.state as keyof typeof CANADIAN_PROVINCES])
        : "",
      countryNames.of(area.country) ?? area.country,
    ]
      .filter(Boolean)
      .join(", "),
  );
}
