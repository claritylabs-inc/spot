"use node";

import type { ModelMessage } from "ai";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { RouterJobPending } from "./routerJobClient";
import { estimateAgentHistoryTokens } from "./agentMessageHistory";
import {
  generateAgentTextForPublicTask,
  generatedTextFromResult,
} from "./models";
import {
  OPERATOR_COMPACTION_OUTPUT_TOKENS,
  OPERATOR_COMPACTION_PROMPT,
  OPERATOR_COMPACTION_SOURCE_TOKENS,
  operatorContextReferences,
  operatorWorkingNotes,
  splitOperatorContext,
} from "./operatorContextCompaction";

export async function compactOperatorContext(
  ctx: ActionCtx,
  args: {
    run: Doc<"operatorAgentRuns">;
    messages: ModelMessage[];
    invocationKey: string;
    keepRecentSteps?: number;
    focus?: string;
    maxHistoryTokens?: number;
  },
): Promise<ModelMessage[]> {
  const latestUser = [...args.messages]
    .reverse()
    .find((message) => message.role === "user");
  let keep = args.keepRecentSteps ?? 4;
  let split = splitOperatorContext(args.messages, keep);
  const retainedEstimate = (candidate: typeof split) =>
    estimateAgentHistoryTokens(
      JSON.stringify([
        operatorWorkingNotes(
          "x".repeat(OPERATOR_COMPACTION_OUTPUT_TOKENS * 4),
          operatorContextReferences(candidate.older),
          args.run.objective,
        ),
        ...(latestUser && candidate.older.includes(latestUser)
          ? [latestUser]
          : []),
        ...candidate.recent,
      ]),
    ) +
    (candidate.recent.length + 2) * 8;
  while (
    keep > 1 &&
    retainedEstimate(split) > (args.maxHistoryTokens ?? Infinity)
  ) {
    keep -= 1;
    split = splitOperatorContext(args.messages, keep);
  }
  const { older, recent } = split;
  if (!older.length) return args.messages;
  const references = operatorContextReferences(older);
  const source = JSON.stringify(older);
  let summary = "";
  let offset = 0;
  let batch = 0;
  while (offset < source.length) {
    let end = Math.min(source.length, offset + 36_000);
    while (estimateAgentHistoryTokens(source.slice(offset, end)) > 12_000) {
      end = offset + Math.floor((end - offset) / 2);
    }
    const prompt = JSON.stringify({
      previousNotes: summary,
      objective: args.run.objective,
      checkpoint: args.run.checkpoint,
      focus: args.focus,
      sourceFragment: source.slice(offset, end),
      fragment: batch,
      lastFragment: end === source.length,
    });
    if (
      estimateAgentHistoryTokens(prompt + OPERATOR_COMPACTION_PROMPT) >
      OPERATOR_COMPACTION_SOURCE_TOKENS
    ) {
      throw new Error(
        "[context_compaction_failed] Compaction input exceeds its bounded summary budget",
      );
    }
    const result = await generateAgentTextForPublicTask(
      ctx,
      "summary",
      {
        system: OPERATOR_COMPACTION_PROMPT,
        prompt,
        maxOutputTokens: OPERATOR_COMPACTION_OUTPUT_TOKENS,
      },
      {
        durable: { invocationKey: `${args.invocationKey}:compact:${batch}` },
        sessionKey: `operator:${args.run.threadId}:compaction`,
        taskKind: "query_respond",
        trace: {
          traceId: `${args.run._id}:context-compaction`,
          parentRequestId: String(args.run.userMessageId),
          label: "convex.operatorContextCompaction",
          phase: "summary",
          channel: "web",
        },
      },
    ).catch((error: unknown) => {
      if (error instanceof RouterJobPending) throw error;
      throw new Error(
        "[context_compaction_failed] Routed context summary failed",
        { cause: error },
      );
    });
    summary = generatedTextFromResult(result).trim();
    if (!summary)
      throw new Error(
        "[context_compaction_failed] Compaction returned empty working notes",
      );
    offset = end;
    batch += 1;
  }
  // Keep the latest actual user request verbatim even after many tool steps.
  return [
    operatorWorkingNotes(summary, references, args.run.objective),
    ...(latestUser && older.includes(latestUser) ? [latestUser] : []),
    ...recent,
  ];
}
