export const JEV_PROCEED_THRESHOLD = 0.7;
export function jevProceeds(probability: number | undefined): boolean {
  return typeof probability === "number" && probability >= JEV_PROCEED_THRESHOLD;
}
