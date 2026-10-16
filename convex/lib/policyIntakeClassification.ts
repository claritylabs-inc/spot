"use node";

// Owner: P4 (docs/architecture/convex-section-extraction.md).
// Jev intake gate: document class plus advisory relationship to the client's
// existing policies. Moves classifyInsuranceExtractability out of
// convex/actions/policyExtraction.ts.

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import dayjs from "dayjs";
import type { DecisionQuestion } from "../../contracts/cl-router/policy";
import { pdfPageJevImage, stageJevImages } from "./jevImages";
import { renderPdfPageImages } from "./pdfPageImages";
import {
  extractPolicyPeriodFromSourceSpans,
  normalizePolicyDate,
} from "./policyPeriodExtraction";
import { clRouterDecide } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";
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
const MAX_RELATIONSHIP_CANDIDATES = 20;

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
    byPage.set(
      page.page,
      [byPage.get(page.page), text].filter(Boolean).join("\n"),
    );
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

/** Reject only when Jev is sufficiently sure the document is not a policy. */
export function shouldRejectPolicyIntake(decision: {
  classification: PolicyIntakeDocumentClass;
  confidence: number;
}): boolean {
  return (
    (decision.classification === "non_insurance" ||
      decision.classification === "insurance_related_but_not_bound_policy") &&
    jevProceeds(decision.confidence)
  );
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
  pdfBytes?: Uint8Array;
  existingPolicies: ExistingPolicyCandidate[];
  traceId?: string;
  policyId?: string;
}): Promise<PolicyIntakeDecision> {
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
  const candidates = rankExistingPolicyCandidates(
    args.existingPolicies.filter(
      (policy) => policy.policyId && policy.policyId !== args.policyId,
    ),
    evidence.text,
  );
  let staged: Awaited<ReturnType<typeof stageJevImages>> | undefined;
  try {
    const missingPages = Array.from(
      { length: args.pageCount },
      (_, i) => i + 1,
    ).filter(
      (page) =>
        !args.pages.some((entry) => entry.page === page && entry.text.trim()),
    );
    let images: Awaited<ReturnType<typeof renderPdfPageImages>> = [];
    try {
      if (args.pdfBytes && missingPages.length) {
        images = await renderPdfPageImages({
          pdfBytes: args.pdfBytes,
          pages: missingPages.slice(0, 4),
          maxSide: 1024,
        });
        if (images.length) {
          staged = await stageJevImages(args.ctx, images.map(pdfPageJevImage), {
            orgId: args.orgId,
            surface: "policy-intake",
            sessionKey: args.policyId ?? args.traceId ?? crypto.randomUUID(),
          });
        }
      }
    } catch (error) {
      images = [];
      console.warn(
        "Intake images unavailable; using text evidence",
        error instanceof Error ? error.message : String(error),
      );
    }
    const canClassify = evidence.text.trim().length > 0 || images.length > 0;
    // Without text or images there is nothing for Jev to judge.
    if (!canClassify) return incomplete;
    const questions: Record<string, DecisionQuestion> = {};
    if (canClassify) {
      for (const [id, instructions] of Object.entries({
        is_insurance_document:
          "Does `upload` contain an insurance document? A payment in an unrelated trust ledger or closing statement is not an insurance document.",
        is_bound_terms:
          "Does `upload` contain already-bound policy terms, such as a binder, declarations, policy wording, endorsement, renewal policy, insurance schedule, or post-binding supplement? Unbound quotes, proposals, applications, and invoices do not establish binding.",
        is_specimen:
          "Does `upload` explicitly identify itself as a specimen, sample, or testing-only insurance policy artifact?",
      }))
        questions[id] = { type: "noul", instructions };
    }
    questions.is_endorsement = {
      type: "noul",
      instructions:
        "Is `upload` primarily a standalone mid-term change document that endorses or amends an existing policy? A complete renewal policy or a forms list merely mentioning endorsements does not establish this.",
    };
    candidates.forEach((candidate, i) => {
      if (candidate.namedInsured)
        questions[`same_insured_${i}`] = {
          type: "noul",
          instructions: `Does the policy in \`upload\` name the same insured as \`existingPolicies[${i}].namedInsured\`? Missing evidence is not a match.`,
        };
      if (candidate.carrier)
        questions[`same_program_${i}`] = {
          type: "noul",
          instructions: `Does the insurance carrier named in \`upload\` match \`existingPolicies[${i}].carrier\`? Missing evidence is not a match.`,
        };
    });
    // Candidates with no comparable fields carry no evidence either way.
    const comparable = candidates.flatMap((_, i) =>
      `same_insured_${i}` in questions || `same_program_${i}` in questions
        ? [i]
        : [],
    );
    const result = await clRouterDecide(
      {
        orgId: String(args.orgId),
        task: "policy_extraction_intake",
        state: {
          upload: {
            text: evidence.text.slice(0, MAX_EVIDENCE_CHARS),
            pages: images.map((image, i) => ({
              page: image.page,
              image: staged!.refs[i],
            })),
          },
          existingPolicies: candidates.map(({ namedInsured, carrier }) => ({
            ...(namedInsured ? { namedInsured } : {}),
            ...(carrier ? { carrier } : {}),
          })),
        },
        ...(staged ? { assets: staged.assets } : {}),
        questions,
        trace: args.traceId ? { traceId: args.traceId } : undefined,
      },
      { telemetry: args.ctx },
    );
    const probability = (id: string) => {
      const answer = result.answers[id];
      return answer?.type === "noul" ? answer.noul : undefined;
    };
    const yes = (id: string) => jevProceeds(probability(id));
    const no = (id: string) => {
      const p = probability(id);
      return p !== undefined && jevProceeds(1 - p);
    };
    let classification: PolicyIntakeDocumentClass = "unknown";
    let confidence = 0;
    if (yes("is_insurance_document")) {
      if (yes("is_specimen")) {
        classification = "specimen_policy_document";
        confidence = Math.min(
          probability("is_insurance_document")!,
          probability("is_specimen")!,
        );
      } else if (yes("is_bound_terms") || yes("is_endorsement")) {
        classification = "bound_policy_document";
        confidence = Math.min(
          probability("is_insurance_document")!,
          Math.max(
            probability("is_bound_terms") ?? 0,
            probability("is_endorsement") ?? 0,
          ),
        );
      } else if (
        no("is_bound_terms") &&
        no("is_specimen") &&
        no("is_endorsement")
      ) {
        classification = "insurance_related_but_not_bound_policy";
        confidence = Math.min(
          probability("is_insurance_document")!,
          1 - probability("is_bound_terms")!,
          1 - probability("is_specimen")!,
          1 - probability("is_endorsement")!,
        );
      }
    } else if (
      no("is_insurance_document") &&
      no("is_bound_terms") &&
      no("is_specimen") &&
      no("is_endorsement")
    ) {
      classification = "non_insurance";
      confidence = Math.min(
        1 - probability("is_insurance_document")!,
        1 - probability("is_bound_terms")!,
        1 - probability("is_specimen")!,
        1 - probability("is_endorsement")!,
      );
    }
    const matching = candidates.flatMap((candidate, i) =>
      yes(`same_insured_${i}`) && yes(`same_program_${i}`)
        ? [{ candidate, i }]
        : [],
    );
    let relationship: PolicyIntakeDecision["relationship"] = {
      ...UNKNOWN_RELATIONSHIP,
    };
    // Relationships remain advisory. Dates and identifiers are compared in code;
    // image-only evidence cannot supply a mechanically verified period here.
    if (matching.length === 1) {
      const { candidate, i } = matching[0];
      const period = extractPolicyPeriodFromSourceSpans(
        args.pages.map((page) => ({ text: page.text, pageStart: page.page })),
      );
      const effective = normalizePolicyDate(candidate.effectiveDate);
      const expiration = normalizePolicyDate(candidate.expirationDate);
      const uploadNumbers = new Set(
        [
          ...evidence.text.matchAll(
            /\bpolicy\s*(?:number|no\.?|#)\s*[:#-]?\s*([a-z0-9][a-z0-9/-]*)/gi,
          ),
        ].map((match) => normalized(match[1])),
      );
      const sameNumber =
        uploadNumbers.size === 1 &&
        uploadNumbers.has(normalized(candidate.policyNumber));
      const samePeriod =
        !!period &&
        period.effectiveDate === effective &&
        period.expirationDate === expiration;
      let kind: PolicyIntakeRelationshipKind = "unknown";
      if (
        period &&
        effective &&
        expiration &&
        dayjs(period.effectiveDate, "MM/DD/YYYY").isAfter(
          dayjs(effective, "MM/DD/YYYY"),
        ) &&
        dayjs(period.expirationDate, "MM/DD/YYYY").isAfter(
          dayjs(expiration, "MM/DD/YYYY"),
        )
      )
        kind = "renewal";
      else if (sameNumber && yes("is_endorsement")) kind = "endorsement";
      else if (sameNumber && samePeriod && no("is_endorsement"))
        kind = "duplicate";
      if (kind !== "unknown") {
        const confidence = [
          probability(`same_insured_${i}`)!,
          probability(`same_program_${i}`)!,
          ...(kind === "endorsement" ? [probability("is_endorsement")!] : []),
          ...(kind === "duplicate" ? [1 - probability("is_endorsement")!] : []),
        ];
        relationship = {
          kind,
          policyId: candidate.policyId,
          confidence: Math.min(...confidence),
        };
      }
    } else if (
      comparable.length &&
      comparable.every(
        (i) => no(`same_insured_${i}`) || no(`same_program_${i}`),
      )
    ) {
      relationship = {
        kind: "new_policy",
        confidence: Math.min(
          ...comparable.map((i) =>
            Math.max(
              1 - (probability(`same_insured_${i}`) ?? 1),
              1 - (probability(`same_program_${i}`) ?? 1),
            ),
          ),
        ),
      };
    }
    return {
      classification,
      // Sampled images are useful for routing, never sufficient to reject a packet.
      shouldExtract:
        yes("is_endorsement") ||
        !evidence.complete ||
        !shouldRejectPolicyIntake({ classification, confidence }),
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
  } finally {
    await staged?.cleanup().catch((error: unknown) => {
      console.warn(
        "Jev image cleanup unavailable",
        error instanceof Error ? error.message : String(error),
      );
    });
  }
}
