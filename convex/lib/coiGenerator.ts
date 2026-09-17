"use node";

import dayjs from "dayjs";
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import {
  CERTIFICATE_FORM_LABELS,
  type CertificateCoveredAssetSchedule,
  type CertificateFormCode,
  type CertificateCoverageLine,
  type CertificateData,
  type CertificatePropertyInformation,
  type CertificatePropertyLocation,
} from "./acordForms/types";
import {
  buildCoverageBreakdown,
  type CoverageBreakdownGroup,
  type CoverageBreakdownRow,
} from "./coverageBreakdown";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";
import { resolvePolicyPartyContext } from "./policyPartyContext";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * COI data mapping Spot's rich policy fields to ACORD certificate fields.
 * All monetary values should be pre-formatted strings (e.g. "$1,000,000").
 * Canonical shape lives in ./acordForms/types.
 */
export type CoiData = CertificateData;

/** One coverage section in the ACORD 25 grid. */
export type CoverageLine = CertificateCoverageLine;

// ─── Mapping helpers ──────────────────────────────────────────────────────────

/**
 * Map a Spot policy document to CoiData.
 * Produces one CoverageLine per detected coverage type.
 */

export function policyToCoiData(
  policy: any,
  options: {
    includedLineOfBusinessCodes?: string[];
  } = {},
): CoiData {
  const profile = operationalProfile(policy);
  const limits: any = policy.limits ?? {};
  const profileLinesOfBusiness = Array.isArray(profile?.linesOfBusiness) && profile.linesOfBusiness.length > 0
    ? profile.linesOfBusiness
    : undefined;
  const linesOfBusiness = policyLobCodes({
    linesOfBusiness: profileLinesOfBusiness?.length ? profileLinesOfBusiness : policy.linesOfBusiness,
  });
  const declarations = declarationFieldMap(policy);
  const policyNumber = profileValue(profile?.policyNumber) ?? pickField(declarations, "policyNumber") ?? policy.policyNumber ?? "";
  const effDate = profileValue(profile?.effectiveDate) ?? pickField(declarations, "policyPeriodStart") ?? policy.effectiveDate ?? "";
  const expDate = profileValue(profile?.expirationDate) ?? pickField(declarations, "policyPeriodEnd") ?? policy.expirationDate ?? "";
  const coverageForm = policy.coverageForm ?? "occurrence";
  const partyContext = resolvePolicyPartyContext(policy);
  const propertyFields = certificatePropertyFields(policy, profile, declarations);

  // Build insurer row for Insurer A
  const insurers = [{
    letter: "A",
    name: partyContext.insurerName ?? "N/A",
    naic: partyContext.insurerNaicNumber,
    amBest: policy.carrierAmBestRating,
    admitted: policy.carrierAdmittedStatus,
  }];

  const coverageLines: CoverageLine[] = buildCoverageLines(policyWithOperationalCoverages(policy, profile), {
    policyNumber,
    effectiveDate: effDate,
    expirationDate: expDate,
    coverageForm,
  });
  const requestedCodes = options.includedLineOfBusinessCodes?.length
    ? policyLobCodes({ linesOfBusiness: options.includedLineOfBusinessCodes })
    : [];
  const selectedCoverageLines = requestedCodes.length > 0
    ? coverageLines.filter((line) => coverageMatchesRequestedLobs(line, requestedCodes))
    : coverageLines;
  const selectedFallbackLines = requestedCodes.length > 0
    ? buildFallbackCoverageLines(requestedCodes, limits, {
        policyNumber,
        effectiveDate: effDate,
        expirationDate: expDate,
        coverageForm,
      })
    : buildFallbackCoverageLines(linesOfBusiness, limits, {
        policyNumber,
        effectiveDate: effDate,
        expirationDate: expDate,
        coverageForm,
      });

  return {
    title: deriveCertificateTitle(),
    issuedDateLabel: "ISSUE DATE (YYYY/MM/DD)",
    producerAgency: partyContext.producerName,
    producerContact: partyContext.producerContactName ?? policy.underwriter,
    producerLicense: partyContext.producerLicenseNumber,
    producerAddress: partyContext.producerAddress,
    producerPhone: partyContext.producerPhone,
    producerEmail: partyContext.producerEmail,
    insuranceCompanyAddress: formatAddress(partyContext.insurerAddress),
    insuranceCompanyPhone: pickField(declarations, "insurerPhone"),
    insuredName: partyContext.insuredName ?? "N/A",
    insuredDba: policy.insuredDba,
    insuredAddress: partyContext.insuredAddress,
    insuredFein: policy.insuredFein,
    insurers,
    coverages: selectedCoverageLines.length ? selectedCoverageLines : selectedFallbackLines,
    description: partyContext.operationsDescription,
    ...propertyFields,
  };
}

const LOB_FAMILIES: ReadonlyArray<ReadonlySet<string>> = [
  new Set(["CGL", "GL", "BOP", "BOPGL"]),
  new Set(["AUTO", "AUTOB", "AUTOP", "GARAG", "TRUCK"]),
  new Set(["UMBRC", "UMBRL", "UMBRP", "EXLIA"]),
  new Set(["WORK", "WCMA", "WORKP", "WORKV"]),
];

function coverageMatchesRequestedLobs(
  coverage: CoverageLine,
  requestedCodes: readonly string[],
) {
  const coverageCodes = policyLobCodes({
    linesOfBusiness: [coverage.lineOfBusiness, coverage.type].filter(
      (value): value is string => Boolean(value),
    ),
  });
  if (coverageCodes.some((code) => requestedCodes.includes(code))) return true;
  return LOB_FAMILIES.some((family) =>
    coverageCodes.some((code) => family.has(code)) &&
    requestedCodes.some((code) => family.has(code)),
  );
}

function operationalProfile(policy: any): any | undefined {
  return policy?.operationalProfile && typeof policy.operationalProfile === "object" && !Array.isArray(policy.operationalProfile)
    ? policy.operationalProfile
    : undefined;
}

function profileValue(value: any): string | undefined {
  return value && typeof value === "object" && typeof value.value === "string" && value.value.trim()
    ? value.value.trim()
    : undefined;
}

function certificatePropertyFields(
  policy: any,
  profile: any | undefined,
  declarationFields: Map<string, string>,
): Pick<
  CertificateData,
  | "propertyDescription"
  | "propertyLocation"
  | "propertyInformation"
  | "coveredAssetSchedules"
  | "floodZone"
  | "floodProgram"
> {
  const rawLocations = firstNonEmptyArray(policy?.locations, profile?.locations);
  const locations = rawLocations.flatMap(normalizeCertificatePropertyLocation);
  const declarations = objectValue(policy?.declarations);
  const propertyInformation: CertificatePropertyInformation = {
    causesOfLossForm: scalarText(
      declarations?.causesOfLossForm,
      declarationFields.get("causesOfLossForm"),
    ),
    coinsurancePercent: scalarNumberOrText(
      declarations?.coinsurancePercent,
      declarationFields.get("coinsurancePercent"),
      declarationFields.get("coinsurance"),
    ),
    valuationMethod: scalarText(
      declarations?.valuationMethod,
      declarationFields.get("valuationMethod"),
      declarationFields.get("valuation"),
    ),
    blanketLimit: scalarText(
      declarations?.blanketLimit,
      declarationFields.get("blanketLimit"),
    ),
    businessIncomeLimit: scalarText(
      declarations?.businessIncomeLimit,
      declarationFields.get("businessIncomeLimit"),
    ),
    extraExpenseLimit: scalarText(
      declarations?.extraExpenseLimit,
      declarationFields.get("extraExpenseLimit"),
    ),
    locations,
  };
  const hasPropertyInformation = locations.length > 0 || Object.entries(propertyInformation)
    .some(([key, value]) => key !== "locations" && value !== undefined);
  const firstLocationAddress = locations[0]?.address;
  const coveredAssetSchedules = buildCoverageBreakdown(policy).schedules.map(
    (schedule): CertificateCoveredAssetSchedule => ({
      name: schedule.name,
      kind: schedule.kind,
      description: schedule.description,
      items: schedule.items.map((item) => ({
        label: item.label,
        description: item.description,
        values: item.values,
      })),
    }),
  );

  return {
    propertyDescription: scalarText(
      profile?.propertyDescription,
      profile?.describedProperty,
      declarationFields.get("describedProperty"),
      declarationFields.get("propertyDescription"),
    ),
    propertyLocation: firstLocationAddress
      ? formatAddress(firstLocationAddress).replace(/\n+/g, ", ")
      : scalarText(
          declarationFields.get("premisesAddress"),
          declarationFields.get("propertyLocation"),
          declarationFields.get("insuredLocation"),
        ),
    propertyInformation: hasPropertyInformation ? propertyInformation : undefined,
    coveredAssetSchedules: coveredAssetSchedules.length ? coveredAssetSchedules : undefined,
    floodZone: scalarText(
      profile?.floodZone,
      declarations?.floodZone,
      declarationFields.get("floodZone"),
      declarationFields.get("floodZoneDetermination"),
    ),
    floodProgram: scalarText(
      profile?.floodProgram,
      declarations?.floodProgram,
      declarationFields.get("floodProgram"),
      declarationFields.get("nfipProgram"),
    ),
  };
}

function normalizeCertificatePropertyLocation(
  value: unknown,
  index: number,
): CertificatePropertyLocation[] {
  const location = objectValue(value);
  if (!location) return [];
  const address = normalizeCertificateAddress(location.address ?? location.location);
  const normalized: CertificatePropertyLocation = {
    number: finiteNumber(location.number) ?? index + 1,
    address,
    description: scalarText(location.description),
    buildingValue: scalarText(location.buildingValue),
    contentsValue: scalarText(location.contentsValue),
    businessIncomeValue: scalarText(location.businessIncomeValue),
    constructionType: scalarText(location.constructionType),
    yearBuilt: finiteNumber(location.yearBuilt),
    squareFootage: finiteNumber(location.squareFootage),
    protectionClass: scalarText(location.protectionClass),
    sprinklered: booleanValue(location.sprinklered),
    alarmType: scalarText(location.alarmType),
    occupancy: scalarText(location.occupancy),
  };
  return Object.entries(normalized).some(([key, field]) => key !== "number" && field !== undefined)
    ? [normalized]
    : [];
}

function normalizeCertificateAddress(
  value: unknown,
): CertificatePropertyLocation["address"] {
  if (typeof value === "string" && value.trim()) return value.trim();
  const address = objectValue(value);
  if (!address) return undefined;
  const normalized = {
    street1: scalarText(address.street1, address.line1),
    street2: scalarText(address.street2, address.line2),
    city: scalarText(address.city),
    state: scalarText(address.state),
    zip: scalarText(address.zip, address.postalCode),
    country: scalarText(address.country),
    formatted: scalarText(address.formatted),
  };
  return Object.values(normalized).some((field) => field !== undefined) ? normalized : undefined;
}

function firstNonEmptyArray(...values: unknown[]): unknown[] {
  return values.find((value): value is unknown[] => Array.isArray(value) && value.length > 0) ?? [];
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function scalarText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const record = objectValue(value);
    if (typeof record?.value === "string" && record.value.trim()) return record.value.trim();
  }
  return undefined;
}

function scalarNumberOrText(...values: unknown[]): number | string | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = scalarText(value);
    if (text) return text;
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function policyWithOperationalCoverages(policy: any, profile: any | undefined): any {
  if (!Array.isArray(profile?.coverages) || profile.coverages.length === 0) return policy;
  return {
    ...policy,
    coverages: profile.coverages.map((coverage: any) => ({
      name: coverage.name,
      coverageCode: coverage.coverageCode,
      limit: coverage.limit,
      deductible: coverage.deductible,
      premium: coverage.premium,
      formNumber: coverage.formNumber,
      sectionRef: coverage.sectionRef,
      isOperationalProfileCoverage: true,
      documentNodeId: coverage.sourceNodeIds?.[0],
      sourceSpanIds: coverage.sourceSpanIds,
      originalContent: [coverage.name, coverage.limit, coverage.deductible, coverage.premium].filter(Boolean).join(" | "),
    })),
    supplementaryFacts: [
      ...(Array.isArray(policy.supplementaryFacts) ? policy.supplementaryFacts : []),
      ...(Array.isArray(profile.endorsementSupport)
        ? profile.endorsementSupport.map((item: any) => ({
            key: item.kind,
            value: item.summary,
            documentNodeId: item.sourceNodeIds?.[0],
            sourceSpanIds: item.sourceSpanIds,
          }))
        : []),
    ],
  };
}

function buildFallbackCoverageLines(
  lobCodes: string[],
  limits: any,
  defaults: {
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    coverageForm: string;
  },
): CoverageLine[] {
  const hasNamedLobCode = lobCodes.some((code) => code !== "UN");
  const coverageLines: CoverageLine[] = [];

  // ── Commercial General Liability ──────────────────────────────────────────
  const hasGL = lobCodes.some((code) =>
    ["CGL", "GL", "BOP", "BOPGL"].includes(code)
  );
  if (hasGL || (!hasNamedLobCode && (limits.perOccurrence || limits.generalAggregate))) {
    const glLimits: Array<{ label: string; value: string }> = [];
    if (limits.perOccurrence) glLimits.push({ label: "EACH OCCURRENCE", value: limits.perOccurrence });
    if (limits.fireDamage) glLimits.push({ label: "DAMAGE TO RENTED\nPREMISES (Ea occurrence)", value: limits.fireDamage });
    if (limits.medicalExpense) glLimits.push({ label: "MED EXP (Any one person)", value: limits.medicalExpense });
    if (limits.personalAdvertisingInjury) glLimits.push({ label: "PERSONAL & ADV INJURY", value: limits.personalAdvertisingInjury });
    if (limits.generalAggregate) glLimits.push({ label: "GENERAL AGGREGATE", value: limits.generalAggregate });
    if (limits.productsCompletedOpsAggregate) glLimits.push({ label: "PRODUCTS - COMP/OP AGG", value: limits.productsCompletedOpsAggregate });
    if (glLimits.length === 0 && limits.eachEmployee) glLimits.push({ label: "EACH EMPLOYEE", value: limits.eachEmployee });

    coverageLines.push({
      type: "COMMERCIAL GENERAL LIABILITY",
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: glLimits,
    });
  }

  // ── Automobile Liability ──────────────────────────────────────────────────
  const hasAuto = lobCodes.some((code) =>
    ["AUTO", "AUTOB", "AUTOP", "GARAG", "TRUCK"].includes(code)
  );
  if (hasAuto || (!hasNamedLobCode && (limits.combinedSingleLimit || limits.bodilyInjuryPerPerson))) {
    const autoLimits: Array<{ label: string; value: string }> = [];
    if (limits.combinedSingleLimit) autoLimits.push({ label: "COMBINED SINGLE LIMIT\n(Ea accident)", value: limits.combinedSingleLimit });
    if (limits.bodilyInjuryPerPerson) autoLimits.push({ label: "BODILY INJURY (Per person)", value: limits.bodilyInjuryPerPerson });
    if (limits.bodilyInjuryPerAccident) autoLimits.push({ label: "BODILY INJURY (Per accident)", value: limits.bodilyInjuryPerAccident });
    if (limits.propertyDamage) autoLimits.push({ label: "PROPERTY DAMAGE\n(Per accident)", value: limits.propertyDamage });

    const autoTypeNote = "ANY AUTO";

    coverageLines.push({
      type: "AUTOMOBILE LIABILITY",
      insurerLetter: "A",
      typeNotes: autoTypeNote,
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: autoLimits,
    });
  }

  // ── Umbrella / Excess Liability ───────────────────────────────────────────
  const hasUmbrella = lobCodes.some((code) => ["UMBRC", "UMBRL", "UMBRP", "EXLIA"].includes(code));
  if (hasUmbrella || (!hasNamedLobCode && (limits.eachOccurrenceUmbrella || limits.umbrellaAggregate))) {
    const umbLimits: Array<{ label: string; value: string }> = [];
    if (limits.eachOccurrenceUmbrella) umbLimits.push({ label: "EACH OCCURRENCE", value: limits.eachOccurrenceUmbrella });
    if (limits.umbrellaAggregate) umbLimits.push({ label: "AGGREGATE", value: limits.umbrellaAggregate });
    if (limits.umbrellaRetention) umbLimits.push({ label: "DED  RETENTION", value: limits.umbrellaRetention });

    coverageLines.push({
      type: lobCodes.includes("EXLIA") ? "EXCESS LIAB" : "UMBRELLA LIAB",
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: umbLimits,
    });
  }

  // ── Workers Compensation ──────────────────────────────────────────────────
  const hasWC = lobCodes.some((code) => ["WORK", "WCMA", "WORKP", "WORKV"].includes(code));
  if (hasWC || (!hasNamedLobCode && (limits.statutory || limits.employersLiability))) {
    const el: any = limits.employersLiability ?? {};
    const wcLimits: Array<{ label: string; value: string }> = [];
    wcLimits.push({ label: "WC STAT", value: limits.statutory ? "✓" : "" });
    if (el.eachAccident) wcLimits.push({ label: "E.L. EACH ACCIDENT", value: el.eachAccident });
    if (el.diseaseEachEmployee) wcLimits.push({ label: "E.L. DISEASE - EA EMPLOYEE", value: el.diseaseEachEmployee });
    if (el.diseasePolicyLimit) wcLimits.push({ label: "E.L. DISEASE - POLICY LIMIT", value: el.diseasePolicyLimit });

    coverageLines.push({
      type: "WORKERS COMPENSATION\nAND EMPLOYERS' LIABILITY",
      insurerLetter: "A",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: wcLimits,
    });
  }

  // Other lines of business (professional liability, other liability, etc.).
  const otherCodes = lobCodes.filter((code) =>
    !["CGL", "GL", "BOP", "BOPGL", "AUTO", "AUTOB", "AUTOP", "GARAG", "TRUCK",
      "UMBRC", "UMBRL", "UMBRP", "EXLIA", "WORK", "WCMA", "WORKP", "WORKV", "UN"].includes(code)
  );
  if (otherCodes.length > 0) {
    const typeLabel = otherCodes
      .map(lobLabel)
      .join(", ");
    coverageLines.push({
      type: typeLabel,
      lineOfBusiness: otherCodes.length === 1 ? otherCodes[0] : undefined,
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: buildOtherLimits(limits),
    });
  }

  // If no specific coverage lines were identified, add a generic one
  if (coverageLines.length === 0) {
    coverageLines.push({
      type: lobCodes.filter((code) => code !== "UN").map(lobLabel).join(" / ").toUpperCase() || "SEE POLICY",
      insurerLetter: "A",
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: flattenToLimitLines(limits),
    });
  }

  return coverageLines;
}

function deriveCertificateTitle(): string {
  return "CERTIFICATE OF LIABILITY INSURANCE";
}

function declarationFieldMap(policy: any): Map<string, string> {
  const fields = Array.isArray(policy.declarations?.fields) ? policy.declarations.fields : [];
  const map = new Map<string, string>();
  for (const field of fields) {
    if (typeof field?.field !== "string" || typeof field?.value !== "string") continue;
    const value = field.value.trim();
    if (value && !map.has(field.field)) map.set(field.field, value);
  }
  return map;
}

function pickField(fields: Map<string, string>, name: string): string | undefined {
  return fields.get(name);
}

function joinLines(...values: Array<string | undefined | null | false>): string | undefined {
  const parts = values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

function buildCoverageLines(
  policy: any,
  defaults: {
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    coverageForm: string;
  },
): CoverageLine[] {
  const breakdown = buildCoverageBreakdown(policy);
  if (!breakdown.all.length) return [];

  const coverageLines: CoverageLine[] = [
    ...breakdown.groups.map((group) => buildLobCoverageLine(group, defaults)),
    ...buildUnassignedCoverageLines(breakdown.unassigned, defaults),
  ];
  return coverageLines
    .filter((line) => line.limits.length > 0 || line.deductible || line.description || line.sectionRef);
}

function buildLobCoverageLine(
  group: CoverageBreakdownGroup,
  defaults: {
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    coverageForm: string;
  },
): CoverageLine {
  return {
    type: group.label,
    lineOfBusiness: group.lineOfBusiness,
    insurerLetter: "A",
    coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" : "occurrence",
    policyNumber: defaults.policyNumber,
    effectiveDate: defaults.effectiveDate,
    expirationDate: defaults.expirationDate,
    limits: coverageTermsForRows(group.items, group.label),
    deductible: firstFormattedValue(group.items.map((row) => row.deductible)),
    sectionRef: firstText(group.items.map((row) => row.sectionRef)),
    description: coverageRowsDescription(group.items, group.label),
  };
}

function buildUnassignedCoverageLines(
  rows: CoverageBreakdownRow[],
  defaults: {
    policyNumber: string;
    effectiveDate: string;
    expirationDate: string;
    coverageForm: string;
  },
): CoverageLine[] {
  const grouped = new Map<
    string,
    {
      limits: Array<{ label: string; value: string }>;
      deductible?: string;
      sectionRef?: string;
      description?: string;
    }
  >();
  for (const coverage of rows) {
    const group = coverageGroupName(coverage.name);
    const row = grouped.get(group) ?? { limits: [] };
    for (const term of coverageTermsForRows([coverage], group)) {
      const key = `${term.label}:${term.value}`;
      if (!row.limits.some((item) => `${item.label}:${item.value}` === key)) {
        row.limits.push(term);
      }
    }
    const deductible = formatMoneyLike(coverage.deductible);
    if (deductible && !row.deductible) {
      row.deductible = deductible;
    }
    if (!row.sectionRef && coverage.sectionRef) row.sectionRef = String(coverage.sectionRef);
    if (!row.description) {
      row.description = coverage.description ?? coverageRowsDescription([coverage], group);
    }
    if (row.limits.length > 0 || row.deductible || row.description || row.sectionRef) {
      grouped.set(group, row);
    }
  }

  return Array.from(grouped.entries())
    .map(([type, row]) => ({
      type,
      insurerLetter: "A",
      coverageForm: defaults.coverageForm === "claims_made" ? "claims_made" as const : "occurrence" as const,
      policyNumber: defaults.policyNumber,
      effectiveDate: defaults.effectiveDate,
      expirationDate: defaults.expirationDate,
      limits: row.limits,
      deductible: row.deductible,
      sectionRef: row.sectionRef,
      description: row.description,
    }));
}

function coverageTermsForRows(
  rows: CoverageBreakdownRow[],
  groupLabel: string,
): Array<{ label: string; value: string }> {
  const terms: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  const pushTerm = (row: CoverageBreakdownRow, label: string, value: unknown) => {
    const formatted = formatMoneyLike(value);
    if (!formatted) return;
    const term = {
      label: coverageTermLabel(row, label, groupLabel),
      value: formatted,
    };
    const key = `${term.label.toLowerCase()}|${term.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };

  for (const row of rows) {
    if (row.limits?.length) {
      for (const limit of row.limits) {
        pushTerm(row, limit.label, limit.value);
      }
    } else {
      pushTerm(row, coverageLimitLabel(row), row.limit);
    }
    pushTerm(row, "Deductible", row.deductible);
  }
  return terms;
}

function coverageTermLabel(
  row: CoverageBreakdownRow,
  label: string,
  groupLabel: string,
): string {
  const cleanLabel = titleCase(label).replace(/\s+/g, " ").trim() || "Limit";
  const coverageName = titleCase(row.name).replace(/\s+/g, " ").trim();
  if (!coverageName || equivalentLabel(coverageName, groupLabel)) return cleanLabel;
  if (cleanLabel.toLowerCase().startsWith(coverageName.toLowerCase())) return cleanLabel;
  return `${coverageName} - ${cleanLabel}`;
}

function equivalentLabel(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalize(left) === normalize(right);
}

function firstText(values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function firstFormattedValue(values: Array<string | undefined>): string | undefined {
  const value = values.find((item) => formatMoneyLike(item));
  return formatMoneyLike(value);
}

function coverageRowsDescription(
  rows: CoverageBreakdownRow[],
  groupLabel: string,
): string | undefined {
  const names = uniqueTexts(
    rows
      .map((row) => row.name)
      .filter((name) => !equivalentLabel(name, groupLabel)),
  );
  const descriptions = uniqueTexts(
    rows
      .map((row) => row.description)
      .filter((description) => description && !names.some((name) => equivalentLabel(name, description))),
  );
  return joinLines(
    names.length ? `Coverage schedules: ${names.join("; ")}` : undefined,
    ...descriptions.slice(0, 2),
  );
}

function uniqueTexts(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function coverageGroupName(name: string): string {
  const normalized = name.toLowerCase();
  if (/cyber|network|privacy|social engineering|selling away/.test(normalized)) return "Cyber Liability";
  if (/employment|epli|employee practices/.test(normalized)) return "Employment Practices Liability";
  if (/professional|agent|broker|dealer|errors|omissions/.test(normalized)) return "Professional Liability";
  return titleCase(name.replace(/\s*-\s*(limit of liability|deductible).*$/i, "")) || "Coverage";
}

function coverageLimitLabel(coverage: any): string {
  const name = String(coverage.name ?? coverage.type ?? "Limit")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s*-\s*Limit of Liability.*$/i, "")
    .replace(/\s*Limit of Liability\s*/i, "")
    .replace(/\s*Deductible\s*/i, "Deductible")
    .replace(/\s+/g, " ")
    .trim();
  const limitType = String(coverage.limitType ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  if (/deductible/i.test(name)) return name;
  return [name, limitType].filter(Boolean).join(" - ") || "Limit";
}

function formatMoneyLike(value: unknown): string | undefined {
  if (value == null) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (/^\$/.test(raw)) return raw;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return `$${Number(raw).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return raw;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function buildOtherLimits(limits: any): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  if (limits.perOccurrence) result.push({ label: "EACH CLAIM / OCCURRENCE", value: limits.perOccurrence });
  if (limits.generalAggregate) result.push({ label: "AGGREGATE", value: limits.generalAggregate });
  if (limits.combinedSingleLimit) result.push({ label: "LIMIT", value: limits.combinedSingleLimit });
  return result;
}

function flattenToLimitLines(limits: any): Array<{ label: string; value: string }> {
  const result: Array<{ label: string; value: string }> = [];
  const labelMap: Record<string, string> = {
    perOccurrence: "EACH OCCURRENCE",
    generalAggregate: "AGGREGATE",
    combinedSingleLimit: "COMBINED SINGLE LIMIT",
    productsCompletedOpsAggregate: "PRODUCTS - COMP/OP AGG",
    personalAdvertisingInjury: "PERSONAL & ADV INJURY",
    fireDamage: "DAMAGE TO RENTED PREMISES",
    medicalExpense: "MED EXP",
    bodilyInjuryPerPerson: "BODILY INJURY (Per person)",
    bodilyInjuryPerAccident: "BODILY INJURY (Per accident)",
    propertyDamage: "PROPERTY DAMAGE",
    eachOccurrenceUmbrella: "EACH OCCURRENCE",
    umbrellaAggregate: "AGGREGATE",
  };
  for (const [key, label] of Object.entries(labelMap)) {
    if (limits[key] && typeof limits[key] === "string") {
      result.push({ label, value: limits[key] as string });
    }
  }
  return result;
}

function formatAddress(
  addr: string | { street1?: string; street2?: string; city?: string; state?: string; zip?: string; country?: string; formatted?: string } | undefined | null,
): string {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  if (addr.formatted?.trim()) return addr.formatted.trim();
  const parts = [
    addr.street1,
    addr.street2,
    [addr.city, addr.state && addr.zip ? `${addr.state} ${addr.zip}` : (addr.state ?? addr.zip)].filter(Boolean).join(", "),
    addr.country,
  ];
  return parts.filter(Boolean).join("\n");
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

const PAGE_W = 612;
const PAGE_H = 792;
const M = 30;          // left/right margin
const W = PAGE_W - 2 * M;  // 552pt usable width

// Font sizes
const FS_LABEL = 6.5;
const FS_VALUE = 8;
const FS_SMALL = 6;
const INFO_BOX_VALUE_TOP = 16;
const INFO_BOX_BOTTOM_PADDING = 4;
const HOLDER_BOX_MAX_HEIGHT = 96;

// Colors
const C_BLACK = "#000000";
const C_HEADER_BG = "#d0d0d0";
const C_LABEL_BG = "#e8e8e8";
const ACORD_25_INFORMATION_NOTICE =
  "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS CERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW. THIS CERTIFICATE OF INSURANCE DOES NOT CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE OR PRODUCER, AND THE CERTIFICATE HOLDER.";
const ACORD_25_COVERAGE_NOTICE =
  "THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED. NOTWITHSTANDING ANY REQUIREMENT, TERM OR CONDITION OF ANY CONTRACT OR OTHER DOCUMENT WITH RESPECT TO WHICH THIS CERTIFICATE MAY BE ISSUED OR MAY PERTAIN, THE INSURANCE AFFORDED BY THE POLICIES DESCRIBED HEREIN IS SUBJECT TO ALL THE TERMS, EXCLUSIONS AND CONDITIONS OF SUCH POLICIES. LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS.";

/**
 * Generate an ACORD 25-style Certificate of Liability Insurance PDF.
 * Returns a Buffer.
 */
export async function generateCoiPdf(data: CoiData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });

    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = 24;
    if (data.formCode && data.formCode !== "acord25") {
      PROPERTY_FORM_RENDERERS[data.formCode](doc, data);
      doc.end();
      return;
    }

    const dateStr = dayjs().format("YYYY/MM/DD");

    doc.font("Helvetica-Bold").fontSize(12).fillColor(C_BLACK);
    doc.text("CERTIFICATE OF LIABILITY INSURANCE", M, y, { width: W * 0.58 });
    doc.font("Helvetica-Bold").fontSize(FS_LABEL);
    doc.text(data.issuedDateLabel, M + W * 0.72, y, { width: W * 0.28, align: "right" });
    doc.font("Helvetica").fontSize(FS_VALUE);
    doc.text(dateStr, M + W * 0.72, y + 10, { width: W * 0.28, align: "right" });
    y += 30;

    y += drawAcord25InformationNotice(doc, M, y, W);

    const insuredText = joinLines(data.insuredName, data.insuredDba && `DBA: ${data.insuredDba}`, formatAddress(data.insuredAddress), data.insuredFein && `FEIN: ${data.insuredFein}`);
    const producerText = producerInformationText(data);
    const topW = W * 0.52;
    const rightW = W - topW;
    const topH = infoBoxHeight(doc, producerText, topW, {
      minHeight: 76,
      fontSize: FS_VALUE,
    });
    drawInfoBox(doc, M, y, topW, topH, "PRODUCER", producerText);
    drawInsurerLegend(doc, M + topW, y, rightW, topH, data);
    y += topH;

    const insuredH = infoBoxHeight(doc, insuredText, W, {
      minHeight: 58,
      fontSize: FS_VALUE,
    });
    drawInfoBox(doc, M, y, W, insuredH, "INSURED'S FULL NAME AND MAILING ADDRESS", insuredText);
    y += insuredH + 10;

    const coveragesTop = y;
    y = drawCoverageSectionHeader(doc, data, y);

    doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
    const noticeH = doc.heightOfString(ACORD_25_COVERAGE_NOTICE, { width: W - 8 }) + 8;
    doc.rect(M, y, W, noticeH).stroke();
    doc.text(ACORD_25_COVERAGE_NOTICE, M + 4, y + 4, {
      width: W - 8,
      height: noticeH - 8,
    });
    y += noticeH;

    y = drawCoverageTable(doc, data.coverages.slice(0, 5), y);
    doc.rect(M, coveragesTop, W, y - coveragesTop).strokeColor(C_BLACK).stroke();

    const descText = data.description ?? "";
    const descMaxH = 58;
    const descOverflows = infoBoxHeight(doc, descText, W, {
      fontSize: FS_VALUE,
    }) > descMaxH;
    const descH = descMaxH;
    drawInfoBox(
      doc,
      M,
      y,
      W,
      descH,
      "DESCRIPTION OF OPERATIONS / LOCATIONS / SPECIAL ITEMS / ADDITIONAL INSURED",
      descOverflows ? "See additional remarks schedule attached" : descText,
      { fontSize: FS_VALUE },
    );
    y += descH;

    const bottomW = W * 0.46;
    const cancelText = "Should any of the above described policies be cancelled before the expiration date thereof, notice will be delivered in accordance with the policy provisions.";
    const holderRequiredH = infoBoxHeight(doc, data.certificateHolder, bottomW, {
      minHeight: 54,
      fontSize: FS_VALUE,
    });
    const holderOverflows = holderRequiredH > HOLDER_BOX_MAX_HEIGHT;
    const cancelRequiredH = infoBoxHeight(doc, cancelText, W - bottomW, {
      minHeight: 54,
      fontSize: FS_VALUE,
    });
    const bottomH = Math.max(
      54,
      Math.min(holderRequiredH, HOLDER_BOX_MAX_HEIGHT),
      Math.min(cancelRequiredH, HOLDER_BOX_MAX_HEIGHT),
    );
    drawInfoBox(
      doc,
      M,
      y,
      bottomW,
      bottomH,
      "CERTIFICATE HOLDER",
      holderOverflows ? "See additional remarks schedule attached" : data.certificateHolder,
      { fontSize: FS_VALUE },
    );
    drawInfoBox(
      doc,
      M + bottomW,
      y,
      W - bottomW,
      bottomH,
      "CANCELLATION",
      cancelText,
      { fontSize: FS_VALUE },
    );
    y += bottomH + 6;

    if (descOverflows || holderOverflows) {
      drawAcord101(doc, data, {
        includeDescription: descOverflows,
        includeHolder: holderOverflows,
      });
    }

    doc.end();
  });
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function drawInfoBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value?: string,
  options: { fontSize?: number; bold?: boolean } = {},
) {
  doc.rect(x, y, w, h).stroke();
  sectionLabel(doc, label, x + 4, y + 4);
  if (!value) return;
  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.fontSize ?? FS_VALUE)
    .fillColor(C_BLACK);
  doc.text(value, x + 5, y + INFO_BOX_VALUE_TOP, {
    width: w - 10,
    height: h - INFO_BOX_VALUE_TOP - INFO_BOX_BOTTOM_PADDING,
  });
}

function infoBoxHeight(
  doc: PDFKit.PDFDocument,
  value: string | undefined,
  width: number,
  options: { minHeight?: number; fontSize?: number; bold?: boolean } = {},
) {
  const textHeight = textBlockHeight(
    doc,
    value,
    width - 10,
    options.fontSize ?? FS_VALUE,
    options.bold ?? false,
  );
  return Math.max(
    options.minHeight ?? 0,
    textHeight + INFO_BOX_VALUE_TOP + INFO_BOX_BOTTOM_PADDING,
  );
}

function producerInformationText(data: CoiData, sanitize = false) {
  const clean = (value: string | undefined) =>
    sanitize ? cleanCertificateValue(value) : value;
  const agency = clean(data.producerAgency);
  const license = clean(data.producerLicense);
  const address = clean(formatAddress(data.producerAddress));
  const contact = clean(data.producerContact);
  const phone = clean(data.producerPhone);
  const email = clean(data.producerEmail);
  return joinLines(
    agency,
    license && `License #: ${license}`,
    address,
    contact && `Contact: ${contact}`,
    phone && `Phone: ${phone}`,
    email && `Email: ${email}`,
  );
}

function drawCoverageSectionHeader(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  y: number,
): number {
  const headerH = 16;
  const coverageW = 138;
  const revisionW = 160;
  const certificateW = W - coverageW - revisionW;
  const certificateNumber = data.certificateNumber?.trim();
  const revisionNumber = data.revisionNumber?.trim();

  doc.rect(M, y, W, headerH).fillAndStroke(C_HEADER_BG, C_BLACK);
  doc
    .moveTo(M + coverageW, y)
    .lineTo(M + coverageW, y + headerH)
    .stroke();
  doc
    .moveTo(M + coverageW + certificateW, y)
    .lineTo(M + coverageW + certificateW, y + headerH)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
  doc.text("COVERAGES", M + 4, y + 4, {
    width: coverageW - 8,
    height: headerH - 6,
    align: "left",
  });
  doc.text(`CERTIFICATE NUMBER:${certificateNumber ? ` ${certificateNumber}` : ""}`, M + coverageW + 4, y + 4, {
    width: certificateW - 8,
    height: headerH - 6,
    align: "center",
  });
  doc.text(`REVISION NUMBER:${revisionNumber ? ` ${revisionNumber}` : ""}`, M + coverageW + certificateW + 4, y + 4, {
    width: revisionW - 8,
    height: headerH - 6,
    align: "center",
  });

  return y + headerH;
}

function drawCertificateNumberBand(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  y: number,
): number {
  const headerH = 16;
  const certificateW = W / 2;
  const certificateNumber = data.certificateNumber?.trim();
  const revisionNumber = data.revisionNumber?.trim();

  doc.rect(M, y, W, headerH).fillAndStroke(C_HEADER_BG, C_BLACK);
  doc
    .moveTo(M + certificateW, y)
    .lineTo(M + certificateW, y + headerH)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
  doc.text(`CERTIFICATE NUMBER:${certificateNumber ? ` ${certificateNumber}` : ""}`, M + 4, y + 4, {
    width: certificateW - 8,
    height: headerH - 6,
    align: "left",
  });
  doc.text(`REVISION NUMBER:${revisionNumber ? ` ${revisionNumber}` : ""}`, M + certificateW + 4, y + 4, {
    width: W - certificateW - 8,
    height: headerH - 6,
    align: "left",
  });

  return y + headerH;
}

function drawAcord25InformationNotice(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
): number {
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  const h = Math.max(
    30,
    doc.heightOfString(ACORD_25_INFORMATION_NOTICE, {
      width: w - 10,
      align: "center",
    }) + 8,
  );
  doc.rect(x, y, w, h).stroke();
  doc.text(ACORD_25_INFORMATION_NOTICE, x + 5, y + 4, {
    width: w - 10,
    height: h - 8,
    align: "center",
  });
  return h;
}

function drawInsurerLegend(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  data: CoiData,
) {
  doc.rect(x, y, w, h).stroke();
  const naicW = 44;
  const headerH = 12;
  doc.moveTo(x, y + headerH).lineTo(x + w, y + headerH).stroke();
  doc.moveTo(x + w - naicW, y).lineTo(x + w - naicW, y + h).stroke();
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  doc.text("INSURER(S) AFFORDING COVERAGE", x + 5, y + 3, {
    width: w - naicW - 10,
    align: "center",
  });
  doc.text("NAIC #", x + w - naicW + 4, y + 3, {
    width: naicW - 8,
    align: "center",
  });

  const rowY = y + headerH;
  const rowH = (h - headerH) / 6;
  for (let i = 0; i < 6; i++) {
    const letter = String.fromCharCode(65 + i);
    const rowTop = rowY + i * rowH;
    if (i > 0) {
      doc.moveTo(x, rowTop).lineTo(x + w, rowTop).stroke();
    }
    doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
    doc.text(`INSURER ${letter}:`, x + 5, rowTop + 2, { width: 50 });
    const insurer = data.insurers.find((ins) => ins.letter === letter);
    if (insurer) {
      doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_BLACK);
      doc.text(insurer.name, x + 56, rowTop + 2, { width: w - naicW - 62, height: rowH - 2 });
      if (insurer.naic) {
        doc.font("Helvetica-Bold").fontSize(FS_LABEL);
        doc.text(insurer.naic, x + w - naicW + 4, rowTop + 2, { width: naicW - 8, align: "center" });
      }
    }
  }
}

function drawCoverageTable(doc: PDFKit.PDFDocument, coverages: CoverageLine[], y: number): number {
  const columns = [
    { key: "type", label: "TYPE OF INSURANCE", w: 132 },
    { key: "letter", label: "CO\nLTR", w: 28 },
    { key: "addlInsr", label: "ADDL\nINSR", w: 24 },
    { key: "subrWvd", label: "SUBR\nWVD", w: 24 },
    { key: "policy", label: "POLICY NUMBER", w: 71 },
    { key: "effective", label: "POLICY EFFECTIVE\nDATE", w: 66 },
    { key: "expiration", label: "POLICY EXPIRATION\nDATE", w: 66 },
    { key: "limits", label: "LIMITS OF LIABILITY", w: W - 132 - 28 - 24 - 24 - 71 - 66 - 66 },
  ];
  const headerH = 24;
  let x = M;
  doc.rect(M, y, W, headerH).fillAndStroke(C_LABEL_BG, C_BLACK);
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  for (const col of columns) {
    doc.rect(x, y, col.w, headerH).stroke();
    doc.text(col.label, x + 3, y + 5, { width: col.w - 6, align: "center" });
    x += col.w;
  }
  y += headerH;

  for (const coverage of coverages) {
    const limitsText = coverage.limits.map((limit) => `${limit.label}: ${limit.value}`).join("\n");
    const typeText = joinLines(
      coverage.type,
      coverage.coverageForm === "claims_made" ? "Claims-made" : coverage.coverageForm === "occurrence" ? "Occurrence" : undefined,
      coverage.typeNotes,
    ) ?? coverage.type;
    const rowH = Math.max(
      34,
      textBlockHeight(doc, typeText, columns[0].w - 6, FS_LABEL, true) + 8,
      textBlockHeight(doc, limitsText, columns[7].w - 6, FS_LABEL, false) + 8,
    );
    x = M;
    for (const col of columns) {
      doc.rect(x, y, col.w, rowH).stroke();
      x += col.w;
    }

    x = M;
    doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
    doc.text(typeText, x + 3, y + 4, { width: columns[0].w - 6, height: rowH - 8 });
    x += columns[0].w;
    doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_BLACK);
    doc.text(coverage.insurerLetter ?? "A", x + 3, y + 4, { width: columns[1].w - 6, align: "center" });
    x += columns[1].w;
    doc.font("Helvetica-Bold").fontSize(FS_LABEL);
    doc.text(coverage.addlInsr ? "Y" : "", x + 3, y + 4, { width: columns[2].w - 6, align: "center" });
    x += columns[2].w;
    doc.text(coverage.subrWvd ? "Y" : "", x + 3, y + 4, { width: columns[3].w - 6, align: "center" });
    x += columns[3].w;
    doc.font("Helvetica").fontSize(FS_LABEL);
    doc.text(coverage.policyNumber ?? "", x + 3, y + 4, { width: columns[4].w - 6, height: rowH - 8 });
    x += columns[4].w;
    doc.text(coverage.effectiveDate ?? "", x + 3, y + 4, { width: columns[5].w - 6, align: "center" });
    x += columns[5].w;
    doc.text(coverage.expirationDate ?? "", x + 3, y + 4, { width: columns[6].w - 6, align: "center" });
    x += columns[6].w;
    doc.font("Helvetica").fontSize(FS_LABEL).fillColor(C_BLACK);
    doc.text(limitsText, x + 3, y + 4, { width: columns[7].w - 6, height: rowH - 8 });
    y += rowH;
  }

  return y;
}

type PropertyFormCode = Exclude<CertificateFormCode, "acord25">;
type PropertyCoverageSection =
  | "property"
  | "inland_marine"
  | "crime"
  | "equipment_breakdown"
  | "other";

type PropertyCoverageRow = {
  section: PropertyCoverageSection;
  lineOfBusiness?: string;
  insurerLetter?: string;
  type: string;
  policyNumber?: string;
  effectiveDate?: string;
  expirationDate?: string;
  coverage?: string;
  limit?: string;
  deductible?: string;
};

const PROPERTY_LOB_CODES = new Set([
  "AGPP", "AGPR", "BOPPR", "CFIRE", "CFRM", "DFIRE", "HOME", "MHOME",
  "PROP", "PROPC", "WIND", "EQ", "FLOOD",
]);
const INLAND_MARINE_LOB_CODES = new Set([
  "CEQFL", "EDP", "EQPFL", "FINEA", "INBR", "INMAR", "INMRC", "INMRP",
  "MTRTK", "SCHPR", "SIGNS", "TRANS",
]);
const CRIME_LOB_CODES = new Set(["CRIM", "CRIME", "FIDTY"]);
const EQUIPMENT_BREAKDOWN_LOB_CODES = new Set(["BANDM"]);
const MARINE_ENERGY_LOB_CODES = new Set(["COMR", "COMAR", "BOAT"]);

export function classifyPropertyCoverageSection(
  coverage: Pick<CertificateCoverageLine, "lineOfBusiness" | "type" | "limits">,
): PropertyCoverageSection {
  const code = coverage.lineOfBusiness?.trim().toUpperCase();
  const text = [coverage.type, ...coverage.limits.map((limit) => limit.label)]
    .join(" ")
    .toLowerCase();
  if ((code && CRIME_LOB_CODES.has(code)) || /\b(?:crime|fidelity)\b/.test(text)) {
    return "crime";
  }
  if (
    (code && EQUIPMENT_BREAKDOWN_LOB_CODES.has(code)) ||
    /\b(?:boiler|machinery|equipment breakdown)\b/.test(text)
  ) {
    return "equipment_breakdown";
  }
  if (
    (code && INLAND_MARINE_LOB_CODES.has(code)) ||
    /\b(?:inland marine|motor truck cargo|equipment floater|fine arts|scheduled property)\b/.test(text)
  ) {
    return "inland_marine";
  }
  if (
    (code && PROPERTY_LOB_CODES.has(code)) ||
    /\b(?:commercial property|property insurance|building coverage|business personal property)\b/.test(text)
  ) {
    return "property";
  }
  return "other";
}

function buildPropertyCoverageRows(data: CoiData): PropertyCoverageRow[] {
  return data.coverages.flatMap((coverage) => {
    const section = classifyPropertyCoverageSection(coverage);
    const labeledDeductibles = coverage.limits
      .filter((term) => /\bdeductible\b/i.test(term.label))
      .map((term) => `${cleanCertificateValue(term.label) ?? "Deductible"}: ${cleanCertificateValue(term.value) ?? ""}`.trim());
    const deductible = uniqueInline([
      cleanCertificateValue(coverage.deductible)
        ? `Deductible: ${cleanCertificateValue(coverage.deductible)}`
        : undefined,
      ...labeledDeductibles,
    ]);
    const limitTerms = coverage.limits.filter((term) => !/\bdeductible\b/i.test(term.label));
    const base = {
      section,
      lineOfBusiness: cleanCertificateValue(coverage.lineOfBusiness),
      insurerLetter: cleanCertificateValue(coverage.insurerLetter),
      type: cleanCertificateValue(coverage.type) ?? "",
      policyNumber: cleanCertificateValue(coverage.policyNumber),
      effectiveDate: cleanCertificateValue(coverage.effectiveDate),
      expirationDate: cleanCertificateValue(coverage.expirationDate),
    };
    if (!limitTerms.length) {
      return [{
        ...base,
        coverage: cleanCertificateValue(coverage.description),
        deductible,
      }];
    }
    return limitTerms.map((term, index) => ({
      ...base,
      coverage: cleanCertificateValue(term.label),
      limit: cleanCertificateValue(term.value),
      deductible: index === 0 ? deductible : undefined,
    }));
  });
}

function cleanCertificateValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text || /^(?:n\/?a|unknown|see policy(?: declarations)?)$/i.test(text)) return undefined;
  return text;
}

function uniqueInline(values: Array<string | undefined>): string | undefined {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanCertificateValue(value);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    result.push(text);
  }
  return result.length ? result.join("; ") : undefined;
}

type CoveredAssetRow = {
  scheduleName: string;
  scheduleDescription?: string;
  kind: CertificateCoveredAssetSchedule["kind"];
  itemLabel: string;
  details?: string;
};

function coveredAssetRows(data: CoiData): CoveredAssetRow[] {
  return (data.coveredAssetSchedules ?? []).flatMap((schedule) => schedule.items.map((item) => ({
    scheduleName: cleanCertificateValue(schedule.name) ?? "Covered asset schedule",
    scheduleDescription: cleanCertificateValue(schedule.description),
    kind: schedule.kind,
    itemLabel: cleanCertificateValue(item.label) ?? "Covered item",
    details: uniqueInline([
      cleanCertificateValue(item.description),
      ...item.values.map((entry) => {
        const label = cleanCertificateValue(entry.label);
        const value = cleanCertificateValue(entry.value);
        return label && value ? `${label}: ${value}` : undefined;
      }),
    ]),
  })));
}

function coveredAssetShortScheduleName(name: string): string {
  return name
    .replace(/^covered\s+auto\s+schedule\s*[-:]?\s*/i, "")
    .replace(/^schedule\s+of\s+/i, "")
    .trim() || name;
}

function uniqueTextLines(lines: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return lines.flatMap((line) => {
    const text = cleanCertificateValue(line);
    if (!text || seen.has(text.toLowerCase())) return [];
    seen.add(text.toLowerCase());
    return [text];
  });
}

function coveredSubjectMatterSummary(
  data: CoiData,
  formCode: PropertyFormCode,
  maxRows = 3,
): {
  label: string;
  text?: string;
  needsCoveredAssetSchedule: boolean;
} {
  const locations = data.propertyInformation?.locations ?? [];
  const locationLines = locations.map((location, index) => joinInline(
    `Location ${location.number ?? index + 1}`,
    uniqueInline([
      cleanCertificateValue(formatAddress(location.address))?.replace(/\n+/g, ", "),
      cleanCertificateValue(location.description),
      location.occupancy ? `Occupancy: ${cleanCertificateValue(location.occupancy)}` : undefined,
    ]) ?? "",
  ));
  const assets = coveredAssetRows(data);
  const assetLines = assets.map((row) => joinInline(
    `${coveredAssetShortScheduleName(row.scheduleName)} - ${row.itemLabel}`,
    row.details ?? "",
  ));
  const vehicleSchedules = (data.coveredAssetSchedules ?? []).filter(
    (schedule) => schedule.kind === "vehicle" && schedule.items.length > 0,
  );
  const vehicleCounts = [...new Set(vehicleSchedules.map((schedule) => schedule.items.length))];
  const vehicleCountLines = vehicleCounts.length === 1
    ? [`Scheduled vehicle count: ${vehicleCounts[0]}`]
    : vehicleSchedules.map((schedule) =>
        `${coveredAssetShortScheduleName(schedule.name)}: ${schedule.items.length} scheduled vehicle${schedule.items.length === 1 ? "" : "s"}`,
      );
  const directPropertyLines = locations.length
    ? []
    : uniqueTextLines([
        data.propertyLocation && `Location: ${data.propertyLocation}`,
        data.propertyDescription,
      ]);
  const vehicleFirst = formCode === "acord30";
  const candidates = uniqueTextLines(vehicleFirst
    ? [...vehicleCountLines, ...assetLines, ...locationLines, ...directPropertyLines]
    : [...locationLines, ...directPropertyLines, ...vehicleCountLines, ...assetLines]);
  const visibleCount = candidates.length > maxRows ? Math.max(1, maxRows - 1) : candidates.length;
  const visible = candidates.slice(0, visibleCount);
  const hidden = candidates.slice(visibleCount);
  const visibleAssetLines = new Set(visible.filter((line) => assetLines.includes(line)));
  const needsCoveredAssetSchedule = assets.length > visibleAssetLines.size;
  if (hidden.length) {
    visible.push(needsCoveredAssetSchedule
      ? "See attached covered autos / property schedule."
      : "See attached structured property location schedule.");
  }

  const hasVehicles = assets.some((row) => row.kind === "vehicle");
  const hasProperty = locations.length > 0 || assets.some(
    (row) => row.kind === "property" || row.kind === "location",
  ) || directPropertyLines.length > 0;
  const label = hasVehicles && hasProperty
    ? "COVERED AUTOS / PROPERTY / LOCATIONS"
    : hasVehicles
      ? "COVERED AUTOS / SCHEDULED VEHICLES"
      : "LOCATION OF PREMISES / DESCRIPTION OF PROPERTY";
  return {
    label,
    text: joinLines(...visible),
    needsCoveredAssetSchedule,
  };
}

const PROPERTY_FORM_RENDERERS: Record<
  PropertyFormCode,
  (doc: PDFKit.PDFDocument, data: CoiData) => void
> = {
  acord24: drawAcord24Form,
  acord27: (doc, data) => drawPropertyEvidenceForm(doc, data, "acord27"),
  acord28: (doc, data) => drawPropertyEvidenceForm(doc, data, "acord28"),
  acord29: (doc, data) => drawPropertyEvidenceForm(doc, data, "acord29"),
  acord30: (doc, data) => drawPropertyEvidenceForm(doc, data, "acord30"),
  acord31: (doc, data) => drawPropertyEvidenceForm(doc, data, "acord31"),
};

const PROPERTY_FORM_TABLE_TITLES: Record<PropertyFormCode, string> = {
  acord24: "PROPERTY COVERAGE DETAILS",
  acord27: "PROPERTY COVERAGES",
  acord28: "COMMERCIAL PROPERTY COVERAGES",
  acord29: "FLOOD COVERAGES",
  acord30: "GARAGE / AUTOMOBILE COVERAGES",
  acord31: "MARINE / ENERGY COVERAGES",
};

function drawPropertyFormHeader(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  formCode: PropertyFormCode,
): number {
  let y = 22;
  const title = CERTIFICATE_FORM_LABELS[formCode] ?? data.title;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(C_BLACK);
  doc.text(title.toUpperCase(), M, y, { width: W * 0.68 });
  doc.font("Helvetica-Bold").fontSize(FS_LABEL);
  doc.text(data.issuedDateLabel, M + W * 0.72, y, { width: W * 0.28, align: "right" });
  doc.font("Helvetica").fontSize(FS_VALUE);
  doc.text(dayjs().format("YYYY/MM/DD"), M + W * 0.72, y + 10, {
    width: W * 0.28,
    align: "right",
  });
  y += 28;
  y += drawAcord25InformationNotice(doc, M, y, W);

  const topW = W * 0.52;
  const producerText = producerInformationText(data, true);
  const headerH = infoBoxHeight(doc, producerText, topW, {
    minHeight: 72,
    fontSize: FS_VALUE,
  });
  drawInfoBox(doc, M, y, topW, headerH, "PRODUCER", producerText);
  drawInsurerLegend(doc, M + topW, y, W - topW, headerH, {
    ...data,
    insurers: data.insurers.map((insurer) => ({
      ...insurer,
      name: cleanCertificateValue(insurer.name) ?? "",
      naic: cleanCertificateValue(insurer.naic),
    })),
  });
  y += headerH;

  const insuredText = joinLines(
    cleanCertificateValue(data.insuredName),
    cleanCertificateValue(data.insuredDba) && `DBA: ${cleanCertificateValue(data.insuredDba)}`,
    cleanCertificateValue(formatAddress(data.insuredAddress)),
    cleanCertificateValue(data.insuredFein) && `FEIN: ${cleanCertificateValue(data.insuredFein)}`,
  );
  drawInfoBox(doc, M, y, W, 54, "NAMED INSURED", insuredText);
  return y + 54;
}

function drawAcord24Form(doc: PDFKit.PDFDocument, data: CoiData) {
  let y = drawPropertyFormHeader(doc, data, "acord24");
  y = drawCoverageSectionHeader(doc, data, y);

  const subjectMatter = coveredSubjectMatterSummary(data, "acord24");
  const premisesRequiredH = infoBoxHeight(doc, subjectMatter.text, W, {
    minHeight: 46,
    fontSize: FS_VALUE,
  });
  const premisesH = Math.min(
    64,
    premisesRequiredH,
  );
  drawInfoBox(
    doc,
    M,
    y,
    W,
    premisesH,
    subjectMatter.label,
    subjectMatter.text,
    { fontSize: FS_VALUE },
  );
  y += premisesH;

  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  const noticeH = Math.max(
    30,
    doc.heightOfString(ACORD_25_COVERAGE_NOTICE, { width: W - 8 }) + 8,
  );
  doc.rect(M, y, W, noticeH).stroke();
  doc.text(ACORD_25_COVERAGE_NOTICE, M + 4, y + 4, {
    width: W - 8,
    height: noticeH - 8,
  });
  y += noticeH;

  y = drawAcord24CoverageMatrix(doc, data, y);
  const remarksH = 44;
  const remarks = cleanCertificateValue(data.description);
  const remarksOverflow = infoBoxHeight(doc, remarks, W, { fontSize: FS_VALUE }) > remarksH;
  drawInfoBox(
    doc,
    M,
    y,
    W,
    remarksH,
    "SPECIAL CONDITIONS / OTHER COVERAGES",
    remarksOverflow ? "See additional remarks schedule attached" : remarks,
    { fontSize: FS_VALUE },
  );
  y += remarksH;
  const holderOverflow = drawPropertyHolderAndCancellation(doc, data, y, "CERTIFICATE HOLDER");

  const overflowCoverageRows = acord24OverflowCoverageRows(data);
  if (overflowCoverageRows.length) {
    drawPropertyCoverageSchedule(doc, data, "acord24", overflowCoverageRows);
  }
  if (
    subjectMatter.needsCoveredAssetSchedule ||
    (premisesRequiredH > premisesH && coveredAssetRows(data).length > 0)
  ) {
    drawCoveredAssetSchedule(doc, data);
  }
  drawPropertyLocationSchedule(doc, data);
  if (remarksOverflow || holderOverflow) {
    drawAcord101(doc, data, {
      includeDescription: remarksOverflow,
      includeHolder: holderOverflow,
    });
  }
}

function acord24OverflowCoverageRows(data: CoiData): PropertyCoverageRow[] {
  const rows = buildPropertyCoverageRows(data);
  const propertyRows = rows.filter((row) => row.section === "property");
  const propertyOverflow = propertyLimitRows(data).length > 10 ? propertyRows : [];
  const detailOverflow = ([
    "inland_marine",
    "crime",
    "equipment_breakdown",
    "other",
  ] as const).flatMap((section) => rows
    .filter((row) => row.section === section)
    .slice(2));
  return [...propertyOverflow, ...detailOverflow];
}

type PropertyLimitKey =
  | "building"
  | "personal_property"
  | "business_income"
  | "extra_expense"
  | "rental_value"
  | "blanket_building"
  | "blanket_personal_property"
  | "blanket_combined"
  | "other";

function propertyLimitKey(label: string): PropertyLimitKey {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const blanket = /\bblanket\b/.test(normalized);
  const building = /\b(?:building|real property)\b/.test(normalized);
  const personal = /\b(?:business personal property|personal property|contents|stock)\b/.test(normalized);
  if (blanket && building && personal) return "blanket_combined";
  if (blanket && building) return "blanket_building";
  if (blanket && personal) return "blanket_personal_property";
  if (/\b(?:business income|business interruption)\b/.test(normalized)) return "business_income";
  if (/\bextra expense\b/.test(normalized)) return "extra_expense";
  if (/\b(?:rental value|rents)\b/.test(normalized)) return "rental_value";
  if (personal) return "personal_property";
  if (building) return "building";
  return "other";
}

function propertyLimitRows(data: CoiData): Array<{ label: string; value?: string }> {
  const rows: Array<{ key: PropertyLimitKey; label: string; value: string }> = [];
  const canonicalLabels: Record<Exclude<PropertyLimitKey, "other">, string> = {
    building: "BUILDING",
    personal_property: "PERSONAL PROPERTY",
    business_income: "BUSINESS INCOME",
    extra_expense: "EXTRA EXPENSE",
    rental_value: "RENTAL VALUE",
    blanket_building: "BLANKET BUILDING",
    blanket_personal_property: "BLANKET PERSONAL PROPERTY",
    blanket_combined: "BLANKET BLDG & PERSONAL PROPERTY",
  };
  const add = (key: PropertyLimitKey, label: string, value: unknown) => {
    const text = cleanCertificateValue(value);
    if (!text) return;
    const rowLabel = key === "other"
      ? cleanCertificateValue(label)?.toUpperCase() ?? "OTHER"
      : canonicalLabels[key];
    if (rows.some(
      (row) => row.label.toLowerCase() === rowLabel.toLowerCase() &&
        row.value.toLowerCase() === text.toLowerCase(),
    )) return;
    rows.push({ key, label: rowLabel, value: text });
  };
  for (const coverage of data.coverages.filter(
    (line) => classifyPropertyCoverageSection(line) === "property",
  )) {
    for (const limit of coverage.limits) {
      if (/\bdeductible\b/i.test(limit.label)) continue;
      add(propertyLimitKey(limit.label), limit.label, limit.value);
    }
  }
  add("blanket_combined", "Blanket limit", data.propertyInformation?.blanketLimit);
  add("business_income", "Business income limit", data.propertyInformation?.businessIncomeLimit);
  add("extra_expense", "Extra expense limit", data.propertyInformation?.extraExpenseLimit);

  const rank: Record<PropertyLimitKey, number> = {
    building: 0,
    personal_property: 1,
    business_income: 2,
    extra_expense: 3,
    rental_value: 4,
    blanket_building: 5,
    blanket_personal_property: 6,
    blanket_combined: 7,
    other: 8,
  };
  return rows
    .map((row, index) => ({ ...row, index }))
    .sort((left, right) => rank[left.key] - rank[right.key] || left.index - right.index)
    .map(({ label, value }) => ({ label, value }));
}

type PropertyDeductibleKey = "building" | "contents" | "earthquake" | "wind" | "flood";

function propertyDeductibles(data: CoiData): {
  values: Partial<Record<PropertyDeductibleKey, string>>;
  other: string[];
} {
  const values: Partial<Record<PropertyDeductibleKey, string>> = {};
  const other: string[] = [];
  const addOther = (label: string, value: string) => {
    const text = `${label}: ${value}`;
    if (!other.some((item) => item.toLowerCase() === text.toLowerCase())) other.push(text);
  };
  const labeledKey = (label: string): PropertyDeductibleKey | undefined => {
    const normalized = label.toLowerCase();
    if (!/deductible/.test(normalized)) return undefined;
    if (/earthquake|\beq\b/.test(normalized)) return "earthquake";
    if (/wind|hurricane/.test(normalized)) return "wind";
    if (/flood/.test(normalized)) return "flood";
    if (/contents|personal property/.test(normalized)) return "contents";
    if (/building/.test(normalized)) return "building";
    return undefined;
  };
  for (const coverage of data.coverages.filter(
    (line) => classifyPropertyCoverageSection(line) === "property",
  )) {
    const labeledDeductibleValues = new Set<string>();
    for (const term of coverage.limits) {
      const value = cleanCertificateValue(term.value);
      if (!value || !/\bdeductible\b/i.test(term.label)) continue;
      labeledDeductibleValues.add(value.toLowerCase());
      const key = labeledKey(term.label);
      if (key && !values[key]) values[key] = value;
      else if (!key) addOther(cleanCertificateValue(term.label) ?? "Deductible", value);
    }
    const value = cleanCertificateValue(coverage.deductible);
    if (!value || labeledDeductibleValues.has(value.toLowerCase())) continue;
    const code = coverage.lineOfBusiness?.toUpperCase();
    const type = coverage.type.toLowerCase();
    const key = code === "EQ" || /\bearthquake\b/.test(type)
      ? "earthquake"
      : code === "WIND" || /\bwind\b/.test(type)
        ? "wind"
        : code === "FLOOD" || /\bflood\b/.test(type)
          ? "flood"
          : undefined;
    if (key && !values[key]) values[key] = value;
    else if (!key) addOther(cleanCertificateValue(coverage.type) ?? "Coverage", value);
  }
  return { values, other };
}

function drawAcord24CoverageMatrix(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  y: number,
): number {
  const widths = [24, 112, 72, 54, 54, 116, 120];
  const headers = [
    "INSR\nLTR",
    "TYPE OF INSURANCE",
    "POLICY NUMBER",
    "EFF DATE",
    "EXP DATE",
    "COVERED PROPERTY",
    "LIMITS",
  ];
  let x = M;
  const headerH = 24;
  doc.rect(M, y, W, headerH).fillAndStroke(C_LABEL_BG, C_BLACK);
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  for (let index = 0; index < widths.length; index += 1) {
    doc.rect(x, y, widths[index], headerH).stroke();
    doc.text(headers[index], x + 2, y + 5, {
      width: widths[index] - 4,
      height: headerH - 6,
      align: "center",
    });
    x += widths[index];
  }
  y += headerH;
  y = drawAcord24PropertySection(doc, data, y, widths);

  const detailRows = buildPropertyCoverageRows(data);
  const sections: Array<{ section: PropertyCoverageSection; label: string }> = [
    { section: "inland_marine", label: "INLAND MARINE" },
    { section: "crime", label: "CRIME" },
    { section: "equipment_breakdown", label: "EQUIPMENT BREAKDOWN" },
    { section: "other", label: "OTHER POLICY" },
  ];
  for (const { section, label } of sections) {
    y = drawAcord24DetailSection(
      doc,
      detailRows.filter((row) => row.section === section),
      label,
      y,
      widths,
    );
  }
  return y;
}

function drawAcord24PropertySection(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  y: number,
  widths: number[],
): number {
  const propertyLines = data.coverages.filter(
    (coverage) => classifyPropertyCoverageSection(coverage) === "property",
  );
  const allRows = propertyLimitRows(data);
  const rows = allRows.slice(0, 10);
  const policy = propertyLines[0];
  const causes = data.propertyInformation?.causesOfLossForm?.toLowerCase() ?? "";
  const causesOfLoss = /\bbasic\b/.test(causes)
    ? "Basic"
    : /\bbroad\b/.test(causes)
      ? "Broad"
      : /\bspecial\b/.test(causes)
        ? "Special"
        : undefined;
  const hasExactCoverage = (code: string, pattern: RegExp) => data.coverages.some((coverage) =>
    coverage.lineOfBusiness?.toUpperCase() === code || pattern.test(coverage.type),
  );
  const includedPerils = [
    hasExactCoverage("EQ", /\bearthquake\b/i) ? "Earthquake" : undefined,
    hasExactCoverage("WIND", /\bwind\b/i) ? "Wind" : undefined,
    hasExactCoverage("FLOOD", /\bflood\b/i) ? "Flood" : undefined,
  ].filter((value): value is string => Boolean(value));
  const deductibles = propertyDeductibles(data);
  const typeText = joinLines(
    "PROPERTY",
    causesOfLoss && `Causes of loss: ${causesOfLoss}`,
    includedPerils.length ? `Included perils: ${includedPerils.join(", ")}` : undefined,
    deductibles.values.building && `Building deductible: ${deductibles.values.building}`,
    deductibles.values.contents && `Contents deductible: ${deductibles.values.contents}`,
    deductibles.values.earthquake && `Earthquake deductible: ${deductibles.values.earthquake}`,
    deductibles.values.wind && `Wind deductible: ${deductibles.values.wind}`,
    deductibles.values.flood && `Flood deductible: ${deductibles.values.flood}`,
    ...deductibles.other.slice(0, 2),
    data.propertyInformation?.coinsurancePercent !== undefined
      ? `Coinsurance: ${formatCoinsurance(data.propertyInformation.coinsurancePercent)}`
      : undefined,
    data.propertyInformation?.valuationMethod
      ? `Valuation: ${displayPropertyValue(data.propertyInformation.valuationMethod)}`
      : undefined,
    allRows.length > rows.length ? "See attached coverage details schedule" : undefined,
  );
  const hasPropertyData = propertyLines.length > 0 || rows.length > 0 || typeText !== "PROPERTY";
  if (!hasPropertyData) return y;

  const positions = columnPositions(widths);
  const rowCount = Math.max(rows.length, 1);
  const typeHeight = textBlockHeight(doc, typeText, widths[1] - 6, FS_SMALL, true) + 8;
  const detailRowRequiredH = rows.reduce(
    (height, row) => Math.max(
      height,
      textBlockHeight(doc, row.label, widths[5] - 6, FS_SMALL, false) + 6,
      textBlockHeight(doc, row.value, widths[6] - 6, FS_SMALL, true) + 6,
    ),
    13,
  );
  const sectionH = Math.max(18, rows.length * detailRowRequiredH, typeHeight);
  const detailRowH = sectionH / rowCount;
  doc.rect(M, y, W, sectionH).stroke();
  for (const position of positions.slice(1, -1)) {
    doc.moveTo(position, y).lineTo(position, y + sectionH).stroke();
  }
  const detailX = positions[5];
  for (let index = 1; index < rows.length; index += 1) {
    doc.moveTo(detailX, y + index * detailRowH).lineTo(M + W, y + index * detailRowH).stroke();
  }

  doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_BLACK);
  doc.text(cleanCertificateValue(policy?.insurerLetter) ?? "", positions[0] + 2, y + 4, {
    width: widths[0] - 4,
    align: "center",
  });
  doc.font("Helvetica-Bold").fontSize(FS_SMALL);
  doc.text(typeText ?? "PROPERTY", positions[1] + 3, y + 4, {
    width: widths[1] - 6,
    height: sectionH - 8,
  });
  doc.font("Helvetica").fontSize(FS_SMALL);
  doc.text(cleanCertificateValue(policy?.policyNumber) ?? "", positions[2] + 2, y + 4, {
    width: widths[2] - 4,
    align: "center",
  });
  doc.text(cleanCertificateValue(policy?.effectiveDate) ?? "", positions[3] + 2, y + 4, {
    width: widths[3] - 4,
    align: "center",
  });
  doc.text(cleanCertificateValue(policy?.expirationDate) ?? "", positions[4] + 2, y + 4, {
    width: widths[4] - 4,
    align: "center",
  });
  rows.forEach((row, index) => {
    const rowY = y + index * detailRowH;
    doc.font("Helvetica").fontSize(FS_SMALL);
    doc.text(row.label, positions[5] + 3, rowY + 3, {
      width: widths[5] - 6,
      height: detailRowH - 4,
    });
    doc.font("Helvetica-Bold").fontSize(FS_SMALL);
    doc.text(row.value ?? "", positions[6] + 3, rowY + 3, {
      width: widths[6] - 6,
      height: detailRowH - 4,
      align: "right",
    });
  });
  return y + sectionH;
}

function drawAcord24DetailSection(
  doc: PDFKit.PDFDocument,
  rows: PropertyCoverageRow[],
  label: string,
  y: number,
  widths: number[],
): number {
  if (!rows.length) return y;
  const visibleRows = rows.slice(0, 2);
  const positions = columnPositions(widths);
  for (const [index, row] of visibleRows.entries()) {
    const detail = index === visibleRows.length - 1 && rows.length > visibleRows.length
      ? joinLines(row.coverage, "See attached coverage details schedule")
      : row.coverage;
    const type = index === 0 ? joinLines(label, row.type) ?? label : row.type;
    const limit = joinLines(row.limit, row.deductible) ?? "";
    const rowH = Math.max(
      18,
      textBlockHeight(doc, type, widths[1] - 6, FS_SMALL, true) + 6,
      textBlockHeight(doc, detail, widths[5] - 6, FS_SMALL, false) + 6,
      textBlockHeight(doc, limit, widths[6] - 6, FS_SMALL, true) + 6,
    );
    let x = M;
    for (const width of widths) {
      doc.rect(x, y, width, rowH).stroke();
      x += width;
    }
    doc.font("Helvetica").fontSize(FS_SMALL).fillColor(C_BLACK);
    doc.text(row.insurerLetter ?? "", positions[0] + 2, y + 4, {
      width: widths[0] - 4,
      align: "center",
    });
    doc.font("Helvetica-Bold").fontSize(FS_SMALL);
    doc.text(type, positions[1] + 3, y + 3, {
      width: widths[1] - 6,
      height: rowH - 5,
    });
    doc.font("Helvetica").fontSize(FS_SMALL);
    doc.text(row.policyNumber ?? "", positions[2] + 2, y + 4, {
      width: widths[2] - 4,
      align: "center",
    });
    doc.text(row.effectiveDate ?? "", positions[3] + 2, y + 4, {
      width: widths[3] - 4,
      align: "center",
    });
    doc.text(row.expirationDate ?? "", positions[4] + 2, y + 4, {
      width: widths[4] - 4,
      align: "center",
    });
    doc.text(detail ?? "", positions[5] + 3, y + 3, {
      width: widths[5] - 6,
      height: rowH - 5,
    });
    doc.font("Helvetica-Bold").fontSize(FS_SMALL);
    doc.text(limit, positions[6] + 3, y + 3, {
      width: widths[6] - 6,
      height: rowH - 5,
      align: "right",
    });
    y += rowH;
  }
  return y;
}

function columnPositions(widths: number[]): number[] {
  const positions = [M];
  for (const width of widths) positions.push(positions[positions.length - 1] + width);
  return positions;
}

function drawPropertyEvidenceForm(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  formCode: Exclude<PropertyFormCode, "acord24">,
) {
  let y = drawPropertyFormHeader(doc, data, formCode);
  y = drawCertificateNumberBand(doc, data, y);
  const subjectMatter = coveredSubjectMatterSummary(data, formCode, 4);
  const summary = propertyFormSummary(data, formCode);
  const summaryRequiredH = infoBoxHeight(doc, summary, W, {
    minHeight: 54,
    fontSize: FS_VALUE,
  });
  const summaryOverflow = summaryRequiredH > 100;
  const summaryH = Math.min(summaryRequiredH, 100);
  drawInfoBox(
    doc,
    M,
    y,
    W,
    summaryH,
    propertySummaryLabel(formCode),
    summaryOverflow ? "See additional property information schedule attached" : summary,
    { fontSize: FS_VALUE },
  );
  y += summaryH;

  const rows = orderPropertyCoverageRows(buildPropertyCoverageRows(data), formCode);
  const firstPage = drawDetailedCoverageTable(doc, rows, formCode, y, 610);
  y = firstPage.y + 6;
  const remarks = cleanCertificateValue(data.description);
  const remarksH = 48;
  const remarksOverflow = infoBoxHeight(doc, remarks, W, { fontSize: FS_VALUE }) > remarksH;
  drawInfoBox(
    doc,
    M,
    y,
    W,
    remarksH,
    "REMARKS / SPECIAL CONDITIONS",
    remarksOverflow ? "See additional remarks schedule attached" : remarks,
    { fontSize: FS_VALUE },
  );
  y += remarksH;
  const holderLabel = formCode === "acord27" || formCode === "acord28" || formCode === "acord29"
    ? "ADDITIONAL INTEREST"
    : "CERTIFICATE HOLDER";
  const holderOverflow = drawPropertyHolderAndCancellation(doc, data, y, holderLabel);

  if (firstPage.consumed < rows.length) {
    drawPropertyCoverageSchedule(doc, data, formCode, rows.slice(firstPage.consumed));
  }
  if (
    subjectMatter.needsCoveredAssetSchedule ||
    (summaryOverflow && coveredAssetRows(data).length > 0)
  ) {
    drawCoveredAssetSchedule(doc, data);
  }
  drawPropertyLocationSchedule(doc, data);
  if (remarksOverflow || holderOverflow || summaryOverflow) {
    drawAcord101(doc, data, {
      includeDescription: remarksOverflow,
      includeHolder: holderOverflow,
      includeProperty: summaryOverflow,
    });
  }
}

function propertySummaryLabel(formCode: PropertyFormCode): string {
  if (formCode === "acord29") return "FLOOD / PROPERTY INFORMATION";
  if (formCode === "acord30") return "GARAGE LOCATION / OPERATIONS";
  if (formCode === "acord31") return "MARINE / ENERGY SUBJECT MATTER";
  return "PROPERTY / INTEREST INFORMATION";
}

function propertyFormSummary(data: CoiData, formCode: PropertyFormCode): string | undefined {
  const subjectMatter = coveredSubjectMatterSummary(data, formCode, 4);
  const property = data.propertyInformation;
  return joinLines(
    subjectMatter.text,
    (formCode === "acord27" || formCode === "acord28") && property?.causesOfLossForm
      ? `Causes of loss: ${displayPropertyValue(property.causesOfLossForm)}`
      : undefined,
    (formCode === "acord27" || formCode === "acord28") && property?.valuationMethod
      ? `Valuation: ${displayPropertyValue(property.valuationMethod)}`
      : undefined,
    (formCode === "acord27" || formCode === "acord28") && property?.coinsurancePercent !== undefined
      ? `Coinsurance: ${formatCoinsurance(property.coinsurancePercent)}`
      : undefined,
    formCode === "acord29" && data.floodZone ? `Flood zone: ${data.floodZone}` : undefined,
    formCode === "acord29" && data.floodProgram ? `Flood program: ${data.floodProgram}` : undefined,
  );
}

function orderPropertyCoverageRows(
  rows: PropertyCoverageRow[],
  formCode: PropertyFormCode,
): PropertyCoverageRow[] {
  const rank = (row: PropertyCoverageRow) => {
    const code = row.lineOfBusiness?.toUpperCase();
    if (formCode === "acord29") {
      if (code === "FLOOD" || /\bflood\b/i.test(row.type)) return 0;
      if (row.section === "property") return 1;
      return 2;
    }
    if (formCode === "acord30") {
      if (code === "GARAG") return 0;
      if (["AUTO", "AUTOB", "AUTOP", "TRUCK"].includes(code ?? "")) return 1;
      if (code === "PHYS" || /physical damage/i.test(row.type)) return 2;
      return 3;
    }
    if (formCode === "acord31") {
      if (code && MARINE_ENERGY_LOB_CODES.has(code)) return 0;
      if (row.section === "inland_marine") return 1;
      return 2;
    }
    if (row.section === "property") return 0;
    if (row.section === "inland_marine") return 1;
    return 2;
  };
  return rows
    .map((row, index) => ({ row, index, rank: rank(row) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ row }) => row);
}

function propertySectionLabel(row: PropertyCoverageRow, formCode: PropertyFormCode): string {
  const code = row.lineOfBusiness?.toUpperCase();
  if (formCode === "acord30") {
    if (code === "GARAG") return "GARAGE";
    if (["AUTO", "AUTOB", "AUTOP", "TRUCK"].includes(code ?? "")) return "AUTOMOBILE";
    if (code === "PHYS" || /physical damage/i.test(row.type)) return "PHYSICAL DAMAGE";
  }
  if (formCode === "acord29" && (code === "FLOOD" || /\bflood\b/i.test(row.type))) {
    return "FLOOD";
  }
  if (formCode === "acord31") {
    if (code && MARINE_ENERGY_LOB_CODES.has(code)) return "MARINE / ENERGY";
    if (row.section === "inland_marine") return "INLAND MARINE";
  }
  return {
    property: "PROPERTY",
    inland_marine: "INLAND MARINE",
    crime: "CRIME",
    equipment_breakdown: "EQUIPMENT BREAKDOWN",
    other: "OTHER POLICY",
  }[row.section];
}

function drawDetailedCoverageTable(
  doc: PDFKit.PDFDocument,
  rows: PropertyCoverageRow[],
  formCode: PropertyFormCode,
  y: number,
  maxY: number,
): { y: number; consumed: number } {
  if (!rows.length) return { y, consumed: 0 };
  const widths = [28, 95, 70, 55, 55, 132, 117];
  const headers = ["INSR\nLTR", "TYPE / SECTION", "POLICY NUMBER", "EFF DATE", "EXP DATE", "COVERAGE", "LIMIT / DEDUCTIBLE"];
  y = drawDetailedCoverageHeader(doc, y, widths, headers, PROPERTY_FORM_TABLE_TITLES[formCode]);
  let consumed = 0;
  for (const row of rows) {
    const cells = coverageTableCells(row, formCode);
    const rowH = detailedCoverageRowHeight(doc, cells, widths);
    if (y + rowH > maxY) break;
    drawDetailedCoverageRow(doc, y, rowH, widths, cells);
    y += rowH;
    consumed += 1;
  }
  return { y, consumed };
}

function drawDetailedCoverageHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  widths: number[],
  headers: string[],
  title: string,
): number {
  const titleH = 15;
  doc.rect(M, y, W, titleH).fillAndStroke(C_HEADER_BG, C_BLACK);
  doc.font("Helvetica-Bold").fontSize(FS_LABEL).fillColor(C_BLACK);
  doc.text(title, M + 4, y + 4, { width: W - 8, align: "left" });
  y += titleH;
  const headerH = 24;
  let x = M;
  doc.rect(M, y, W, headerH).fillAndStroke(C_LABEL_BG, C_BLACK);
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  headers.forEach((header, index) => {
    doc.rect(x, y, widths[index], headerH).stroke();
    doc.text(header, x + 2, y + 5, {
      width: widths[index] - 4,
      height: headerH - 6,
      align: "center",
    });
    x += widths[index];
  });
  return y + headerH;
}

function coverageTableCells(row: PropertyCoverageRow, formCode: PropertyFormCode): string[] {
  return [
    row.insurerLetter ?? "",
    joinLines(propertySectionLabel(row, formCode), row.type) ?? "",
    row.policyNumber ?? "",
    row.effectiveDate ?? "",
    row.expirationDate ?? "",
    row.coverage ?? "",
    joinLines(row.limit, row.deductible) ?? "",
  ];
}

function detailedCoverageRowHeight(
  doc: PDFKit.PDFDocument,
  cells: string[],
  widths: number[],
): number {
  return Math.max(
    26,
    ...cells.map((cell, index) => textBlockHeight(doc, cell, widths[index] - 6, FS_SMALL, false) + 8),
  );
}

function drawDetailedCoverageRow(
  doc: PDFKit.PDFDocument,
  y: number,
  height: number,
  widths: number[],
  cells: string[],
) {
  let x = M;
  cells.forEach((cell, index) => {
    doc.rect(x, y, widths[index], height).stroke();
    doc.font(index === 1 || index === 6 ? "Helvetica-Bold" : "Helvetica")
      .fontSize(FS_SMALL)
      .fillColor(C_BLACK);
    doc.text(cell, x + 3, y + 4, {
      width: widths[index] - 6,
      height: height - 8,
      align: index === 0 || index === 3 || index === 4 ? "center" : index === 6 ? "right" : "left",
    });
    x += widths[index];
  });
}

function drawPropertyHolderAndCancellation(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  y: number,
  holderLabel: string,
): boolean {
  const holderText = joinLines(
    cleanCertificateValue(data.interestHolder ?? data.certificateHolder),
    cleanCertificateValue(data.interestHolderRelationship) && `Interest: ${cleanCertificateValue(data.interestHolderRelationship)}`,
  );
  const leftW = W * 0.46;
  const height = 70;
  const overflow = infoBoxHeight(doc, holderText, leftW, { fontSize: FS_VALUE }) > height;
  drawInfoBox(
    doc,
    M,
    y,
    leftW,
    height,
    holderLabel,
    overflow ? "See additional remarks schedule attached" : holderText,
  );
  drawInfoBox(
    doc,
    M + leftW,
    y,
    W - leftW,
    height,
    "CANCELLATION / AUTHORIZED REPRESENTATIVE",
    "Should any policy be cancelled before its expiration date, notice will be delivered in accordance with the policy provisions.\n\nAUTHORIZED REPRESENTATIVE",
    { fontSize: FS_VALUE },
  );
  return overflow;
}

function drawPropertyCoverageSchedule(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  formCode: PropertyFormCode,
  rows: PropertyCoverageRow[],
) {
  let remaining = rows;
  let page = 1;
  while (remaining.length) {
    const y = drawAdditionalScheduleHeader(
      doc,
      data,
      page === 1 ? "PROPERTY COVERAGE DETAILS SCHEDULE" : "PROPERTY COVERAGE DETAILS SCHEDULE - CONTINUED",
      page,
    );
    const result = drawDetailedCoverageTable(doc, remaining, formCode, y, PAGE_H - M);
    if (!result.consumed) break;
    remaining = remaining.slice(result.consumed);
    page += 1;
  }
}

function drawCoveredAssetSchedule(doc: PDFKit.PDFDocument, data: CoiData) {
  let remaining = coveredAssetRows(data);
  if (!remaining.length) return;
  let page = 1;
  const widths = [150, 112, 290];
  const headers = ["SOURCE SCHEDULE", "COVERED ITEM", "DECLARATION DETAILS"];
  while (remaining.length) {
    let y = drawAdditionalScheduleHeader(
      doc,
      data,
      page === 1
        ? "COVERED AUTOS / PROPERTY SCHEDULE"
        : "COVERED AUTOS / PROPERTY SCHEDULE - CONTINUED",
      page,
    );
    y = drawLocationHeader(doc, y, widths, headers);
    let consumed = 0;
    for (const row of remaining) {
      const cells = [
        joinLines(row.scheduleName, row.scheduleDescription) ?? row.scheduleName,
        row.itemLabel,
        row.details ?? "",
      ];
      const rowH = Math.max(
        28,
        ...cells.map((cell, index) =>
          textBlockHeight(doc, cell, widths[index] - 6, FS_SMALL, index === 1) + 12,
        ),
      );
      if (y + rowH > PAGE_H - M) break;
      drawDetailedCoverageRow(doc, y, rowH, widths, cells);
      y += rowH;
      consumed += 1;
    }
    if (!consumed) break;
    remaining = remaining.slice(consumed);
    page += 1;
  }
}

function drawAdditionalScheduleHeader(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  title: string,
  page: number,
): number {
  doc.addPage({ size: "LETTER", margin: 0 });
  let y = 26;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(C_BLACK);
  doc.text(title, M, y, { width: W - 80 });
  doc.font("Helvetica").fontSize(FS_LABEL);
  doc.text(`PAGE ${page}`, M + W - 80, y + 2, { width: 80, align: "right" });
  y += 24;
  y = drawCertificateNumberBand(doc, data, y);
  drawInfoBox(doc, M, y, W, 40, "NAMED INSURED", cleanCertificateValue(data.insuredName));
  return y + 44;
}

function drawPropertyLocationSchedule(doc: PDFKit.PDFDocument, data: CoiData) {
  const locations = data.propertyInformation?.locations ?? [];
  if (!locations.length) return;
  let remaining = locations;
  let page = 1;
  const widths = [28, 150, 110, 62, 54, 60, 88];
  const headers = [
    "LOC #",
    "ADDRESS / DESCRIPTION",
    "OCCUPANCY / CONSTRUCTION",
    "SCHEDULED\nBUILDING VALUE",
    "SCHEDULED\nCONTENTS VALUE",
    "SCHEDULED\nBUSINESS INCOME VALUE",
    "PROTECTION",
  ];
  while (remaining.length) {
    let y = drawAdditionalScheduleHeader(
      doc,
      data,
      page === 1 ? "STRUCTURED PROPERTY LOCATION SCHEDULE" : "STRUCTURED PROPERTY LOCATION SCHEDULE - CONTINUED",
      page,
    );
    y = drawLocationHeader(doc, y, widths, headers);
    let consumed = 0;
    for (const [index, location] of remaining.entries()) {
      const cells = propertyLocationCells(location, index);
      const rowH = Math.max(
        30,
        ...cells.map((cell, cellIndex) => textBlockHeight(doc, cell, widths[cellIndex] - 6, FS_SMALL, cellIndex === 6) + 14),
      );
      if (y + rowH > PAGE_H - M) break;
      drawDetailedCoverageRow(doc, y, rowH, widths, cells);
      y += rowH;
      consumed += 1;
    }
    if (!consumed) break;
    remaining = remaining.slice(consumed);
    page += 1;
  }
}

function drawLocationHeader(
  doc: PDFKit.PDFDocument,
  y: number,
  widths: number[],
  headers: string[],
): number {
  const headerH = 30;
  let x = M;
  doc.rect(M, y, W, headerH).fillAndStroke(C_LABEL_BG, C_BLACK);
  doc.font("Helvetica-Bold").fontSize(5.25).fillColor(C_BLACK);
  headers.forEach((header, index) => {
    doc.rect(x, y, widths[index], headerH).stroke();
    doc.text(header, x + 2, y + 5, {
      width: widths[index] - 4,
      height: headerH - 6,
      align: "center",
    });
    x += widths[index];
  });
  return y + headerH;
}

function propertyLocationCells(location: CertificatePropertyLocation, index: number): string[] {
  return [
    String(location.number ?? index + 1),
    joinLines(
      cleanCertificateValue(formatAddress(location.address))?.replace(/\n+/g, ", "),
      cleanCertificateValue(location.description),
    ) ?? "",
    joinLines(
      location.occupancy ? `Occupancy: ${location.occupancy}` : undefined,
      location.constructionType ? `Construction: ${location.constructionType}` : undefined,
      location.yearBuilt !== undefined ? `Built: ${location.yearBuilt}` : undefined,
      location.squareFootage !== undefined
        ? `Area: ${location.squareFootage.toLocaleString("en-US")} sq ft`
        : undefined,
    ) ?? "",
    cleanCertificateValue(location.buildingValue) ?? "",
    cleanCertificateValue(location.contentsValue) ?? "",
    cleanCertificateValue(location.businessIncomeValue) ?? "",
    joinLines(
      location.protectionClass ? `PC ${location.protectionClass}` : undefined,
      location.sprinklered !== undefined ? `Sprinkler: ${location.sprinklered ? "Yes" : "No"}` : undefined,
      location.alarmType ? `Alarm: ${location.alarmType}` : undefined,
    ) ?? "",
  ];
}

export function formatCertificatePropertyInformation(
  data: CoiData,
  formCode = data.formCode ?? "acord24",
): string {
  const property = data.propertyInformation;
  const coverageTerms = [
    property?.causesOfLossForm
      ? `Causes of loss: ${displayPropertyValue(property.causesOfLossForm)}`
      : undefined,
    property?.valuationMethod
      ? `Valuation: ${displayPropertyValue(property.valuationMethod)}`
      : undefined,
    property?.coinsurancePercent !== undefined
      ? `Coinsurance: ${formatCoinsurance(property.coinsurancePercent)}`
      : undefined,
  ].filter(Boolean).join(" | ");
  const declarationLimits = [
    property?.blanketLimit ? `Blanket limit: ${property.blanketLimit}` : undefined,
    property?.businessIncomeLimit ? `Business income limit: ${property.businessIncomeLimit}` : undefined,
    property?.extraExpenseLimit ? `Extra expense limit: ${property.extraExpenseLimit}` : undefined,
  ].filter(Boolean).join(" | ");
  const locations = property?.locations.flatMap((location, index) => {
    const address = formatAddress(location.address).replace(/\n+/g, ", ");
    const heading = joinInline(`Location ${location.number ?? index + 1}`, address);
    const values = [
      location.buildingValue ? `Scheduled building value: ${location.buildingValue}` : undefined,
      location.contentsValue ? `Scheduled contents value: ${location.contentsValue}` : undefined,
      location.businessIncomeValue
        ? `Scheduled business income value: ${location.businessIncomeValue}`
        : undefined,
    ].filter(Boolean).join(" | ");
    const characteristics = [
      location.occupancy ? `Occupancy: ${location.occupancy}` : undefined,
      location.constructionType ? `Construction: ${location.constructionType}` : undefined,
      location.yearBuilt !== undefined ? `Built: ${location.yearBuilt}` : undefined,
      location.squareFootage !== undefined
        ? `Area: ${location.squareFootage.toLocaleString("en-US")} sq ft`
        : undefined,
    ].filter(Boolean).join(" | ");
    const protections = [
      location.protectionClass ? `Protection class: ${location.protectionClass}` : undefined,
      location.sprinklered !== undefined
        ? `Sprinklered: ${location.sprinklered ? "Yes" : "No"}`
        : undefined,
      location.alarmType ? `Alarm: ${location.alarmType}` : undefined,
    ].filter(Boolean).join(" | ");
    return [heading, location.description, values, characteristics, protections].filter(
      (line): line is string => Boolean(line),
    );
  }) ?? [];
  const assets = coveredAssetRows(data).map((row) => joinInline(
    `${row.scheduleName} - ${row.itemLabel}`,
    row.details ?? "",
  ));

  return joinLines(
    data.propertyDescription,
    coverageTerms || undefined,
    declarationLimits || undefined,
    ...locations,
    ...assets,
    !locations.length && data.propertyLocation ? `Location: ${data.propertyLocation}` : undefined,
    formCode === "acord29" && data.floodZone ? `Flood zone: ${data.floodZone}` : undefined,
    formCode === "acord29" && data.floodProgram ? `Flood program: ${data.floodProgram}` : undefined,
  ) ?? "";
}

function joinInline(label: string, value: string): string {
  return value ? `${label}: ${value}` : label;
}

function displayPropertyValue(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCoinsurance(value: number | string): string {
  const text = String(value).trim();
  return text.endsWith("%") ? text : `${text}%`;
}

function drawAcord101(
  doc: PDFKit.PDFDocument,
  data: CoiData,
  options: {
    includeDescription: boolean;
    includeHolder: boolean;
    includeProperty?: boolean;
  },
) {
  const remarks = joinLines(
    options.includeHolder && data.certificateHolder
      ? `CERTIFICATE HOLDER\n${data.certificateHolder}`
      : undefined,
    options.includeDescription && data.description
      ? `DESCRIPTION OF OPERATIONS / LOCATIONS / SPECIAL ITEMS\n${data.description}`
      : undefined,
    options.includeProperty
      ? `PROPERTY INFORMATION\n${formatCertificatePropertyInformation(data)}`
      : undefined,
  );
  const remarksY = 102;
  const remarksHeight = PAGE_H - remarksY - M;
  const chunks = paginateText(
    doc,
    remarks ?? "",
    W - 10,
    FS_VALUE,
    false,
    remarksHeight - INFO_BOX_VALUE_TOP - INFO_BOX_BOTTOM_PADDING,
  );

  for (const [index, chunk] of chunks.entries()) {
    doc.addPage({ size: "LETTER", margin: 0 });
    let y = 30;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(C_BLACK);
    doc.text(
      index === 0 ? "ADDITIONAL REMARKS SCHEDULE" : "ADDITIONAL REMARKS SCHEDULE — CONTINUED",
      M,
      y,
      { width: W },
    );
    y += 24;
    drawInfoBox(doc, M, y, W, 42, "NAMED INSURED", data.insuredName);
    drawInfoBox(doc, M, remarksY, W, remarksHeight, "ADDITIONAL REMARKS", chunk);
  }
}

function paginateText(
  doc: PDFKit.PDFDocument,
  value: string,
  width: number,
  fontSize: number,
  bold: boolean,
  maxHeight: number,
) {
  const pages: string[] = [];
  let remaining = value.trim();
  while (remaining) {
    if (textBlockHeight(doc, remaining, width, fontSize, bold) <= maxHeight) {
      pages.push(remaining);
      break;
    }

    let low = 1;
    let high = remaining.length;
    let fit = 1;
    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2);
      if (textBlockHeight(doc, remaining.slice(0, midpoint), width, fontSize, bold) <= maxHeight) {
        fit = midpoint;
        low = midpoint + 1;
      } else {
        high = midpoint - 1;
      }
    }

    const newlineBreak = remaining.lastIndexOf("\n", fit);
    const spaceBreak = remaining.lastIndexOf(" ", fit);
    const preferredBreak = Math.max(newlineBreak, spaceBreak);
    const cut = preferredBreak > fit * 0.6 ? preferredBreak + 1 : fit;
    pages.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return pages;
}

function textBlockHeight(
  doc: PDFKit.PDFDocument,
  value: string | undefined,
  width: number,
  fontSize: number,
  bold: boolean,
): number {
  if (!value) return 0;
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
  return doc.heightOfString(value, { width });
}

function sectionLabel(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font("Helvetica-Bold").fontSize(FS_SMALL).fillColor(C_BLACK);
  doc.text(text, x, y);
}
