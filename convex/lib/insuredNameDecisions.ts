"use node";

// Named-insured candidates that still differ after code normalization (case,
// punctuation) go to Jev: does each candidate name the same insured as the
// declarations? The grouping is persisted in the evidence ledger, so the
// promotion gate stays deterministic.

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { DecisionQuestion } from "../../contracts/cl-router/policy";
import { clRouterDecide } from "./clRouterClient";
import {
  namedInsuredCandidatesNeedingDecision,
  promotionComparisonKey,
  type PromotionEvidenceLedger,
} from "./extractionPromotion";
import { jevProceeds } from "./jevThreshold";

/** One request holds up to 128 questions; stay well under it. */
const MAX_CANDIDATES = 40;

/**
 * Returns groups of comparison keys that name the same insured, for
 * `buildPromotionEvidenceLedger({ namedInsuredEquivalentKeys })`. Candidates
 * Jev is unsure about, or that it cannot judge, stay distinct (ambiguous).
 */
export async function decideNamedInsuredEquivalences(
  ctx: ActionCtx,
  params: {
    orgId: Id<"organizations">;
    traceId?: string;
    policyId: string;
    ledger: PromotionEvidenceLedger;
    /** The extracted profile's named insured, when it has one. */
    declaredNamedInsured?: string;
  },
): Promise<string[][]> {
  const distinct = namedInsuredCandidatesNeedingDecision(params.ledger);
  if (distinct.length === 0) return [];
  const declared = params.declaredNamedInsured?.trim();
  const referenceKey = declared
    ? promotionComparisonKey("named_insured", declared)
    : distinct[0]!.key;
  const reference = declared || distinct[0]!.value;
  const others = distinct
    .filter((candidate) => candidate.key !== referenceKey)
    .slice(0, MAX_CANDIDATES);
  if (others.length === 0) return [];
  try {
    const candidates: Record<string, string> = {};
    const questions: Record<string, DecisionQuestion> = {};
    others.forEach((candidate, index) => {
      candidates[`c${index}`] = candidate.value;
      questions[`c${index}`] = {
        type: "noul",
        instructions: `Does \`candidates.c${index}\` name the same insured as \`declarations.namedInsured\`? A different punctuation, abbreviation, or legal-suffix spelling of the same entity counts. A parent, subsidiary, affiliate, additional insured, or other party does not.`,
        criteria: {
          true: "Same entity written differently",
          false: "A different entity or a non-insured party",
        },
      };
    });
    const result = await clRouterDecide(
      {
        orgId: String(params.orgId),
        task: "named_insured_equivalence",
        ...(params.traceId ? { trace: { traceId: params.traceId } } : {}),
        state: { declarations: { namedInsured: reference }, candidates },
        questions,
      },
      { telemetry: ctx },
    );
    const same = others.flatMap((candidate, index) => {
      const answer = result.answers[`c${index}`];
      return answer?.type === "noul" && jevProceeds(answer.noul)
        ? [candidate.key]
        : [];
    });
    return same.length ? [[referenceKey, ...same]] : [];
  } catch {
    return [];
  }
}
