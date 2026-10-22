// Single decision threshold for Jev (clRouterDecide) answers: act when Jev is
// at least this sure. Choice answers use `confidence` (or the chosen option's
// probability); yes/no ("noul") answers use the returned probability.
// Override with the JEV_PROCEED_THRESHOLD env var (0.5–0.99); read per call so
// a Convex env change applies without a redeploy.
const DEFAULT_JEV_PROCEED_THRESHOLD = 0.7;

export function jevProceedThreshold(): number {
  const configured = Number(process.env.JEV_PROCEED_THRESHOLD);
  return Number.isFinite(configured) && configured >= 0.5 && configured <= 0.99
    ? configured
    : DEFAULT_JEV_PROCEED_THRESHOLD;
}

export function jevProceeds(probability: number | undefined): boolean {
  return (
    typeof probability === "number" && probability >= jevProceedThreshold()
  );
}

export type JevDecisionRisk = "suggestion" | "prefill" | "omission";

/** Intake writes and question omission have independently configurable risk gates. */
export function jevRiskThreshold(risk: JevDecisionRisk): number {
  if (risk === "suggestion") return jevProceedThreshold();
  const configured = Number(
    process.env[risk === "prefill" ? "JEV_PREFILL_THRESHOLD" : "JEV_OMISSION_THRESHOLD"],
  );
  return Number.isFinite(configured) && configured >= 0.5 && configured <= 0.99
    ? configured
    : risk === "prefill" ? 0.8 : 0.9;
}

/** Missing/invalid decisions take the same human-input path as ambiguous evidence. */
export function jevDecisionBand(
  probability: number | undefined,
  risk: JevDecisionRisk,
): "low" | "uncertain" | "high" {
  if (typeof probability !== "number" || !Number.isFinite(probability) ||
    probability < 0 || probability > 1) return "uncertain";
  const high = jevRiskThreshold(risk);
  if (probability >= high) return "high";
  return probability <= 1 - high ? "low" : "uncertain";
}

export function jevChoiceConfidence(answer: {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}): number {
  return Math.min(answer.confidence, answer.probabilities[answer.choice] ?? 0);
}
