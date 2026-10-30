import type { JSONValue, ModelMessage } from "ai";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { actionConfirmationFingerprint } from "./actionConfirmationFingerprint";
import { collectToolAudit, type AgentToolAudit } from "./agentToolAudit";
import {
  toolActivityTarget,
  toolOutcomeStatus,
  type MessageActivityUpdate,
} from "./messageActivity";
import {
  operatorAgentIntentPrefetch,
  type OperatorIntentPrefetchRead,
} from "./operatorAgentIntentRegistry";
import {
  getOperatorAgentToolSpec,
  parseOperatorAgentToolInput,
  type OperatorAgentToolName,
} from "./operatorAgentToolRegistry";
import type { OperatorToolTiming } from "./operatorRunTiming";
import { boundToolOutput } from "./operatorToolOutput";
import { summarizeToolResult } from "./toolResultSummary";

export type PrefetchedRead = {
  toolCallId: string;
  toolName: OperatorAgentToolName;
  input: Record<string, unknown>;
  outcome: unknown;
};

/** What happened to one declared read: run, or why it did not. */
export type PrefetchReadStatus = {
  toolName: OperatorAgentToolName;
  status: "succeeded" | "failed" | "skipped" | "unavailable";
};

type PrefetchArgs = {
  run: Doc<"operatorAgentRuns">;
  toolNames: readonly OperatorAgentToolName[];
  channel: "chat" | "email" | "imessage" | "slack" | "mcp";
  recordActivity: (update: MessageActivityUpdate) => Promise<void>;
  /** Metadata-only timing of each executed read. */
  onReadTiming?: (timing: OperatorToolTiming) => void;
};

/**
 * Runs declared plain reads through the normal operator executor
 * (authorization, audit rows, and run-scoped idempotency keys shared with
 * model calls, so a replayed step returns the stored result). Stages run in
 * order; reads within a stage run together. Fails open: a failed or skipped
 * read is left for the model to make itself. Activity ids are
 * `prefetch_<tool>`, suffixed when `reservedToolCallIds` already holds one.
 */
export async function runOperatorPrefetchReads(
  ctx: ActionCtx,
  args: PrefetchArgs & {
    stages: ReadonlyArray<readonly OperatorIntentPrefetchRead[]>;
    focus: Readonly<Record<string, string>>;
    relatedId?: (kind: string) => string | undefined;
    reservedToolCallIds?: ReadonlySet<string>;
  },
) {
  const results = new Map<OperatorAgentToolName, unknown>();
  const reads: PrefetchedRead[] = [];
  const statuses: PrefetchReadStatus[] = [];
  const reserved = new Set(args.reservedToolCallIds);
  const toolCallIdFor = (toolName: OperatorAgentToolName) => {
    let id = `prefetch_${toolName}`;
    for (let index = 2; reserved.has(id); index += 1)
      id = `prefetch_${toolName}_${index}`;
    reserved.add(id);
    return id;
  };
  const read = async (
    step: OperatorIntentPrefetchRead,
  ): Promise<PrefetchedRead | undefined> => {
    const spec = getOperatorAgentToolSpec(step.toolName);
    // Only plain reads this operator may call are prefetched.
    if (
      !args.toolNames.includes(step.toolName) ||
      spec.effect !== "read" ||
      spec.confirmation !== "none" ||
      spec.execution !== "mutation"
    ) {
      statuses.push({ toolName: step.toolName, status: "unavailable" });
      return undefined;
    }
    const rawInput = step.input({
      focus: args.focus,
      results,
      relatedId: args.relatedId,
    });
    if (!rawInput) {
      statuses.push({ toolName: step.toolName, status: "skipped" });
      return undefined;
    }
    const toolCallId = toolCallIdFor(step.toolName);
    const activity = {
      kind: "tool" as const,
      toolCallId,
      toolName: step.toolName,
    };
    const startedAt = dayjs().valueOf();
    let executeMs = 0;
    let status = "failed";
    let succeeded = false;
    try {
      const input = parseOperatorAgentToolInput(step.toolName, rawInput);
      const target = toolActivityTarget(spec.target(input));
      await args.recordActivity({
        ...activity,
        status: "running",
        ...(target ? { target } : {}),
      });
      const inputHash = await actionConfirmationFingerprint({
        toolName: step.toolName,
        toolVersion: spec.version,
        input,
      });
      const executeStarted = dayjs();
      const outcome = await ctx.runMutation(
        internal.operatorAgent.executeToolInternal,
        {
          operatorUserId: args.run.operatorUserId,
          runId: args.run._id,
          threadId: args.run.threadId,
          threadMessageId: args.run.agentMessageId,
          toolName: step.toolName,
          input,
          inputHash,
          idempotencyKey: `${String(args.run._id)}:${step.toolName}:${inputHash}`,
          channel: args.channel,
        },
      );
      executeMs = dayjs().diff(executeStarted);
      status = toolOutcomeStatus(outcome);
      const result = summarizeToolResult(outcome);
      await args.recordActivity({
        ...activity,
        status: toolOutcomeStatus(outcome),
        ...(result ? { result } : {}),
      });
      // A replayed read returns its stored audit output, which some tools
      // truncate to an unparseable string; the model then reads it itself.
      if (outcome.status !== "succeeded" || typeof outcome.result === "string")
        return undefined;
      succeeded = true;
      return { toolCallId, toolName: step.toolName, input, outcome };
    } catch (error) {
      console.warn("Operator prefetch read failed", {
        runId: args.run._id,
        toolName: step.toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      await args.recordActivity({ ...activity, status: "failed" });
      return undefined;
    } finally {
      statuses.push({
        toolName: step.toolName,
        status: succeeded ? "succeeded" : "failed",
      });
      args.onReadTiming?.({
        toolName: step.toolName,
        toolCallId,
        prefetch: true,
        serial: false,
        queuedMs: 0,
        startedAt,
        endedAt: dayjs().valueOf(),
        executeMs,
        status,
      });
    }
  };
  for (const stage of args.stages) {
    const settled = (await Promise.all(stage.map(read))).filter(
      (entry) => entry !== undefined,
    );
    for (const entry of settled) {
      results.set(
        entry.toolName,
        (entry.outcome as { result?: unknown }).result,
      );
      reads.push(entry);
    }
  }
  return { reads, results, statuses };
}

/** A starter intent's declared reads, run before its first model step. */
export async function prefetchOperatorIntentContext(
  ctx: ActionCtx,
  args: PrefetchArgs & { messages: Array<Doc<"operatorAgentMessages">> },
) {
  const intent = args.messages
    .find((message) => message._id === args.run.userMessageId)
    ?.toolArtifacts?.find((artifact) => artifact.type === "operator_intent")
    ?.data as { id?: unknown; focus?: unknown } | undefined;
  const stages =
    typeof intent?.id === "string"
      ? operatorAgentIntentPrefetch(intent.id)
      : undefined;
  if (!stages) return undefined;
  const focus = Object.fromEntries(
    Object.entries(
      intent?.focus && typeof intent.focus === "object" ? intent.focus : {},
    ).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  return await runOperatorPrefetchReads(ctx, { ...args, stages, focus });
}

/**
 * Prefetched reads as one already-answered parallel tool step, with the
 * audit the step's message records.
 */
export function operatorPrefetchedToolStep(
  reads: readonly PrefetchedRead[],
): { messages: ModelMessage[]; audit: AgentToolAudit } | undefined {
  if (reads.length === 0) return undefined;
  return {
    messages: [
      {
        role: "assistant",
        content: reads.map(({ toolCallId, toolName, input }) => ({
          type: "tool-call" as const,
          toolCallId,
          toolName,
          input,
        })),
      },
      {
        role: "tool",
        content: reads.map(({ toolCallId, toolName, outcome }) => ({
          type: "tool-result" as const,
          toolCallId,
          toolName,
          output: {
            type: "json" as const,
            value: boundToolOutput(outcome) as JSONValue,
          },
        })),
      },
    ],
    audit: collectToolAudit({
      toolCalls: reads.map(({ toolCallId, toolName, input }) => ({
        toolCallId,
        toolName,
        input,
      })),
      toolResults: reads.map(({ toolCallId, toolName, outcome }) => ({
        toolCallId,
        toolName,
        output: outcome,
      })),
    }),
  };
}
