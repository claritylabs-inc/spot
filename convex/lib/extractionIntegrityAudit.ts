import {
  evaluateExtractionPromotion,
  type ExtractionCompletionManifest,
  type PromotionEvidenceLedger,
} from "./extractionPromotion";

export type ExtractionIntegrityClassification =
  | "verified"
  | "legacy_unverified"
  | "post_cutover_violation";

export function classifyExtractionIntegrity(args: {
  postCutover: boolean;
  ledger?: PromotionEvidenceLedger;
  manifest?: ExtractionCompletionManifest;
  operationalProfile: unknown;
  hasValidCarrierIdentity: boolean;
}) {
  if (!args.ledger || !args.manifest) {
    return {
      classification: args.postCutover
        ? "post_cutover_violation" as const
        : "legacy_unverified" as const,
      reasons: ["persisted source evidence or completion manifest is missing"],
      shouldReextract: true,
    };
  }
  const decision = evaluateExtractionPromotion({
    manifest: args.manifest,
    ledger: args.ledger,
    operationalProfile: args.operationalProfile,
    hasValidCarrierIdentity: args.hasValidCarrierIdentity,
  });
  if (!args.postCutover) {
    return {
      classification: "legacy_unverified" as const,
      reasons: decision.reasons,
      shouldReextract: decision.reasons.length > 0,
    };
  }
  return decision.allowed
    ? {
        classification: "verified" as const,
        reasons: [],
        shouldReextract: false,
      }
    : {
        classification: "post_cutover_violation" as const,
        reasons: decision.reasons,
        shouldReextract: true,
      };
}
