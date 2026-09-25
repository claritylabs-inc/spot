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
  return typeof probability === "number" && probability >= jevProceedThreshold();
}
