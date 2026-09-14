import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeDeclarationValue } from "./declarationFacts";
import { clientIdentity } from "./clientProfile";
import { scheduleCompanyResearch } from "../companyResearch";
import {
  irsEntityTypeLabel,
  normalizeIrsEntityType,
  type IrsEntityType,
} from "./entityTypes";
import { normalizeExtractedDate } from "./valueNormalization";

dayjs.extend(customParseFormat);

type DeclarationFactDoc = {
  _creationTime?: number;
  orgId: Id<"organizations">;
  policyId: Id<"policies">;
  fieldPath: string;
  fieldGroup: string;
  displayValue: string;
  normalizedValue: string;
  structuredValue?: unknown;
  valueKind: "string" | "number" | "date" | "money" | "address" | "list" | "unknown";
  sourceNodeIds?: string[];
  sourceSpanIds?: string[];
  effectiveDate?: string;
  expirationDate?: string;
  policyYear?: number;
  observedAt: number;
  active: boolean;
};

type OrgMailingAddress = {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  formatted?: string;
};

function stableValueString(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableValueString(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableValueString(entry)}`).join(",")}}`;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return stableValueString(left) === stableValueString(right);
}

export type EditableOrganizationProfile = {
  mailingAddress: OrgMailingAddress;
  entityType: IrsEntityType | "";
  fein: string;
  businessNumber: string;
  operationsDescription: string;
};

function profileValue(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return cleanText((value as { value?: unknown }).value) ?? "";
}

function profileAddress(value: unknown): OrgMailingAddress | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return compactAddress((value as { value?: unknown }).value);
}

export function resolveEffectiveOrganizationProfile(
  org: Record<string, unknown>,
): EditableOrganizationProfile {
  const overrides = org.profileOverrides && typeof org.profileOverrides === "object"
    ? org.profileOverrides as Partial<EditableOrganizationProfile> & { taxId?: string }
    : undefined;
  const facts = org.profileFacts && typeof org.profileFacts === "object"
    ? org.profileFacts as Record<string, unknown>
    : {};
  return {
    mailingAddress: overrides?.mailingAddress !== undefined
      ? compactAddress(overrides.mailingAddress) ?? {}
      : profileAddress(facts.mailingAddress) ?? compactAddress(org.mailingAddress) ?? {},
    entityType:
      normalizeIrsEntityType(overrides?.entityType ?? profileValue(facts.entityType)),
    fein: overrides?.fein !== undefined || overrides?.taxId !== undefined
      ? cleanText(overrides.fein ?? overrides.taxId) ?? ""
      : profileValue(facts.fein) || profileValue(facts.taxId),
    businessNumber: overrides?.businessNumber !== undefined
      ? cleanText(overrides.businessNumber) ?? ""
      : profileValue(facts.businessNumber),
    operationsDescription:
      overrides?.operationsDescription ?? profileValue(facts.operationsDescription),
  };
}

export function effectiveOrganizationProfileFacts(
  org: Record<string, unknown>,
): Record<string, any> | undefined {
  const facts = org.profileFacts && typeof org.profileFacts === "object"
    ? org.profileFacts as Record<string, unknown>
    : {};
  const profile = resolveEffectiveOrganizationProfile(org);
  const effective = {
    ...Object.fromEntries(Object.entries(facts).filter(([key]) => ![
      "mailingAddress", "entityType", "fein", "taxId", "businessNumber", "operationsDescription",
    ].includes(key))),
    ...(Object.keys(profile.mailingAddress).length > 0
      ? { mailingAddress: { value: profile.mailingAddress } }
      : {}),
    ...(profile.entityType
      ? { entityType: { value: irsEntityTypeLabel(profile.entityType) } }
      : {}),
    ...(profile.fein ? { fein: { value: profile.fein }, taxId: { value: profile.fein } } : {}),
    ...(profile.businessNumber
      ? { businessNumber: { value: profile.businessNumber } }
      : {}),
    ...(profile.operationsDescription
      ? { operationsDescription: { value: profile.operationsDescription } }
      : {}),
  };
  return Object.keys(effective).length > 0 ? effective : undefined;
}

type RelatedLegalEntity = {
  legalName: string;
  source?: "extraction";
  relationship?: "current" | "fka" | "dba" | "subsidiary" | "parent" | "affiliate" | "other";
  incorporationNumber?: string;
  taxId?: string;
  jurisdiction?: string;
  notes?: string;
};

const PROFILE_FIELD_GROUPS = [
  "insured_identity",
  "mailing_address",
  "dba",
  "entity_type",
  "fein",
  "business_number",
  "operations_description",
  "additional_named_insured",
] as const;

const DATE_FORMATS = [
  "MM/DD/YYYY",
  "M/D/YYYY",
  "YYYY-MM-DD",
  "YYYY/M/D",
];

const UNUSABLE_VALUES = new Set([
  "",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "extracting...",
  "extracting",
  "-",
]);

function cleanText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed && !UNUSABLE_VALUES.has(trimmed.toLowerCase()) ? trimmed : undefined;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = cleanText(record[key]);
    if (value) return value;
  }
  return undefined;
}

function compactAddress(value: unknown, fallbackFormatted?: string): OrgMailingAddress | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const address: OrgMailingAddress = {
      street1: stringField(record, "street1", "line1", "addressLine1", "street"),
      street2: stringField(record, "street2", "line2", "addressLine2", "unit"),
      city: stringField(record, "city", "locality"),
      state: stringField(record, "state", "region"),
      zip: stringField(record, "zip", "postalCode", "postcode"),
      country: stringField(record, "country"),
      formatted: stringField(record, "formatted", "displayValue"),
    };
    const cityStateZip = [
      address.city,
      [address.state, address.zip].filter(Boolean).join(" "),
    ].filter(Boolean).join(", ");
    const formatted = [
      address.street1,
      address.street2,
      cityStateZip,
      address.country,
    ].filter(Boolean).join(", ");
    if (!address.formatted && formatted) address.formatted = formatted;
    const compact = Object.fromEntries(
      Object.entries(address).filter((entry): entry is [keyof OrgMailingAddress, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0,
      ),
    ) as OrgMailingAddress;
    return Object.keys(compact).length > 0 ? compact : undefined;
  }

  const formatted = cleanText(fallbackFormatted);
  return formatted ? { formatted } : undefined;
}

function parsedDateMs(value: unknown): number | undefined {
  const normalized = normalizeExtractedDate(value);
  if (!normalized) return undefined;
  const parsed = dayjs(normalized, DATE_FORMATS, true);
  return parsed.isValid() ? parsed.valueOf() : undefined;
}

function policyYearMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const parsed = dayjs(`${Math.trunc(value)}-01-01`, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.valueOf() : undefined;
}

function policyDateRank(fact: DeclarationFactDoc): number {
  return parsedDateMs(fact.effectiveDate)
    ?? parsedDateMs(fact.expirationDate)
    ?? policyYearMs(fact.policyYear)
    ?? 0;
}

function sourceQualityRank(fact: DeclarationFactDoc): number {
  return (fact.fieldPath.startsWith("operationalProfile.") ? 2 : 0)
    + ((fact.sourceNodeIds?.length ?? 0) > 0 || (fact.sourceSpanIds?.length ?? 0) > 0 ? 1 : 0)
    + (fact.structuredValue ? 1 : 0);
}

function compareFactRecency(a: DeclarationFactDoc, b: DeclarationFactDoc): number {
  return policyDateRank(b) - policyDateRank(a)
    || sourceQualityRank(b) - sourceQualityRank(a)
    || b.observedAt - a.observedAt
    || (b._creationTime ?? 0) - (a._creationTime ?? 0)
    || String(b.policyId).localeCompare(String(a.policyId));
}

function usableFact(fact: DeclarationFactDoc): boolean {
  return Boolean(cleanText(fact.displayValue) && cleanText(fact.normalizedValue));
}

function newestFact(facts: DeclarationFactDoc[], group: string): DeclarationFactDoc | undefined {
  return facts
    .filter((fact) => fact.fieldGroup === group && usableFact(fact))
    .sort(compareFactRecency)[0];
}

function newestFactSet(facts: DeclarationFactDoc[], group: string): DeclarationFactDoc[] {
  const sorted = facts
    .filter((fact) => fact.fieldGroup === group && usableFact(fact))
    .sort(compareFactRecency);
  const newest = sorted[0];
  if (!newest) return [];
  const newestRank = policyDateRank(newest);
  const seen = new Set<string>();
  return sorted.filter((fact) => {
    if (policyDateRank(fact) !== newestRank) return false;
    if (seen.has(fact.normalizedValue)) return false;
    seen.add(fact.normalizedValue);
    return true;
  });
}

function sourceForFact(fact: DeclarationFactDoc) {
  return {
    policyId: fact.policyId,
    fieldPath: fact.fieldPath,
    fieldGroup: fact.fieldGroup,
    displayValue: fact.displayValue,
    normalizedValue: fact.normalizedValue,
    valueKind: fact.valueKind,
    sourceNodeIds: fact.sourceNodeIds,
    sourceSpanIds: fact.sourceSpanIds,
    effectiveDate: fact.effectiveDate,
    expirationDate: fact.expirationDate,
    policyYear: fact.policyYear,
    observedAt: fact.observedAt,
  };
}

function scalarProfileFact(fact: DeclarationFactDoc | undefined) {
  const value = cleanText(fact?.displayValue);
  return fact && value ? { value, source: sourceForFact(fact) } : undefined;
}

function addressProfileFact(fact: DeclarationFactDoc | undefined) {
  if (!fact) return undefined;
  const value = compactAddress(fact.structuredValue, fact.displayValue);
  return value ? { value, source: sourceForFact(fact) } : undefined;
}

type CompanyExtractionDoc = Doc<"companyInformationExtractions">;
type CompanyTextProfileField =
  | "namedInsured"
  | "dba"
  | "entityType"
  | "fein"
  | "businessNumber"
  | "operationsDescription";

const COMPANY_PROFILE_FIELD_GROUPS: Record<
  CompanyTextProfileField,
  string
> = {
  namedInsured: "insured_identity",
  dba: "dba",
  entityType: "entity_type",
  fein: "fein",
  businessNumber: "business_number",
  operationsDescription: "operations_description",
};

function appliedCompanyExtractions(rows: CompanyExtractionDoc[]) {
  return rows.filter((row) => row.appliedFingerprint && row.profile);
}

function newestCompanyTextFact(
  rows: CompanyExtractionDoc[],
  field: CompanyTextProfileField,
) {
  return appliedCompanyExtractions(rows)
    .flatMap((row) => {
      const value = row.profile?.[field];
      return value && typeof value.value === "string"
        ? [{ row, value }]
        : [];
    })
    .sort(
      (left, right) =>
        right.row.observedAt - left.row.observedAt ||
        right.value.confidence - left.value.confidence ||
        right.row.updatedAt - left.row.updatedAt,
    )[0];
}

function newestCompanyAddressFact(rows: CompanyExtractionDoc[]) {
  return appliedCompanyExtractions(rows)
    .flatMap((row) => {
      const value = row.profile?.mailingAddress;
      return value ? [{ row, value }] : [];
    })
    .sort(
      (left, right) =>
        right.row.observedAt - left.row.observedAt ||
        right.value.confidence - left.value.confidence ||
        right.row.updatedAt - left.row.updatedAt,
    )[0];
}

function newestCompanyNamedInsuredSet(rows: CompanyExtractionDoc[]) {
  return appliedCompanyExtractions(rows)
    .filter((row) => (row.profile?.additionalNamedInsureds.length ?? 0) > 0)
    .sort(
      (left, right) =>
        right.observedAt - left.observedAt || right.updatedAt - left.updatedAt,
    )[0];
}

function companySource(
  row: CompanyExtractionDoc,
  args: {
    fieldPath: string;
    fieldGroup: string;
    displayValue: string;
    normalizedValue: string;
    valueKind: "string" | "address" | "list";
    evidence: string;
    confidence: number;
  },
) {
  return {
    sourceKind: row.sourceKind,
    sourceRef: row.sourceRef,
    clientFileId: row.clientFileId,
    procurementEmailThreadId: row.procurementEmailThreadId,
    ...args,
    observedAt: row.observedAt,
  };
}

function companyScalarProfileFact(
  rows: CompanyExtractionDoc[],
  field: CompanyTextProfileField,
) {
  const candidate = newestCompanyTextFact(rows, field);
  if (!candidate) return undefined;
  const rawValue = cleanText(candidate.value.value);
  if (!rawValue) return undefined;
  const normalizedEntityType = normalizeIrsEntityType(rawValue);
  const value =
    field === "entityType" && normalizedEntityType
      ? irsEntityTypeLabel(normalizedEntityType)
      : rawValue;
  return {
    value,
    source: companySource(candidate.row, {
      fieldPath: `companyInformation.${field}`,
      fieldGroup: COMPANY_PROFILE_FIELD_GROUPS[field],
      displayValue: value,
      normalizedValue: normalizeDeclarationValue(value),
      valueKind: "string",
      evidence: candidate.value.evidence,
      confidence: candidate.value.confidence,
    }),
  };
}

function companyAddressProfileFact(rows: CompanyExtractionDoc[]) {
  const candidate = newestCompanyAddressFact(rows);
  if (!candidate) return undefined;
  const value = compactAddress(candidate.value.value);
  if (!value) return undefined;
  const displayValue = value.formatted ?? JSON.stringify(value);
  return {
    value,
    source: companySource(candidate.row, {
      fieldPath: "companyInformation.mailingAddress",
      fieldGroup: "mailing_address",
      displayValue,
      normalizedValue: normalizeDeclarationValue(displayValue),
      valueKind: "address",
      evidence: candidate.value.evidence,
      confidence: candidate.value.confidence,
    }),
  };
}

function companyAdditionalNamedInsuredFacts(rows: CompanyExtractionDoc[]) {
  const row = newestCompanyNamedInsuredSet(rows);
  return (row?.profile?.additionalNamedInsureds ?? []).flatMap((fact) => {
    const value = cleanText(fact.value);
    return value
      ? [
          {
            value,
            source: companySource(row!, {
              fieldPath: "companyInformation.additionalNamedInsureds",
              fieldGroup: "additional_named_insured",
              displayValue: value,
              normalizedValue: normalizeDeclarationValue(value),
              valueKind: "list",
              evidence: fact.evidence,
              confidence: fact.confidence,
            }),
          },
        ]
      : [];
  });
}

type RankedProfileFact = {
  source: {
    effectiveDate?: unknown;
    expirationDate?: unknown;
    policyYear?: unknown;
    observedAt?: unknown;
  };
};

function factSourceRank(fact: RankedProfileFact | undefined) {
  if (!fact) return 0;
  const source = fact.source;
  return (
    parsedDateMs(source.effectiveDate) ??
    parsedDateMs(source.expirationDate) ??
    policyYearMs(source.policyYear) ??
    (typeof source.observedAt === "number" ? source.observedAt : 0)
  );
}

function preferNewestProfileFact<
  PolicyFact extends RankedProfileFact,
  CompanyFact extends RankedProfileFact,
>(
  policyFact: PolicyFact | undefined,
  companyFact: CompanyFact | undefined,
) {
  if (!policyFact) return companyFact;
  if (!companyFact) return policyFact;
  return factSourceRank(companyFact) > factSourceRank(policyFact)
    ? companyFact
    : policyFact;
}

function normalizedEntityName(value: string | undefined): string {
  return normalizeDeclarationValue(value ?? "");
}

function mergeRelatedLegalEntities(
  current: unknown,
  orgName: string | undefined,
  profileFacts: {
    namedInsured?: { value: string };
    dba?: { value: string };
    taxId?: { value: string };
    entityType?: { value: string };
    additionalNamedInsureds?: Array<{ value: string }>;
  },
): RelatedLegalEntity[] | undefined {
  const existing = Array.isArray(current)
    ? current.filter((item): item is RelatedLegalEntity =>
      !!item &&
      typeof item === "object" &&
      typeof (item as RelatedLegalEntity).legalName === "string" &&
      (item as RelatedLegalEntity).legalName.trim().length > 0,
    )
    : [];
  const next = existing.filter((entity) => entity.source !== "extraction").map((entity) => ({ ...entity }));
  const seen = new Set(next.map((entity) => normalizedEntityName(entity.legalName)));
  const orgNameKey = normalizedEntityName(orgName);

  const addEntity = (
    value: string | undefined,
    relationship: RelatedLegalEntity["relationship"],
    details?: Partial<RelatedLegalEntity>,
  ) => {
    const legalName = cleanText(value);
    const key = normalizedEntityName(legalName);
    if (!legalName || !key || seen.has(key) || (relationship === "dba" && key === orgNameKey)) return;
    seen.add(key);
    next.push({
      legalName,
      relationship,
      source: "extraction",
      ...details,
    });
  };

  addEntity(profileFacts.namedInsured?.value, "current", {
    taxId: profileFacts.taxId?.value,
  });
  addEntity(profileFacts.dba?.value, "dba");
  for (const insured of profileFacts.additionalNamedInsureds ?? []) {
    addEntity(insured.value, "other");
  }

  return valuesEqual(existing, next) ? undefined : next;
}

async function activeOrgProfileFacts(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
): Promise<DeclarationFactDoc[]> {
  const rows: DeclarationFactDoc[] = [];
  for (const group of PROFILE_FIELD_GROUPS) {
    const facts = await ctx.db
      .query("policyDeclarationFacts")
      .withIndex("organization_group", (q) => q.eq("orgId", orgId).eq("fieldGroup", group))
      .collect();
    rows.push(...facts.filter((fact) => fact.active) as DeclarationFactDoc[]);
  }
  return rows;
}

export async function syncOrgProfileFromDeclarationFacts(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
) {
  const org = await ctx.db.get(orgId);
  if (!org) return { updated: false, reason: "org_not_found" as const };

  const facts = await activeOrgProfileFacts(ctx, orgId);
  const companyExtractions = await ctx.db
    .query("companyInformationExtractions")
    .withIndex("organization", (index) => index.eq("orgId", orgId))
    .order("desc")
    .take(500);
  const policyNamedInsured = scalarProfileFact(
    newestFact(facts, "insured_identity"),
  );
  const policyMailingAddress = addressProfileFact(
    newestFact(facts, "mailing_address"),
  );
  const policyDba = scalarProfileFact(newestFact(facts, "dba"));
  const policyEntityType = scalarProfileFact(newestFact(facts, "entity_type"));
  const policyTaxId = scalarProfileFact(newestFact(facts, "fein"));
  const policyBusinessNumber = scalarProfileFact(
    newestFact(facts, "business_number"),
  );
  const policyOperationsDescription = scalarProfileFact(
    newestFact(facts, "operations_description"),
  );
  const policyAdditionalNamedInsureds = newestFactSet(
    facts,
    "additional_named_insured",
  )
    .map(scalarProfileFact)
    .filter((fact): fact is NonNullable<ReturnType<typeof scalarProfileFact>> => Boolean(fact));
  const companyNamedInsured = companyScalarProfileFact(
    companyExtractions,
    "namedInsured",
  );
  const companyMailingAddress = companyAddressProfileFact(companyExtractions);
  const companyDba = companyScalarProfileFact(companyExtractions, "dba");
  const companyEntityType = companyScalarProfileFact(
    companyExtractions,
    "entityType",
  );
  const companyTaxId = companyScalarProfileFact(companyExtractions, "fein");
  const companyBusinessNumber = companyScalarProfileFact(
    companyExtractions,
    "businessNumber",
  );
  const companyOperationsDescription = companyScalarProfileFact(
    companyExtractions,
    "operationsDescription",
  );
  const companyAdditionalNamedInsureds =
    companyAdditionalNamedInsuredFacts(companyExtractions);

  const namedInsured = preferNewestProfileFact(
    policyNamedInsured,
    companyNamedInsured,
  );
  const mailingAddress = preferNewestProfileFact(
    policyMailingAddress,
    companyMailingAddress,
  );
  const dba = preferNewestProfileFact(policyDba, companyDba);
  const entityType = preferNewestProfileFact(
    policyEntityType,
    companyEntityType,
  );
  const taxId = preferNewestProfileFact(policyTaxId, companyTaxId);
  const businessNumber = preferNewestProfileFact(
    policyBusinessNumber,
    companyBusinessNumber,
  );
  const operationsDescription = preferNewestProfileFact(
    policyOperationsDescription,
    companyOperationsDescription,
  );
  const additionalNamedInsureds =
    companyAdditionalNamedInsureds.length > 0 &&
    factSourceRank(companyAdditionalNamedInsureds[0]) >
      factSourceRank(policyAdditionalNamedInsureds[0])
      ? companyAdditionalNamedInsureds
      : policyAdditionalNamedInsureds;

  const profileFacts = {
    ...(namedInsured ? { namedInsured } : {}),
    ...(mailingAddress ? { mailingAddress } : {}),
    ...(dba ? { dba } : {}),
    ...(entityType ? { entityType } : {}),
    ...(taxId ? { taxId } : {}),
    ...(taxId ? { fein: taxId } : {}),
    ...(businessNumber ? { businessNumber } : {}),
    ...(operationsDescription ? { operationsDescription } : {}),
    ...(additionalNamedInsureds.length > 0 ? { additionalNamedInsureds } : {}),
  };
  const hasProfileFacts = Object.keys(profileFacts).length > 0;
  const orgRecord = org as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if (hasProfileFacts) {
    if (!valuesEqual(orgRecord.profileFacts ?? null, profileFacts)) {
      patch.profileFacts = profileFacts;
    }
  } else if (orgRecord.profileFacts !== undefined) {
    patch.profileFacts = undefined;
  }

  if (mailingAddress) {
    if (!valuesEqual(orgRecord.mailingAddress ?? null, mailingAddress.value)) {
      patch.mailingAddress = mailingAddress.value;
    }
  } else if (
    orgRecord.mailingAddress !== undefined &&
    typeof orgRecord.profileFacts === "object" &&
    orgRecord.profileFacts !== null &&
    "mailingAddress" in orgRecord.profileFacts
  ) {
    patch.mailingAddress = undefined;
  }

  const currentIdentity = clientIdentity(org.name);
  const dbaName = cleanText(dba?.value);
  const nameIsLegalInsured = normalizedEntityName(org.name) === normalizedEntityName(namedInsured?.value);
  const nameDeclaresDba = currentIdentity.name !== org.name
    && normalizedEntityName(currentIdentity.name) === normalizedEntityName(dbaName);
  const displayName = dbaName && (nameIsLegalInsured || nameDeclaresDba) ? dbaName : org.name;
  if (displayName !== org.name) patch.name = displayName;

  const relatedLegalEntities = mergeRelatedLegalEntities(
    orgRecord.relatedLegalEntities,
    displayName,
    profileFacts,
  );
  if (relatedLegalEntities) patch.relatedLegalEntities = relatedLegalEntities;

  if (Object.keys(patch).length === 0) {
    return { updated: false, reason: "unchanged" as const };
  }

  patch.profileFactsUpdatedAt = dayjs().valueOf();
  await ctx.db.patch(orgId, patch as never);
  await scheduleCompanyResearch(ctx, orgId);
  return {
    updated: true,
    keys: Object.keys(patch),
  };
}
