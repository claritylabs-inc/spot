import type { Doc } from "../_generated/dataModel";
import {
  REQUIREMENT_LIMIT_KIND_LABELS,
  REQUIREMENT_PROVISION_LABELS,
  REQUIREMENT_SOURCE_TYPE_LABELS,
  type RequirementScope,
} from "./complianceTypes";
import { lobLabel } from "./linesOfBusiness";
import { normalizedSearchText, uniqueSearchTerms } from "./searchTokenizer";

type Requirement = Pick<
  Doc<"insuranceRequirements">,
  | "_id"
  | "scope"
  | "title"
  | "requirementText"
  | "lineOfBusiness"
  | "limits"
  | "maxDeductible"
  | "coverageForm"
  | "retroactiveDateOnOrBefore"
  | "provisions"
  | "requiredForms"
  | "sourceType"
  | "sourceDocumentId"
  | "sourceDocumentName"
  | "sourceExcerpt"
  | "sourcePageStart"
  | "sourcePageEnd"
> & {
  complianceCheck?: {
    status: string;
    reasons?: string[];
    matchedPolicyIds?: Array<Doc<"policies">["_id"]>;
    matchedSummary?: string;
    checkedBy?: "system" | "user" | "agent";
    matchedPolicy?: {
      carrier?: string;
      policyNumber?: string;
      coverageName?: string;
      coverageLimit?: string;
    };
  };
  requirementSource?: {
    title: string;
    sourceType: string;
    dealName?: string;
    dealType?: string;
    holder?: {
      displayName: string;
      contactName?: string;
      email?: string;
      address?: unknown;
    } | null;
  };
  clientRequirementSource?: {
    clientOrg: {
      name: string;
    } | null;
  };
};

const SCOPE_LABELS: Record<RequirementScope, string> = {
  vendors: "Vendor",
  own_org: "My",
};

function formatLimits(requirement: Requirement) {
  const limits = requirement.limits ?? [];
  return limits
    .map((limit) => {
      const label =
        REQUIREMENT_LIMIT_KIND_LABELS[
          limit.kind as keyof typeof REQUIREMENT_LIMIT_KIND_LABELS
        ] ?? limit.kind;
      return `${label}: ${limit.label ?? `$${limit.amount.toLocaleString()}`}`;
    })
    .join(", ");
}

function formatRequirementDetails(requirement: Requirement) {
  const details = [
    requirement.clientRequirementSource
      ? `source: client requirements from ${requirement.clientRequirementSource.clientOrg?.name ?? "client"}`
      : undefined,
    requirement.sourceType
      ? `sourceType: ${REQUIREMENT_SOURCE_TYPE_LABELS[requirement.sourceType]}`
      : undefined,
    requirement.sourceDocumentName
      ? `sourceDocument: ${requirement.sourceDocumentName}`
      : undefined,
    requirement.sourceDocumentId
      ? `requirementSourceDocumentId: ${requirement.sourceDocumentId}`
      : undefined,
    requirement.sourcePageStart
      ? `sourcePage: ${
          requirement.sourcePageEnd &&
          requirement.sourcePageEnd !== requirement.sourcePageStart
            ? `${requirement.sourcePageStart}-${requirement.sourcePageEnd}`
            : requirement.sourcePageStart
        }`
      : undefined,
    `scope: ${SCOPE_LABELS[requirement.scope]}`,
    requirement.lineOfBusiness
      ? `lineOfBusiness: ${requirement.lineOfBusiness} (${lobLabel(requirement.lineOfBusiness)})`
      : undefined,
    requirement.limits?.length
      ? `limits: ${formatLimits(requirement)}`
      : undefined,
    requirement.maxDeductible
      ? `maxDeductible: ${requirement.maxDeductible.label ?? requirement.maxDeductible.amount}`
      : undefined,
    requirement.coverageForm
      ? `coverageForm: ${requirement.coverageForm}`
      : undefined,
    requirement.retroactiveDateOnOrBefore
      ? `retroactiveDateOnOrBefore: ${requirement.retroactiveDateOnOrBefore}`
      : undefined,
    requirement.provisions?.length
      ? `provisions: ${requirement.provisions
          .map(
            (provision) =>
              REQUIREMENT_PROVISION_LABELS[
                provision as keyof typeof REQUIREMENT_PROVISION_LABELS
              ] ?? provision,
          )
          .join(", ")}`
      : undefined,
    requirement.requiredForms?.length
      ? `requiredForms: ${requirement.requiredForms.join(", ")}`
      : undefined,
    requirement.requirementSource?.holder?.displayName
      ? `certificateHolder: ${requirement.requirementSource.holder.displayName}`
      : undefined,
    requirement.requirementSource?.dealName
      ? `dealName: ${requirement.requirementSource.dealName}`
      : undefined,
    requirement.requirementSource?.dealType
      ? `dealType: ${requirement.requirementSource.dealType}`
      : undefined,
    requirement.complianceCheck
      ? `currentComplianceStatus: ${requirement.complianceCheck.status}`
      : undefined,
    requirement.complianceCheck?.reasons?.length
      ? `currentComplianceReasons: ${requirement.complianceCheck.reasons.join(", ")}`
      : undefined,
    requirement.complianceCheck?.matchedPolicy
      ? `matchedPolicy: ${[
          requirement.complianceCheck.matchedPolicy.carrier,
          requirement.complianceCheck.matchedPolicy.policyNumber,
          requirement.complianceCheck.matchedPolicy.coverageName,
          requirement.complianceCheck.matchedPolicy.coverageLimit,
        ]
          .filter(Boolean)
          .join(" · ")}`
      : undefined,
    requirement.complianceCheck?.matchedSummary
      ? `complianceSummary: ${requirement.complianceCheck.matchedSummary}`
      : undefined,
  ];
  return details.filter(Boolean).join("; ");
}

export function filterComplianceRequirements(
  requirements: Requirement[],
  {
    query,
    scope,
  }: {
    query?: string;
    scope?: RequirementScope | "all";
  },
) {
  const queryTerms = uniqueSearchTerms(query ?? "", { minimumLength: 3 });

  return requirements.filter((requirement) => {
    if (scope && scope !== "all" && requirement.scope !== scope) return false;
    if (!queryTerms.length) return true;
    const haystack = normalizedSearchText(
      [
        requirement.title,
        requirement.scope,
        requirement.lineOfBusiness,
        requirement.lineOfBusiness ? lobLabel(requirement.lineOfBusiness) : "",
        requirement.requirementText,
        formatRequirementDetails(requirement),
        requirement.sourceType,
        requirement.sourceDocumentName,
        requirement.sourceExcerpt,
      ].join(" "),
    );
    return queryTerms.some((term) => haystack.includes(term));
  });
}

export function complianceRequirementForTool(requirement: Requirement) {
  return {
    requirementId: requirement._id,
    title: requirement.title,
    scope: requirement.scope,
    requirementText: requirement.requirementText,
    lineOfBusiness: requirement.lineOfBusiness,
    limits: requirement.limits,
    maxDeductible: requirement.maxDeductible,
    coverageForm: requirement.coverageForm,
    retroactiveDateOnOrBefore: requirement.retroactiveDateOnOrBefore,
    provisions: requirement.provisions,
    requiredForms: requirement.requiredForms,
    requirementSourceDocumentId: requirement.sourceDocumentId,
    sourceDocumentName: requirement.sourceDocumentName,
    sourceExcerpt: requirement.sourceExcerpt,
    sourcePageStart: requirement.sourcePageStart,
    sourcePageEnd: requirement.sourcePageEnd,
    currentComplianceStatus:
      requirement.complianceCheck?.status ?? "unverified",
    currentComplianceReasons: requirement.complianceCheck?.reasons ?? [],
    matchedPolicyIds: requirement.complianceCheck?.matchedPolicyIds ?? [],
    matchedSummary: requirement.complianceCheck?.matchedSummary,
  };
}

export function formatComplianceRequirement(requirement: Requirement) {
  const details = formatRequirementDetails(requirement);
  const source = requirement.sourceExcerpt
    ? `\n  Source language: ${requirement.sourceExcerpt}`
    : "";
  return `- ${requirement.title} (requirementId: ${requirement._id}; ${details})\n  ${requirement.requirementText}${source}`;
}

export function formatComplianceRequirementsContext(
  requirements: Requirement[],
) {
  if (requirements.length === 0) return "";

  const vendorRequirements = requirements.filter(
    (requirement) => requirement.scope === "vendors",
  );
  const myRequirements = requirements.filter(
    (requirement) => requirement.scope === "own_org",
  );
  const sections = [];
  if (vendorRequirements.length > 0) {
    sections.push(
      `Vendor requirements:\n${vendorRequirements
        .map(formatComplianceRequirement)
        .join("\n")}`,
    );
  }
  if (myRequirements.length > 0) {
    sections.push(
      `My requirements:\n${myRequirements
        .map(formatComplianceRequirement)
        .join("\n")}`,
    );
  }

  return `\n\nCOMPLIANCE REQUIREMENTS:\nThese are typed insurance coverage requirements checked against structured policy coverage evidence. scope says whose obligation this is. Prefer these records over policy documents when the user asks what the org requires. currentComplianceStatus and currentComplianceReasons are the authoritative saved assessment: never independently promote unverified or not_met to met from a generic policy limit. A generic or undifferentiated limit does not prove distinct per-claim, per-occurrence, or aggregate requirements. A policy effective date is not a retroactive date. Source holder and deal fields are authoritative when present; do not infer them from abbreviations. Requirement-mode certificate generation is gated: if every selected requirement is unverified, not_met, or expired, explain that Spot would block generation until at least one is met or expiring_soon; do not say Spot could generate the requirement COIs now.\n${sections.join("\n\n")}`;
}
