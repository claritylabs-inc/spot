"use node";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  candidatePages,
  searchPolicySources,
  type PolicySearchResult,
  type SearchablePolicy,
} from "./policySearch";

function confidenceLabel(relevance: number | undefined) {
  if (relevance === undefined) return undefined;
  return relevance >= 2.5 ? "high" : relevance >= 1.5 ? "medium" : "low";
}

export function toPolicyLookupResult(
  result: PolicySearchResult,
): Record<string, unknown> {
  const node = result.sourceNodeIds.length > 0;
  return {
    title: result.title,
    type: node ? "policy_source_node" : "original_pdf_source_span",
    evidenceSource: node ? "source_tree" : "original_pdf",
    originalPdfChecked: true,
    confidence: confidenceLabel(result.relevance),
    pages: candidatePages(result),
    content: result.text,
    sourceNodeIds: result.sourceNodeIds,
    sourceSpanIds: result.sourceSpanIds,
    sourceSpans: result.spans.map((span) => ({
      id: span.spanId,
      pageStart: span.pageStart,
      pageEnd: span.pageEnd,
      sourceUnit: span.sourceUnit,
      parentSpanId: span.parentSpanId,
      bbox: span.bbox,
      text: span.text.slice(0, 1200),
    })),
    ...(node
      ? {
          sourceNodes: [
            {
              id: result.sourceNodeIds[0],
              kind: result.kind,
              path: result.path,
              title: result.title,
              sourceSpanIds: result.sourceSpanIds,
              pageStart: result.pageStart,
              pageEnd: result.pageEnd,
            },
          ],
        }
      : {}),
  };
}

/** Source-backed evidence for one policy: full-text candidates ranked by Jev. */
export async function searchPolicySourceEvidence(
  ctx: ActionCtx,
  policy: SearchablePolicy & { orgId: Id<"organizations"> },
  query: string,
  maxResults = 8,
): Promise<Array<Record<string, unknown>> | string> {
  const { results } = await searchPolicySources(ctx, {
    orgId: policy.orgId,
    policy,
    query,
    maxResults,
  });
  if (results.length === 0) {
    return `No source evidence in this policy matched "${query}". Try the policy's own wording, such as a coverage name, form title, or defined term.`;
  }
  return results.map(toPolicyLookupResult);
}
