"use node";

import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  generateAgentTextForOrg,
  generateObjectForOrg,
  generatedTextFromResult,
} from "./models";
import {
  collectToolAudit,
  mergeToolAudits,
  type AgentToolAudit,
} from "./agentToolAudit";

const PolicyEvidenceDecisionSchema = z.object({
  requiresPolicyEvidence: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const POLICY_EVIDENCE_TOOL_NAMES = [
  "lookup_policy",
  "lookup_policy_section",
  "compare_coverages",
] as const;
const POLICY_EVIDENCE_TOOLS = new Set<string>(POLICY_EVIDENCE_TOOL_NAMES);

const REPLAY_SAFE_TOOLS = new Set([
  ...POLICY_EVIDENCE_TOOL_NAMES,
  "lookup_company_context",
  "lookup_compliance_requirements",
  "lookup_connected_vendors",
  "lookup_vendor_policies",
  "lookup_vendor_compliance",
  "lookup_address",
  "search_connected_email",
  "read_connected_email",
  "read_connected_email_attachment",
  "search_thread_history",
  "read_thread_attachment",
  "web_research",
]);

const POLICY_EVIDENCE_UNAVAILABLE_MESSAGE =
  "I couldn't retrieve the policy evidence needed to answer that reliably. Please try again in a moment.";

export const AGENT_MAX_OUTPUT_TOKENS = 8_192;

const COMPLETED_TOOL_SYNTHESIS_INSTRUCTION =
  "Continue from the completed tool results above and give the user the final answer. Do not repeat any completed action. No tools are available in this continuation.";

type AgentOptions = Parameters<typeof generateAgentTextForOrg>[3];
type AgentTools = NonNullable<AgentOptions["tools"]>;

type AgentTurnOptions = AgentOptions & {
  system: string;
  tools: AgentTools;
};

type RunAgentTurnArgs = {
  orgId: Id<"organizations">;
  task: Parameters<typeof generateAgentTextForOrg>[2];
  options: AgentTurnOptions;
  run: Parameters<typeof generateAgentTextForOrg>[4];
  messageText: string;
  recentConversationContext?: string;
  currentAttachmentNames?: string[];
  auditExcludedTools?: ReadonlySet<string>;
};

function filterAudit(
  audit: AgentToolAudit,
  excludedTools?: ReadonlySet<string>,
): AgentToolAudit {
  if (!excludedTools?.size) return audit;
  return {
    usedTools: audit.usedTools.filter((name) => !excludedTools.has(name)),
    completedTools: audit.completedTools.filter(
      (name) => !excludedTools.has(name),
    ),
    toolCalls: audit.toolCalls.filter((call) => !excludedTools.has(call.name)),
    workflowOutcomes: audit.workflowOutcomes,
  };
}

function hasCompletedPolicyEvidence(audit: AgentToolAudit) {
  return audit.completedTools.some((name) => POLICY_EVIDENCE_TOOLS.has(name));
}

async function synthesizeCompletedToolResults(
  ctx: ActionCtx,
  args: RunAgentTurnArgs,
  result: Awaited<ReturnType<typeof generateAgentTextForOrg>>,
): Promise<{ text: string; routerRequestId?: string }> {
  if (!Array.isArray(args.options.messages)) return { text: "" };
  const responseMessages = result.response?.messages;
  if (!Array.isArray(responseMessages) || responseMessages.length === 0) {
    return { text: "" };
  }

  try {
    const synthesis = await generateAgentTextForOrg(
      ctx,
      args.orgId,
      args.task,
      {
        maxOutputTokens:
          args.options.maxOutputTokens ?? AGENT_MAX_OUTPUT_TOKENS,
        system: `${args.options.system}\n\nFINAL RESPONSE CONTINUATION:\n${COMPLETED_TOOL_SYNTHESIS_INSTRUCTION}`,
        messages: [
          ...args.options.messages,
          ...responseMessages,
          { role: "user", content: COMPLETED_TOOL_SYNTHESIS_INSTRUCTION },
        ],
        ...(args.options.abortSignal
          ? { abortSignal: args.options.abortSignal }
          : {}),
      },
      {
        ...args.run,
        trace: {
          ...args.run.trace,
          traceId: `${args.run.trace.traceId}:tool-synthesis`,
          label: `${args.run.trace.label}.toolSynthesis`,
        },
      },
    );
    return {
      text: generatedTextFromResult(synthesis),
      ...(synthesis.clRouter?.requestId
        ? { routerRequestId: synthesis.clRouter.requestId }
        : {}),
    };
  } catch (error) {
    console.warn("[agent-turn] Completed-tool synthesis failed", error);
    return { text: "" };
  }
}

async function requiresPolicyEvidence(ctx: ActionCtx, args: RunAgentTurnArgs) {
  try {
    const result = await generateObjectForOrg(
      ctx,
      args.orgId,
      "classification",
      {
        schema: PolicyEvidenceDecisionSchema,
        maxOutputTokens: 96,
        system: `Decide whether answering the current message requires private policy evidence from the organization's Spot policy records.

Set requiresPolicyEvidence true only for an informational answer that depends on the organization's actual policy facts, including coverage, limits, deductibles, premiums, dates, carriers, insured parties, endorsements, exclusions, conditions, wording, or comparisons between its policies.

Set it false for general insurance explanations, greetings, product-capability questions, requests fully answerable from a current attachment, and requests whose primary outcome is an action such as drafting or sending email, generating a certificate, changing a policy, or coordinating mailbox work. Those workflows enforce their own evidence rules.

Use recent conversation only to resolve contextual follow-ups. If the message combines a generic concept with a question about the organization's actual policy, set it true. Return only the structured decision.`,
        prompt: JSON.stringify({
          currentMessage: args.messageText,
          recentConversation: args.recentConversationContext?.slice(-1600),
          currentAttachments: args.currentAttachmentNames,
        }),
      },
      { taskKind: "query_classify" },
    );
    return (
      result.object.requiresPolicyEvidence && result.object.confidence >= 0.65
    );
  } catch (error) {
    console.warn("[agent-turn] Policy evidence classification failed", error);
    return false;
  }
}

export async function runAgentTurn(ctx: ActionCtx, args: RunAgentTurnArgs) {
  const evidenceDecision = requiresPolicyEvidence(ctx, args);
  const result = await generateAgentTextForOrg(
    ctx,
    args.orgId,
    args.task,
    args.options,
    args.run,
  );
  const audit = filterAudit(collectToolAudit(result), args.auditExcludedTools);
  let text = generatedTextFromResult(result);
  let routerRequestId = result.clRouter?.requestId;

  if (
    audit.completedTools.length > 0 &&
    (!text.trim() || result.finishReason === "length")
  ) {
    const synthesis = await synthesizeCompletedToolResults(ctx, args, result);
    text = synthesis.text;
    routerRequestId = synthesis.text.trim()
      ? synthesis.routerRequestId
      : undefined;
  }

  if (!(await evidenceDecision) || hasCompletedPolicyEvidence(audit)) {
    return { audit, text, routerRequestId };
  }

  const canRetry = audit.usedTools.every((name) => REPLAY_SAFE_TOOLS.has(name));
  const recoveryTools = Object.fromEntries(
    POLICY_EVIDENCE_TOOL_NAMES.flatMap((name) =>
      args.options.tools[name] ? [[name, args.options.tools[name]]] : [],
    ),
  ) as AgentTools;

  if (!canRetry || Object.keys(recoveryTools).length === 0) {
    return { audit, text: POLICY_EVIDENCE_UNAVAILABLE_MESSAGE };
  }
  const firstEvidenceTool = Object.keys(recoveryTools)[0];

  try {
    const retryResult = await generateAgentTextForOrg(
      ctx,
      args.orgId,
      args.task,
      {
        ...args.options,
        system: `${args.options.system}\n\nPOLICY EVIDENCE RECOVERY:\n- The previous attempt did not complete a current-turn policy evidence lookup required for this answer.\n- Use the available read-only policy tools silently, then answer from their result.\n- If the tools find no matching policy or cannot retrieve the needed evidence, report that concrete outcome instead of promising future work.`,
        tools: recoveryTools,
        prepareStep: ({ stepNumber }) =>
          stepNumber === 0
            ? { toolChoice: { type: "tool" as const, toolName: firstEvidenceTool } }
            : undefined,
      },
      {
        ...args.run,
        trace: {
          ...args.run.trace,
          traceId: `${args.run.trace.traceId}:policy-evidence-retry`,
          label: `${args.run.trace.label}.policyEvidenceRetry`,
        },
      },
    );
    const retryAudit = filterAudit(
      collectToolAudit(retryResult),
      args.auditExcludedTools,
    );
    return {
      audit: mergeToolAudits(audit, retryAudit),
      text: hasCompletedPolicyEvidence(retryAudit)
        ? generatedTextFromResult(retryResult)
        : POLICY_EVIDENCE_UNAVAILABLE_MESSAGE,
      ...(hasCompletedPolicyEvidence(retryAudit) && retryResult.clRouter?.requestId
        ? { routerRequestId: retryResult.clRouter.requestId }
        : {}),
    };
  } catch (error) {
    console.warn("[agent-turn] Policy evidence retry failed", error);
    return { audit, text: POLICY_EVIDENCE_UNAVAILABLE_MESSAGE };
  }
}
