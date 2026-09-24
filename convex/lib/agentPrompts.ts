"use node";

/**
 * Agent prompts and context building — cl-sdk
 *
 * SDK exports (unchanged): buildAgentSystemPrompt, buildConversationMemoryGuidance
 * Local implementations: buildDocumentContext (source search + Jev ranking), buildConversationMemoryContext (disabled no-op)
 *
 * The old SDK's buildDocumentContext/buildConversationMemoryContext are removed.
 * Policy retrieval is source-backed; raw conversation recall is intentionally disabled.
 */

// SDK exports (still work)
export {
  buildAgentSystemPrompt,
  buildConversationMemoryGuidance,
} from "@claritylabs/cl-sdk";
export type {
  PolicyDocument,
  AgentContext,
  Platform,
  CommunicationIntent,
} from "@claritylabs/cl-sdk";

// Local mapping
export { policyToInsuranceDoc } from "./documentMapping";

import type { Doc, Id } from "../_generated/dataModel";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { formatComplianceRequirementsContext } from "./complianceAgent";
import { formatCoverageBreakdownForPrompt } from "./coverageBreakdown";
import {
  candidatePages,
  searchPolicySources,
  type PolicySearchResult,
} from "./policySearch";

const DOCUMENT_CONTEXT_RESULT_LIMIT = 12;

/**
 * Build org-wide document context: full-text search over source spans/nodes,
 * Jev-ranked, grouped per policy with each policy's operational profile.
 */
export async function buildDocumentContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  policies: Doc<"policies">[],
  queryText: string,
): Promise<{
  context: string;
  relevantPolicyIds: Id<"policies">[];
}> {
  if (policies.length === 0) {
    return {
      context:
        "NO POLICIES FOUND. The user has not imported any bound insurance policies yet.",
      relevantPolicyIds: [],
    };
  }

  const { results, searchedPolicyIds } = await searchPolicySources(ctx, {
    orgId,
    policies,
    query: queryText,
    maxResults: DOCUMENT_CONTEXT_RESULT_LIMIT,
  });
  const resultsByPolicy = new Map<Id<"policies">, PolicySearchResult[]>();
  for (const result of results) {
    const policyResults = resultsByPolicy.get(result.policyId) ?? [];
    policyResults.push(result);
    resultsByPolicy.set(result.policyId, policyResults);
  }
  // Without matches, a Jev pre-selection is still the best guess at relevant policies.
  const relevantPolicyIds =
    resultsByPolicy.size > 0
      ? [...resultsByPolicy.keys()]
      : searchedPolicyIds.length < policies.length
        ? searchedPolicyIds
        : [];

  const indexLines = policies.map((p, i) => {
    const types =
      policyLobCodes(p)
        .map((code) => `${code} (${lobLabel(code)})`)
        .join(", ") || "unknown";
    const carrier = p.carrier || p.security;
    const covSummary = formatCoverageBreakdownForPrompt(p, 8).replace(
      /\n/g,
      " | ",
    );
    const covLine = covSummary ? ` | Coverages: ${covSummary}` : "";
    return `[${i + 1}] ${carrier} | #${p.policyNumber} | LOB: ${types} | ${p.effectiveDate} to ${p.expirationDate ?? "continuous"} | Insured: ${p.insuredName}${covLine}`;
  });
  const parts = [
    `POLICY INDEX (${policies.length} bound policies):\n${indexLines.join("\n")}`,
  ];

  const policyMap = new Map(policies.map((p) => [p._id, p]));
  const sourceTreeSections: string[] = [];
  for (const policyId of relevantPolicyIds) {
    const policy = policyMap.get(policyId);
    if (!policy) continue;
    const carrier = policy.carrier || policy.security;
    let section = `\n--- POLICY SOURCE TREE: ${carrier} #${policy.policyNumber} (ID:${policyId}) ---`;
    const profile = policy.operationalProfile
      ? JSON.stringify(policy.operationalProfile, null, 2).slice(0, 5000)
      : "";
    if (profile) section += `\nOperational profile:\n${profile}`;
    for (const result of resultsByPolicy.get(policyId) ?? []) {
      section += `\n\n${formatSourceResultTag(result)}\n${result.text}`;
    }
    sourceTreeSections.push(section);
  }

  parts.push(
    sourceTreeSections.length > 0
      ? `SOURCE-TREE EVIDENCE (canonical for exact policy wording and provenance):\n${sourceTreeSections.join("\n")}`
      : "SOURCE-TREE EVIDENCE: no policy source passages matched this question.",
  );

  return {
    context: parts.join("\n\n"),
    relevantPolicyIds,
  };
}

export function formatSourceResultTag(result: PolicySearchResult): string {
  const pages = candidatePages(result);
  const fields = [
    result.sourceNodeIds.length > 0
      ? `sourceNode:${result.sourceNodeIds[0]} kind:${result.kind}${result.path ? ` path:${result.path}` : ""}`
      : `sourceSpan:${result.sourceSpanIds[0] ?? "none"}`,
    `title:"${result.title}"`,
    pages ? `pages:${pages}` : undefined,
    `sourceSpanIds:${result.sourceSpanIds.join(",")}`,
    result.relevance !== undefined
      ? `score:${result.relevance.toFixed(2)}`
      : undefined,
  ];
  return `[${fields.filter(Boolean).join(" ")}]`;
}

export async function buildComplianceRequirementsContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<string> {
  try {
    const requirements = await ctx.runQuery(
      internal.compliance.listRequirementsInternal,
      { orgId },
    );
    return formatComplianceRequirementsContext(requirements);
  } catch {
    return "";
  }
}

/**
 * Raw cross-thread conversation memory is disabled.
 */
export async function buildConversationMemoryContext(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  queryText: string,
): Promise<string> {
  void ctx;
  void orgId;
  void queryText;
  return "";
}

/**
 * Legacy-compatible no-op. Raw conversation snippets should not steer answers.
 */
export function buildConversationMemoryFromList(
  conversations: Array<{
    _creationTime: number;
    fromName?: string;
    fromEmail: string;
    subject: string;
    body: string;
    responseBody?: string;
  }>,
): string {
  void conversations;
  return "";
}
