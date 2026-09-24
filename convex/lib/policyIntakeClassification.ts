"use node";

// Owner: P4 (docs/architecture/convex-section-extraction.md).
// Jev intake gate: document class plus advisory relationship to the client's
// existing policies. Moves classifyInsuranceExtractability out of
// convex/actions/policyExtraction.ts.

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { clRouterDecide } from "./clRouterClient";
import type { PdfPageText } from "./pdfText";

export type PolicyIntakeDocumentClass =
  | "bound_policy_document"
  | "specimen_policy_document"
  | "insurance_related_but_not_bound_policy"
  | "non_insurance"
  | "unknown";

export type PolicyIntakeRelationshipKind =
  | "new_policy"
  | "renewal"
  | "endorsement"
  | "duplicate"
  | "unknown";

export type ExistingPolicyCandidate = {
  policyId: string;
  policyNumber?: string;
  carrier?: string;
  namedInsured?: string;
  effectiveDate?: string;
  expirationDate?: string;
};

export type PolicyIntakeDecision = {
  classification: PolicyIntakeDocumentClass;
  shouldExtract: boolean;
  confidence: number;
  reason: string;
  detectedTitle: string | null;
  /** Advisory only in this change: recorded for operators, never auto-routed. */
  relationship: {
    kind: PolicyIntakeRelationshipKind;
    policyId?: string;
    confidence: number;
  };
};

const MAX_EVIDENCE_CHARS = 60_000;
const MAX_RELATIONSHIP_EVIDENCE_CHARS = 20_000;
const MAX_RELATIONSHIP_CANDIDATES = 20;
const RELATIONSHIP_MIN_CONFIDENCE = 0.6;

const SPECIMEN_POLICY_MARKER = /\bSPECIMEN\s+(?:INSURANCE\s+)?POLICY\b/i;
const SPECIMEN_POLICY_HEADING =
  /^[^A-Z0-9]{0,16}SPECIMEN\s+(?:INSURANCE\s+)?POLICY\b/i;
const SPECIMEN_TEST_DISCLAIMER =
  /\b(?:FOR\s+TESTING\s+ONLY|NOT\s+AN\s+ACTUAL\s+POLICY)\b/i;

const CLASSIFICATION_CRITERIA: Record<PolicyIntakeDocumentClass, string> = {
  bound_policy_document:
    "An already-bound insurance policy, binder, declarations page, renewal policy, insurance schedule, policy wording, endorsement, or post-binding supplement containing bound policy terms.",
  specimen_policy_document:
    "A specimen, sample, or testing-only insurance policy artifact suitable for extraction testing.",
  insurance_related_but_not_bound_policy:
    "An unbound quote, proposal, submission, application, marketing material, invoice, or other insurance-related document that is not a bound policy artifact.",
  non_insurance:
    "A novel, textbook, resume, generic contract, unrelated legal document, trust ledger, closing statement, disbursement statement, or other non-policy document.",
  unknown: "Insufficient evidence to determine the document type.",
};

const CLASSIFICATION_REASONS: Record<PolicyIntakeDocumentClass, string> = {
  bound_policy_document:
    "The excerpts describe a bound or post-binding policy artifact.",
  specimen_policy_document:
    "The excerpts describe a specimen policy testing fixture.",
  insurance_related_but_not_bound_policy:
    "The excerpts describe insurance-related material without bound policy terms.",
  non_insurance: "The excerpts describe a non-policy document.",
  unknown: "The excerpts do not establish the document type.",
};

const RELATIONSHIP_KINDS = new Set<PolicyIntakeRelationshipKind>([
  "renewal",
  "endorsement",
  "duplicate",
]);

/**
 * Specimen policies are valid extraction fixtures even though their labels and
 * disclaimers correctly say that they are not bound coverage.
 */
export function isSpecimenPolicyPages(pages: PdfPageText[]): boolean {
  let hasSpecimenMarker = false;
  let hasTestDisclaimer = false;
  for (const page of pages) {
    for (const line of page.text.split("\n")) {
      const text = line.replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (SPECIMEN_POLICY_HEADING.test(text)) return true;
      if (SPECIMEN_POLICY_MARKER.test(text)) hasSpecimenMarker = true;
      if (SPECIMEN_TEST_DISCLAIMER.test(text)) hasTestDisclaimer = true;
    }
  }
  return hasSpecimenMarker && hasTestDisclaimer;
}

/** Only complete parsed pages can support rejecting a PDF without seeing its images. */
export function buildIntakeEvidence(
  pages: PdfPageText[],
  pageCount: number,
): { complete: boolean; text: string } {
  const byPage = new Map<number, string>();
  for (const page of pages) {
    const text = page.text.trim();
    if (
      !Number.isInteger(page.page) ||
      page.page < 1 ||
      page.page > pageCount ||
      !text
    )
      continue;
    byPage.set(page.page, [byPage.get(page.page), text].filter(Boolean).join("\n"));
  }
  const text = [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, pageText]) => `Page ${page}:\n${pageText}`)
    .join("\n\n");
  // Missing/blank parsed pages may contain image-only declarations or endorsements.
  // Do not truncate and then treat quote frontmatter as the entire policy packet.
  const complete =
    Number.isInteger(pageCount) &&
    pageCount >= 1 &&
    byPage.size === pageCount &&
    text.length <= MAX_EVIDENCE_CHARS;
  return { complete, text };
}

/** Rejection thresholds from the original document gate. */
export function shouldRejectPolicyIntake(decision: {
  classification: PolicyIntakeDocumentClass;
  confidence: number;
}): boolean {
  if (decision.classification === "non_insurance") {
    return decision.confidence >= 0.5;
  }
  if (decision.classification === "insurance_related_but_not_bound_policy") {
    return decision.confidence >= 0.65;
  }
  return false;
}

function normalized(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Deterministic prefilter: policies whose identifiers appear in the document first. */
export function rankExistingPolicyCandidates(
  candidates: ExistingPolicyCandidate[],
  documentText: string,
): ExistingPolicyCandidate[] {
  const corpus = ` ${normalized(documentText)} `;
  const mentions = (value: string | undefined) => {
    const needle = normalized(value);
    return needle.length >= 3 && corpus.includes(` ${needle} `);
  };
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score:
        (mentions(candidate.policyNumber) ? 4 : 0) +
        (mentions(candidate.namedInsured) ? 2 : 0) +
        (mentions(candidate.carrier) ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_RELATIONSHIP_CANDIDATES)
    .map(({ candidate }) => candidate);
}

function relationshipCriteria(candidates: ExistingPolicyCandidate[]) {
  const criteria: Record<string, string | Record<string, string>> = {
    new_policy:
      "A policy that is not a renewal, endorsement, or copy of any listed existing policy.",
  };
  for (const candidate of candidates) {
    const policy = Object.fromEntries(
      Object.entries(candidate).filter(([, value]) => typeof value === "string" && value),
    ) as Record<string, string>;
    criteria[`renewal__${candidate.policyId}`] = {
      relationship: "Renews or replaces this existing policy for a later policy period.",
      ...policy,
    };
    criteria[`endorsement__${candidate.policyId}`] = {
      relationship: "Endorses, amends, or changes this existing policy mid-term.",
      ...policy,
    };
    criteria[`duplicate__${candidate.policyId}`] = {
      relationship: "Another copy of this existing policy for the same policy period.",
      ...policy,
    };
  }
  criteria.unknown = "The document does not establish its relationship to the listed policies.";
  return criteria;
}

export function parseRelationshipChoice(
  choice: string,
  candidateIds: Set<string>,
): { kind: PolicyIntakeRelationshipKind; policyId?: string } {
  if (choice === "new_policy") return { kind: "new_policy" };
  const separator = choice.indexOf("__");
  if (separator < 0) return { kind: "unknown" };
  const kind = choice.slice(0, separator) as PolicyIntakeRelationshipKind;
  const policyId = choice.slice(separator + 2);
  return RELATIONSHIP_KINDS.has(kind) && candidateIds.has(policyId)
    ? { kind, policyId }
    : { kind: "unknown" };
}

const UNKNOWN_RELATIONSHIP = { kind: "unknown", confidence: 0 } as const;

export async function classifyPolicyIntake(args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  pageCount: number;
  pages: PdfPageText[];
  existingPolicies: ExistingPolicyCandidate[];
  traceId?: string;
  policyId?: string;
}): Promise<PolicyIntakeDecision> {
  if (isSpecimenPolicyPages(args.pages)) {
    return {
      shouldExtract: true,
      classification: "specimen_policy_document",
      confidence: 1,
      reason:
        "The PDF is explicitly labeled as a specimen policy and is allowed as a testing fixture.",
      detectedTitle: "Specimen policy",
      relationship: { ...UNKNOWN_RELATIONSHIP },
    };
  }

  const incomplete: PolicyIntakeDecision = {
    shouldExtract: true,
    classification: "unknown",
    confidence: 0,
    reason:
      "Complete parsed page evidence is unavailable within the intake budget; continuing rich document extraction.",
    detectedTitle: null,
    relationship: { ...UNKNOWN_RELATIONSHIP },
  };
  const evidence = buildIntakeEvidence(args.pages, args.pageCount);
  const relationshipText = evidence.text.slice(0, MAX_RELATIONSHIP_EVIDENCE_CHARS);
  const candidates = rankExistingPolicyCandidates(
    args.existingPolicies.filter((policy) => policy.policyId && policy.policyId !== args.policyId),
    evidence.text,
  );
  const askRelationship = candidates.length > 0 && relationshipText.length > 0;
  if (!evidence.complete && !askRelationship) return incomplete;

  try {
    const result = await clRouterDecide({
      orgId: String(args.orgId),
      task: "policy_extraction_intake",
      state: {
        documentText: evidence.complete ? evidence.text : relationshipText,
        ...(askRelationship ? { existingPolicies: candidates } : {}),
      },
      questions: {
        ...(evidence.complete
          ? {
              classification: {
                type: "choice" as const,
                instructions: `Classify this uploaded document for post-binding insurance extraction. Use only the document evidence. A premium payment in a trust ledger, closing statement, or disbursement statement does not make it a bound policy artifact. A disclaimer that a specimen is not actual insurance does not disqualify an otherwise valid specimen. Choose unknown when the excerpts cannot establish the document type.`,
                criteria: CLASSIFICATION_CRITERIA,
              },
            }
          : {}),
        ...(askRelationship
          ? {
              relationship: {
                type: "choice" as const,
                instructions:
                  "How does this uploaded document relate to the client's existing policies listed in existingPolicies? Match on policy number, named insured, carrier, and policy period. A renewal covers a later period; a duplicate covers the same period; an endorsement changes an existing policy. Choose unknown when the evidence cannot establish the relationship.",
                criteria: relationshipCriteria(candidates),
              },
            }
          : {}),
      },
      trace: args.traceId ? { traceId: args.traceId } : undefined,
    }, { telemetry: args.ctx });

    const relationshipAnswer = result.answers.relationship;
    const relationship: PolicyIntakeDecision["relationship"] =
      relationshipAnswer?.type === "choice" &&
      relationshipAnswer.confidence >= RELATIONSHIP_MIN_CONFIDENCE
        ? {
            ...parseRelationshipChoice(
              relationshipAnswer.choice,
              new Set(candidates.map((candidate) => candidate.policyId)),
            ),
            confidence: relationshipAnswer.confidence,
          }
        : { ...UNKNOWN_RELATIONSHIP };
    if (!evidence.complete) return { ...incomplete, relationship };

    const answer = result.answers.classification;
    const classification =
      answer?.type === "choice" && answer.choice in CLASSIFICATION_CRITERIA
        ? (answer.choice as PolicyIntakeDocumentClass)
        : "unknown";
    const confidence = answer?.type === "choice" ? answer.confidence : 0;
    return {
      classification,
      shouldExtract: !shouldRejectPolicyIntake({ classification, confidence }),
      confidence,
      reason: CLASSIFICATION_REASONS[classification],
      detectedTitle: null,
      relationship,
    };
  } catch (error) {
    // Never block extraction on gate infrastructure failures.
    return {
      ...incomplete,
      reason: `Intake classifier unavailable; continuing extraction (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
}
