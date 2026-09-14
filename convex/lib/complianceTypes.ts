import { v } from "convex/values";
import { toLobCodes, type AcordLobCode } from "./linesOfBusiness";

export const REQUIREMENT_KINDS = ["coverage", "insurer", "condition"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const REQUIREMENT_SCOPES = ["own_org", "vendors"] as const;
export type RequirementScope = (typeof REQUIREMENT_SCOPES)[number];

export const REQUIREMENT_SOURCE_TYPES = [
  "manual",
  "bulk_import",
  "lease_agreement",
  "client_contract",
  "vendor_requirements",
  "other",
] as const;
export type RequirementSourceType = (typeof REQUIREMENT_SOURCE_TYPES)[number];

export const REQUIREMENT_LIMIT_KINDS = [
  "per_occurrence",
  "general_aggregate",
  "products_completed_ops_aggregate",
  "personal_adv_injury",
  "damage_to_rented_premises",
  "medical_expense",
  "per_claim",
  "aggregate",
  "combined_single_limit",
  "el_each_accident",
  "el_disease_each_employee",
  "el_disease_policy_limit",
  "other",
] as const;
export type RequirementLimitKind = (typeof REQUIREMENT_LIMIT_KINDS)[number];

export const REQUIREMENT_PROVISIONS = [
  "additional_insured",
  "waiver_of_subrogation",
  "primary_non_contributory",
] as const;
export type RequirementProvision = (typeof REQUIREMENT_PROVISIONS)[number];

export const REQUIREMENT_CONDITION_TYPES = [
  "cancellation_notice",
  "certificate_delivery",
  "claims_reporting",
  "subcontractor_insurance",
  "other",
] as const;
export type RequirementConditionType =
  (typeof REQUIREMENT_CONDITION_TYPES)[number];

export const COMPLIANCE_CHECK_STATUSES = [
  "met",
  "not_met",
  "expiring_soon",
  "expired",
  "unverified",
] as const;
export type ComplianceCheckStatus = (typeof COMPLIANCE_CHECK_STATUSES)[number];

function literalUnion<const T extends readonly string[]>(values: T) {
  return v.union(...values.map((value) => v.literal(value)) as [
    ReturnType<typeof v.literal<T[number]>>,
    ReturnType<typeof v.literal<T[number]>>,
    ...Array<ReturnType<typeof v.literal<T[number]>>>,
  ]);
}
export const requirementKindValidator = literalUnion(REQUIREMENT_KINDS);
export const requirementScopeValidator = literalUnion(REQUIREMENT_SCOPES);
export const requirementSourceTypeValidator = literalUnion(
  REQUIREMENT_SOURCE_TYPES,
);
export const requirementLimitKindValidator = literalUnion(
  REQUIREMENT_LIMIT_KINDS,
);
export const requirementProvisionValidator = literalUnion(
  REQUIREMENT_PROVISIONS,
);
export const requirementConditionTypeValidator = literalUnion(
  REQUIREMENT_CONDITION_TYPES,
);
export const complianceCheckStatusValidator = literalUnion(
  COMPLIANCE_CHECK_STATUSES,
);

export const REQUIREMENT_LIMIT_KIND_LABELS: Record<
  RequirementLimitKind,
  string
> = {
  per_occurrence: "Per occurrence",
  general_aggregate: "General aggregate",
  products_completed_ops_aggregate: "Products-completed ops aggregate",
  personal_adv_injury: "Personal and advertising injury",
  damage_to_rented_premises: "Damage to rented premises",
  medical_expense: "Medical expense",
  per_claim: "Per claim",
  aggregate: "Aggregate",
  combined_single_limit: "Combined single limit",
  el_each_accident: "EL each accident",
  el_disease_each_employee: "EL disease each employee",
  el_disease_policy_limit: "EL disease policy limit",
  other: "Other limit",
};

export const REQUIREMENT_PROVISION_LABELS: Record<
  RequirementProvision,
  string
> = {
  additional_insured: "Additional insured",
  waiver_of_subrogation: "Waiver of subrogation",
  primary_non_contributory: "Primary and non-contributory",
};

export const REQUIREMENT_CONDITION_TYPE_LABELS: Record<
  RequirementConditionType,
  string
> = {
  cancellation_notice: "Cancellation notice",
  certificate_delivery: "Certificate delivery",
  claims_reporting: "Claims reporting",
  subcontractor_insurance: "Subcontractor insurance",
  other: "Other condition",
};

export const REQUIREMENT_SOURCE_TYPE_LABELS: Record<
  RequirementSourceType,
  string
> = {
  manual: "Manual",
  bulk_import: "Bulk import",
  lease_agreement: "Lease agreement",
  client_contract: "Client requirements",
  vendor_requirements: "Vendor requirements",
  other: "Other source",
};

export function isRequirementLimitKind(
  value: unknown,
): value is RequirementLimitKind {
  return (
    typeof value === "string" &&
    (REQUIREMENT_LIMIT_KINDS as readonly string[]).includes(value)
  );
}

export function isRequirementProvision(
  value: unknown,
): value is RequirementProvision {
  return (
    typeof value === "string" &&
    (REQUIREMENT_PROVISIONS as readonly string[]).includes(value)
  );
}

export function isRequirementSourceType(
  value: unknown,
): value is RequirementSourceType {
  return (
    typeof value === "string" &&
    (REQUIREMENT_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

export function normalizeRequirementLineOfBusiness(
  value: unknown,
): AcordLobCode | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const sourceCode = value.trim().toUpperCase();
  if (sourceCode === "CRIME") return "CRIM";
  if (sourceCode === "UN") return "UN";
  const [code] = toLobCodes([sourceCode]);
  return code === "UN" ? undefined : code;
}

type SemanticCoverageRequirement = {
  kind: string;
  scope: string;
  lineOfBusiness?: string;
  limits?: Array<{ kind: string; amount: number; label?: string }>;
  maxDeductible?: { amount: number; label?: string };
  coverageForm?: string;
  retroactiveDateOnOrBefore?: string;
  provisions?: string[];
  requiredForms?: string[];
};

export function hasCheckableCoverageTerms(
  requirement: Pick<
    SemanticCoverageRequirement,
    | "limits"
    | "maxDeductible"
    | "coverageForm"
    | "retroactiveDateOnOrBefore"
    | "provisions"
    | "requiredForms"
  >,
) {
  return Boolean(
    requirement.limits?.length ||
      requirement.maxDeductible ||
      requirement.coverageForm?.trim() ||
      requirement.retroactiveDateOnOrBefore?.trim() ||
      requirement.provisions?.length ||
      requirement.requiredForms?.length,
  );
}

function normalizeSemanticTerm(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Identifies an exact typed coverage requirement independent of prose, title,
 * source document, and array ordering. Different material terms intentionally
 * produce different keys so stricter requirements remain separate records.
 */
export function coverageRequirementSemanticKey(
  requirement: SemanticCoverageRequirement,
) {
  const limits = (requirement.limits ?? [])
    .map((limit) => [normalizeSemanticTerm(limit.kind), limit.amount] as const)
    .sort(([leftKind, leftAmount], [rightKind, rightAmount]) =>
      leftKind.localeCompare(rightKind) || leftAmount - rightAmount,
    );
  const provisions = (requirement.provisions ?? [])
    .map(normalizeSemanticTerm)
    .filter(Boolean)
    .sort();
  const requiredForms = (requirement.requiredForms ?? [])
    .map(normalizeSemanticTerm)
    .filter(Boolean)
    .sort();

  return JSON.stringify({
    kind: normalizeSemanticTerm(requirement.kind),
    scope: normalizeSemanticTerm(requirement.scope),
    lineOfBusiness:
      normalizeRequirementLineOfBusiness(requirement.lineOfBusiness) ??
      normalizeSemanticTerm(requirement.lineOfBusiness),
    limits,
    maxDeductible: requirement.maxDeductible?.amount ?? null,
    coverageForm: normalizeSemanticTerm(requirement.coverageForm),
    retroactiveDateOnOrBefore: normalizeSemanticTerm(
      requirement.retroactiveDateOnOrBefore,
    ),
    provisions,
    requiredForms,
  });
}
