import dayjs from "dayjs";
import type { IntakeAnswers } from "./insurance-intake";
export const UNKNOWN_ANSWER = "I'm not sure";
export const COVERAGE_OPTIONS = [
  { id: "unknown", label: UNKNOWN_ANSWER, limits: [] },
  {
    id: "general_liability",
    label: "General liability",
    limits: [
      { key: "each_occurrence", label: "Each occurrence limit" },
      { key: "aggregate", label: "General aggregate limit" },
    ],
  },
  {
    id: "property",
    label: "Property",
    limits: [
      { key: "building", label: "Building limit" },
      { key: "contents", label: "Business personal property limit" },
      { key: "business_income", label: "Business income limit" },
    ],
  },
  {
    id: "workers_compensation",
    label: "Workers’ compensation",
    limits: [
      { key: "statutory", label: "Workers’ compensation statutory coverage" },
      { key: "each_accident", label: "Employers’ liability — each accident" },
      {
        key: "disease_policy",
        label: "Employers’ liability — disease policy limit",
      },
      {
        key: "disease_employee",
        label: "Employers’ liability — disease, each employee",
      },
    ],
  },
  {
    id: "commercial_auto",
    label: "Commercial auto",
    limits: [
      {
        key: "combined_single",
        label: "Combined single limit (each accident)",
      },
      {
        key: "physical_damage",
        label: "Physical damage coverage / vehicle values",
      },
    ],
  },
  {
    id: "professional_liability",
    label: "Professional liability / E&O",
    limits: [
      { key: "each_claim", label: "Per claim limit" },
      { key: "aggregate", label: "Policy aggregate limit" },
    ],
  },
  {
    id: "cyber",
    label: "Cyber",
    limits: [
      { key: "each_incident", label: "Per incident / claim limit" },
      { key: "aggregate", label: "Policy aggregate limit" },
    ],
  },
  {
    id: "umbrella",
    label: "Umbrella / excess",
    limits: [
      { key: "each_occurrence", label: "Each occurrence limit" },
      { key: "aggregate", label: "Policy aggregate limit" },
    ],
  },
  {
    id: "other",
    label: "Other",
    limits: [
      { key: "coverage_description", label: "Coverage type" },
      { key: "policy_limit", label: "Per claim / loss / policy limit" },
      { key: "aggregate", label: "Aggregate limit, if applicable" },
    ],
  },
] as const;
export type CoverageId = (typeof COVERAGE_OPTIONS)[number]["id"];
export type CoverageRequest = {
  coverage: CoverageId;
  limits: Record<string, string>;
  additionalCoverages?: string;
  scopeDescription?: string;
  properties?: IntakeLocation[];
  vehicles?: { year: string; make: string; model: string; vin: string }[];
};
export type IntakeAddress = {
  longitude?: number;
  latitude?: number;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  formatted?: string;
};
export type IntakeLocation = { address: IntakeAddress; details: string };
export type RelatedEntity = {
  legalName: string;
  relationship: string;
  insured: "" | "include" | "exclude" | "unsure";
};
export type IntakeDetails = {
  coverages: CoverageRequest[];
  prefillSourceIds?: string[];
  mailingAddress: IntakeAddress;
  registrationCountry?: string;
  registrationState?: string;
  registrationAddress?: IntakeAddress;
  mailingSameAsRegistered?: "yes" | "no";
  mailingAddressStep?: boolean;
  locations: IntakeLocation[];
  relatedEntities: RelatedEntity[];
  relatedEntitiesNote: string;
  hasRelatedEntities?: "yes" | "no";
  limitsNote?: string;
  scopeNote?: string;
  additionalNote?: string;
  dateInput?: string;
  dateParts: { year: string; month: string; day: string };
  coverageIndex: number;
};
export function coverageOption(id: CoverageId) {
  return COVERAGE_OPTIONS.find((option) => option.id === id)!;
}
export function newCoverage(coverage: CoverageId): CoverageRequest {
  return {
    coverage,
    limits: Object.fromEntries(
      coverageOption(coverage).limits.map((limit) => [limit.key, ""]),
    ),
  };
}
export function addressText(address: IntakeAddress) {
  return (
    address.formatted ||
    [
      address.street1,
      address.street2,
      [address.city, address.state, address.zip].filter(Boolean).join(", "),
      address.country,
    ]
      .filter(Boolean)
      .join(", ")
  );
}
export function detailsFromAnswers(answers: IntakeAnswers): IntakeDetails {
  const selected = COVERAGE_OPTIONS.filter(
    (option) =>
      option.id !== "unknown" && answers.coverage?.includes(option.label),
  );
  const date =
    answers.effectiveDate && dayjs(answers.effectiveDate).isValid()
      ? dayjs(answers.effectiveDate)
      : null;
  return {
    coverages: selected.length
      ? selected.map((option) => newCoverage(option.id))
      : answers.coverage?.toLowerCase().includes("not sure")
        ? [newCoverage("unknown")]
        : [],
    ...(answers.registeredAddress
      ? {
          registrationAddress: {
            formatted: answers.registeredAddress,
            street1: answers.registeredAddress,
          },
        }
      : {}),
    mailingAddress: answers.mailingAddress
      ? { formatted: answers.mailingAddress, street1: answers.mailingAddress }
      : {},
    locations: answers.locations
      ? [{ address: {}, details: answers.locations }]
      : [],
    relatedEntities: [],
    relatedEntitiesNote: answers.relatedEntities ?? "",
    limitsNote: answers.limits ?? "",
    scopeNote: answers.coverageScope ?? "",
    additionalNote: answers.separateQuotes ?? "",
    dateParts: {
      year: date?.format("YYYY") ?? "",
      month: date?.format("MM") ?? "",
      day: date?.format("DD") ?? "",
    },
    coverageIndex: 0,
  };
}
function limitText(key: string, value?: string) {
  if (!value) return "Not provided";
  if (
    ["statutory", "coverage_description"].includes(key) ||
    value === UNKNOWN_ANSWER
  )
    return value;
  return `$${value.replace(/^\$\s*/, "")}`;
}
export function detailsAnswers(details: IntakeDetails): IntakeAnswers {
  const date = `${details.dateParts.year}-${details.dateParts.month}-${details.dateParts.day}`;
  return {
    coverage: details.coverages
      .map((line) => coverageOption(line.coverage).label)
      .join(", "),
    limits: [
      details.limitsNote,
      details.coverages
        .map(
          (line) =>
            `${coverageOption(line.coverage).label}\n${
              coverageOption(line.coverage)
                .limits.map(
                  (limit) =>
                    `${limit.label}: ${limitText(limit.key, line.limits[limit.key])}`,
                )
                .join("\n") || UNKNOWN_ANSWER
            }`,
        )
        .join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
    ...(details.coverages.some((line) => line.additionalCoverages !== undefined)
      ? {
          separateQuotes: [
            details.additionalNote,
            details.coverages
              .filter((line) => line.additionalCoverages?.trim())
              .map(
                (line) =>
                  `${coverageOption(line.coverage).label}: ${line.additionalCoverages}`,
              )
              .join("\n\n"),
          ]
            .filter(Boolean)
            .join("\n\n"),
        }
      : {}),
    ...(details.coverages.some(
      (line) =>
        line.scopeDescription !== undefined ||
        line.properties !== undefined ||
        line.vehicles !== undefined,
    )
      ? {
          coverageScope: [
            details.scopeNote,
            details.coverages
              .map((line) =>
                [
                  coverageOption(line.coverage).label,
                  line.scopeDescription,
                  ...(line.properties ?? []).map((row) =>
                    [addressText(row.address), row.details]
                      .filter(Boolean)
                      .join(" — "),
                  ),
                  ...(line.vehicles ?? []).map((row) =>
                    [row.year, row.make, row.model, row.vin]
                      .filter(Boolean)
                      .join(" "),
                  ),
                ]
                  .filter(Boolean)
                  .join("\n"),
              )
              .join("\n\n"),
          ]
            .filter(Boolean)
            .join("\n\n"),
        }
      : {}),
    ...(details.registrationCountry !== undefined ||
    details.registrationState !== undefined
      ? {
          formation: details.registrationState
            ? `${details.registrationState}, ${details.registrationCountry || "United States"}`
            : "",
        }
      : {}),
    ...(details.registrationAddress
      ? { registeredAddress: addressText(details.registrationAddress) }
      : {}),
    mailingAddress: addressText(details.mailingAddress),
    locations: details.locations
      .map((location) =>
        [addressText(location.address), location.details]
          .filter(Boolean)
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n\n"),
    relatedEntities:
      details.hasRelatedEntities === "no"
        ? "No"
        : [
            details.relatedEntitiesNote,
            ...details.relatedEntities
              .filter((entity) => entity.legalName.trim())
              .map(
                (entity) =>
                  `${entity.legalName} — ${entity.relationship || UNKNOWN_ANSWER}; ${entity.insured === "unsure" ? UNKNOWN_ANSWER : entity.insured}`,
              ),
          ]
            .filter(Boolean)
            .join("\n"),
    effectiveDate:
      details.dateParts.year &&
      details.dateParts.month &&
      details.dateParts.day &&
      dayjs(date).isValid() &&
      dayjs(date).format("YYYY-MM-DD") === date
        ? date
        : "",
  };
}
export function validateIntakeDetails(details: IntakeDetails) {
  if (
    details.prefillSourceIds &&
    (details.prefillSourceIds.length > 20 ||
      details.prefillSourceIds.some((id) => id.length > 100))
  )
    throw new Error("Invalid prefill source list");
  for (const address of [
    details.mailingAddress,
    ...(details.registrationAddress ? [details.registrationAddress] : []),
    ...details.locations.map((row) => row.address),
    ...details.coverages.flatMap((line) =>
      (line.properties ?? []).map((row) => row.address),
    ),
  ]) {
    if (
      (address.longitude !== undefined &&
        (!Number.isFinite(address.longitude) ||
          Math.abs(address.longitude) > 180)) ||
      (address.latitude !== undefined &&
        (!Number.isFinite(address.latitude) ||
          Math.abs(address.latitude) > 90)) ||
      (address.longitude === undefined) !== (address.latitude === undefined)
    )
      throw new Error("Invalid address coordinates");
  }
  if (
    JSON.stringify(details).length > 32000 ||
    details.coverages.length > COVERAGE_OPTIONS.length ||
    details.locations.length > 30 ||
    details.relatedEntities.length > 30
  )
    throw new Error("Keep your intake details within the allowed size");
  const ids = details.coverages.map((line) => line.coverage);
  if (
    new Set(ids).size !== ids.length ||
    (ids.includes("unknown") && ids.length > 1)
  )
    throw new Error("Choose distinct coverages or I'm not sure");
  for (const line of details.coverages) {
    if (
      (line.properties?.length ?? 0) > 30 ||
      (line.vehicles?.length ?? 0) > 30
    )
      throw new Error("Keep each coverage scope within 30 items");
    const option = coverageOption(line.coverage);
    if (
      !option ||
      Object.keys(line.limits).some(
        (key) => !option.limits.some((limit) => limit.key === key),
      ) ||
      Object.values(line.limits).some((value) => value.length > 500)
    )
      throw new Error("Invalid coverage limits");
  }
  if (
    !Number.isInteger(details.coverageIndex) ||
    details.coverageIndex < 0 ||
    (details.coverages.length
      ? details.coverageIndex >= details.coverages.length
      : details.coverageIndex !== 0)
  )
    throw new Error("Invalid coverage step");
}

/** A limit can be explicitly unknown; monetary limits require a positive amount. */
export function validCoverageLimit(key: string, value?: string): boolean {
  if (!value?.trim()) return false;
  if (value === UNKNOWN_ANSWER) return true;
  if (["statutory", "coverage_description"].includes(key)) return true;
  const amount = value
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/,/g, "");
  return (
    /^\d+(?:\.\d{1,2})?$/.test(amount) &&
    Number(amount) > 0 &&
    Number.isFinite(Number(amount))
  );
}

export function needsCoverageScope(id: CoverageId) {
  return ["property", "commercial_auto", "other", "unknown"].includes(id);
}
export function validCoverageScope(
  line: CoverageRequest,
  legacyScope?: string,
) {
  if (
    legacyScope?.trim() &&
    line.properties === undefined &&
    line.vehicles === undefined &&
    line.scopeDescription === undefined
  )
    return true;
  if (line.coverage === "property")
    return (
      !!line.properties?.length &&
      line.properties.every((row) => !!addressText(row.address).trim())
    );
  if (line.coverage === "commercial_auto")
    return (
      !!line.vehicles?.length &&
      line.vehicles.every(
        (row) =>
          /^\d{4}$/.test(row.year) &&
          !!row.make.trim() &&
          !!row.model.trim() &&
          (!row.vin || /^[A-HJ-NPR-Z0-9]{17}$/i.test(row.vin)),
      )
    );
  if (needsCoverageScope(line.coverage)) return !!line.scopeDescription?.trim();
  return true;
}
