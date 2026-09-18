"use node";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { generateAgentTextForOrg, generatedTextFromResult } from "./models";
import { collectToolAudit, type AgentToolAudit } from "./agentToolAudit";

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

export async function runAgentTurn(ctx: ActionCtx, args: RunAgentTurnArgs) {
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

  return { audit, text, routerRequestId };
}
