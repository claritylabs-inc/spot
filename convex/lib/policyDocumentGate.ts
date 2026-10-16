export const NON_INSURANCE_DOCUMENT_ERROR =
  "This document is not a bound insurance policy, binder, endorsement, renewal, or post-binding insurance document, so extraction was stopped.";

export function isNonInsuranceDocument(error?: string | null): boolean {
  return (
    error?.startsWith("This document is not a bound insurance policy") ?? false
  );
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
    const unit = span.sourceUnit ?? span.metadata?.sourceUnit;
    if (
      unit === "section_candidate" ||
      unit === "citation_annotation" ||
      span.metadata?.textSource === "model_transcription"
    )
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
