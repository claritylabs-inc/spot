type DocumentGateSourceSpan = {
  text: string;
};

export const NON_INSURANCE_DOCUMENT_ERROR =
  "This document is not a bound insurance policy, binder, endorsement, renewal, or post-binding insurance document, so extraction was stopped.";

export function isNonInsuranceDocument(error?: string | null): boolean {
  return (
    error?.startsWith("This document is not a bound insurance policy") ?? false
  );
}

const SPECIMEN_POLICY_MARKER = /\bSPECIMEN\s+(?:INSURANCE\s+)?POLICY\b/i;
const SPECIMEN_POLICY_HEADING =
  /^[^A-Z0-9]{0,16}SPECIMEN\s+(?:INSURANCE\s+)?POLICY\b/i;
const SPECIMEN_TEST_DISCLAIMER =
  /\b(?:FOR\s+TESTING\s+ONLY|NOT\s+AN\s+ACTUAL\s+POLICY)\b/i;

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

/** Only complete parsed pages can support rejecting a PDF without seeing its images. */
export function buildDocumentGateEvidence(
  sourceSpans: Array<{
    pageStart?: number;
    text: string;
    sourceUnit?: string;
    metadata?: Record<string, unknown>;
  }>,
  pageCount: number,
): { complete: boolean; text: string } {
  const pages = new Map<number, string[]>();
  for (const span of sourceSpans) {
    if ((span.sourceUnit ?? span.metadata?.sourceUnit) === "section_candidate")
      continue;
    const page = span.pageStart;
    const text = span.text.trim();
    if (
      !Number.isInteger(page) ||
      !page ||
      page < 1 ||
      page > pageCount ||
      !text
    )
      continue;
    const parts = pages.get(page) ?? [];
    if (!parts.includes(text)) parts.push(text);
    pages.set(page, parts);
  }
  // Missing/blank parsed pages may contain image-only declarations or endorsements.
  if (
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    pages.size !== pageCount
  ) {
    return { complete: false, text: "" };
  }
  const text = [...pages.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, parts]) => `Page ${page}:\n${parts.join("\n")}`)
    .join("\n\n");
  // Do not truncate and then treat quote frontmatter as the entire policy packet.
  return text.length <= 60_000
    ? { complete: true, text }
    : { complete: false, text: "" };
}
