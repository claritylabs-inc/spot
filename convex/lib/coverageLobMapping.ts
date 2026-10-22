import type { CoverageId } from "../../lib/insurance-intake-details";

/** ACORD LOB code on a requirement or policy -> the Spot intake coverage it fills. */
export const ACORD_LOB_TO_COVERAGE: Readonly<Record<string, CoverageId>> = {
  CGL: "general_liability",
  PROP: "property",
  AUTOB: "commercial_auto",
  WORK: "workers_compensation",
  WCMA: "workers_compensation",
  EO: "professional_liability",
  PL: "professional_liability",
  CYBER: "cyber",
  UMBRC: "umbrella",
  EXLIA: "umbrella",
};

/**
 * Spot intake coverage -> provider appetite codes that can write it. A bundled
 * code (BOP, CPKGE) covers each of its component lines. Coverages absent here
 * (`other`, `unknown`) cannot be evaluated against appetite.
 */
export const COVERAGE_PROVIDER_LOB_CODES: Readonly<
  Partial<Record<CoverageId, readonly string[]>>
> = {
  general_liability: ["CGL", "BOP", "CPKGE"],
  property: ["PROP", "BOP", "CPKGE"],
  workers_compensation: ["WORK"],
  commercial_auto: ["AUTOB", "TRUCK"],
  professional_liability: ["EO", "PL"],
  cyber: ["CYBER"],
  umbrella: ["UMBRC", "EXLIA"],
};

/** Provider codes accepted for a coverage, or `null` when it cannot be evaluated. */
export function providerCodesForCoverage(coverage: CoverageId) {
  return COVERAGE_PROVIDER_LOB_CODES[coverage] ?? null;
}
