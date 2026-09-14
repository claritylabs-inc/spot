type DocumentGateSourceSpan = {
  text: string;
};

export const NON_INSURANCE_DOCUMENT_ERROR =
  "This document is not a bound insurance policy, binder, endorsement, renewal, or post-binding insurance document, so extraction was stopped.";

export function isNonInsuranceDocument(error?: string | null): boolean {
  return error?.startsWith("This document is not a bound insurance policy") ?? false;
}

const SPECIMEN_POLICY_MARKER = /\bSPECIMEN\s+(?:INSURANCE\s+)?POLICY\b/i;
const SPECIMEN_POLICY_HEADING = /^[^A-Z0-9]{0,16}SPECIMEN\s+(?:INSURANCE\s+)?POLICY\b/i;
const SPECIMEN_TEST_DISCLAIMER = /\b(?:FOR\s+TESTING\s+ONLY|NOT\s+AN\s+ACTUAL\s+POLICY)\b/i;

/**
 * Specimen policies are valid extraction fixtures even though their labels and
 * disclaimers correctly say that they are not bound coverage.
 */
export function isSpecimenPolicyDocument(
  sourceSpans: DocumentGateSourceSpan[],
): boolean {
  let hasSpecimenMarker = false;
  let hasTestDisclaimer = false;

  for (const span of sourceSpans) {
    const text = span.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    if (SPECIMEN_POLICY_HEADING.test(text)) return true;
    if (SPECIMEN_POLICY_MARKER.test(text)) hasSpecimenMarker = true;
    if (SPECIMEN_TEST_DISCLAIMER.test(text)) hasTestDisclaimer = true;
  }

  return hasSpecimenMarker && hasTestDisclaimer;
}
