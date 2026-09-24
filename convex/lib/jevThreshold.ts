// Single decision threshold for Jev (clRouterDecide) answers: act when Jev is
// at least 70% sure. Choice answers use `confidence` (or the chosen option's
// probability); yes/no ("noul") answers use the returned probability.
export const JEV_PROCEED_THRESHOLD = 0.7;

export function jevProceeds(probability: number | undefined): boolean {
  return typeof probability === "number" && probability >= JEV_PROCEED_THRESHOLD;
}
