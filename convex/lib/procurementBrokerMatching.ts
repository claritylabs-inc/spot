import { ConvexError } from "convex/values";
import type { IntakeApplication } from "../../lib/intake-application";
import type {
  CoverageId,
  IntakeAddress,
} from "../../lib/insurance-intake-details";
import {
  brokerRegionCountry,
  brokerWritingCountries,
} from "./brokerProfileValidation";
import { normalizeCountry, normalizeRegion } from "./providerOutreachMatch";

// Alternatives identify the requested class, not every product in a package.
// BOP alone does not establish either component's standalone availability.
const coverageCodes: Partial<Record<CoverageId, readonly string[]>> = {
  general_liability: ["CGL", "BOPGL"],
  property: ["PROP", "BOPPR"],
  workers_compensation: ["WORK", "WORKP"],
  commercial_auto: ["AUTOB"],
  professional_liability: ["EO", "PL", "PLMSC"],
  cyber: ["CYBER"],
  umbrella: ["UMBRC", "UMBRL"],
};

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
  const state = normalizedRegion && brokerRegionCountry(normalizedRegion) === country
    ? normalizedRegion
    : undefined;
  if (!state)
    throw new ConvexError(
      "Set a valid state or province for every US or Canadian operating and property location before auto adding providers.",
    );
  return { country, state };
}

export function matchesProcurementBroker(
  profile: {
    writingCountries?: string[];
    writingStates: string[];
    lineOfBusinessCodes: string[];
  },
  criteria: ReturnType<typeof procurementBrokerCriteria>,
) {
  return (
    profile.lineOfBusinessCodes.some((code) => criteria.codes.includes(code)) &&
    criteria.areas.every(
      (area) =>
        brokerWritingCountries(profile).includes(area.country) &&
        (!area.state ||
          profile.writingStates.some(
            (state) =>
              state === area.state &&
              brokerRegionCountry(state) === area.country,
          )),
    )
  );
}
