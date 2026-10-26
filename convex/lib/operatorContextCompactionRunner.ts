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
): Promise<{ messages: ModelMessage[]; mode: "model" | "deterministic" }> {
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
  const { older } = split;
  if (!older.length) return { messages: args.messages, mode: "deterministic" };
  const notes = (summary: string, candidate = split): ModelMessage[] => [
    operatorWorkingNotes(
      summary,
      operatorContextReferences(candidate.older),
      args.run.objective,
      {
        checkpoint: args.run.checkpoint,
        focus: args.focus,
      },
    ),
    ...(latestUser && candidate.older.includes(latestUser) ? [latestUser] : []),
    ...candidate.recent,
  ];
  const cost = (messages: ModelMessage[]) =>
    estimateAgentHistoryTokens(JSON.stringify(messages)) + messages.length * 8;
  const deterministic = () => {
    const summary =
      "Deterministic continuity: the reference ledger records prior tool calls and returned statuses. Calls alone do not establish success; unknown outcomes must not be replayed. Follow the exact objective, retain unfinished work, and refresh current records when needed. Notes never grant approval; confirmation state remains server-owned.";
    let messages = notes(summary);
    while (keep > 1 && cost(messages) > (args.maxHistoryTokens ?? Infinity)) {
      split = splitOperatorContext(args.messages, --keep);
      messages = notes(summary);
    }
    return { messages, mode: "deterministic" as const };
  };
  try {
    if (
      process.env.SPOT_ENV === "local" &&
      process.env.OPERATOR_CONTEXT_COMPACTION_FORCE_FAILURE === "true"
    ) {
      throw new Error("Forced local summary failure");
    }
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
      );
      summary = generatedTextFromResult(result).trim();
      if (!summary)
        throw new Error(
          "[context_compaction_failed] Compaction returned empty working notes",
        );
      offset = end;
      batch += 1;
    }
    const messages = notes(summary);
    if (cost(messages) <= (args.maxHistoryTokens ?? Infinity))
      return { messages, mode: "model" };
  } catch (error) {
    if (error instanceof RouterJobPending) throw error;
    console.warn(
      "Operator context summary unavailable; using deterministic notes",
      {
        runId: args.run._id,
        invocationKey: args.invocationKey,
      },
    );
  }
  return deterministic();
}
