"use node";

/**
 * Agent prompts and context building — cl-sdk
 *
 * SDK exports (unchanged): buildAgentSystemPrompt, buildConversationMemoryGuidance
 * Local implementations: buildConversationMemoryContext (disabled no-op)
 *
 * The old SDK's buildDocumentContext/buildConversationMemoryContext are removed.
 * Policy retrieval goes through the lookup tools (lib/policySearch.ts); raw
 * conversation recall is intentionally disabled.
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

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { formatComplianceRequirementsContext } from "./complianceAgent";

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
