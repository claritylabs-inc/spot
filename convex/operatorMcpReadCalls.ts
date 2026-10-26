import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { createOrGetChannelThread } from "./operatorAgent";
import { actionConfirmationFingerprint } from "./lib/actionConfirmationFingerprint";
import { serializeToolActivityInput } from "./lib/agentToolAudit";
import { requireOperatorForUser } from "./lib/operatorIdentity";
import {
  getOperatorAgentToolSpec,
  parseOperatorAgentToolInput,
  type OperatorAgentToolName,
} from "./lib/operatorAgentToolRegistry";
import { executionOperatorToolFailure } from "./lib/operatorAgentToolFailure";
import { sanitizeOperatorReply } from "./lib/operatorToolOutput";

const invocationArgs = {
  operatorUserId: v.id("users"),
  conversationKey: v.string(),
  mcpClientId: v.optional(v.string()),
  toolName: v.string(),
  input: v.any(),
  idempotencyKey: v.string(),
};

type ReadInvocation = {
  threadId: Id<"operatorAgentThreads">;
  runId: Id<"operatorAgentRuns">;
  userMessageId: Id<"operatorAgentMessages">;
  agentMessageId: Id<"operatorAgentMessages">;
  duplicate: boolean;
  summary: string;
  inputHash: string;
};

/** Per-call records on the existing conversation, with no shared thread patch. */
export const prepare = internalMutation({
  args: invocationArgs,
  handler: async (ctx, args): Promise<ReadInvocation> => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    const spec = getOperatorAgentToolSpec(args.toolName);
    if (spec.effect !== "read" || spec.confirmation !== "none")
      throw new Error("MCP read records cannot execute writes");
    if (spec.requiredRole === "owner" && operator.profile.role !== "owner")
      throw new Error("Owner access required");
    const input = parseOperatorAgentToolInput(args.toolName, args.input);
    const inputHash = await actionConfirmationFingerprint({
      toolName: args.toolName,
      toolVersion: spec.version,
      input,
    });
    const key = args.idempotencyKey.trim();
    if (!key || key.length > 500) throw new Error("Invalid idempotency key");
    // Check the global ledger as well as the message reservation so a key
    // cannot move between the existing write path and this read path.
    const ledger = await ctx.db
      .query("agentActionAuditEvents")
      .withIndex("idempotency", (q) =>
        q.eq("operatorUserId", args.operatorUserId).eq("idempotencyKey", key),
      )
      .unique();
    if (
      ledger &&
      (ledger.action !== args.toolName || ledger.inputHash !== inputHash)
    )
      throw new Error("Idempotency key was already used for another action");
    if (ledger?.runId) {
      const run = await ctx.db.get(ledger.runId);
      if (!run || run.operatorUserId !== args.operatorUserId)
        throw new Error("Operator read run not found");
      return {
        threadId: run.threadId,
        runId: run._id,
        userMessageId: run.userMessageId,
        agentMessageId: run.agentMessageId,
        duplicate: true,
        summary: run.objective,
        inputHash,
      };
    }
    const { threadId } = await createOrGetChannelThread(ctx, {
      operatorUserId: args.operatorUserId,
      channel: "mcp",
      conversationKey: args.conversationKey,
    });
    const prior = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread_dedupe", (q) =>
        q.eq("threadId", threadId).eq("dedupeKey", `operator-tool:${key}`),
      )
      .unique();
    if (prior) {
      const reservation = prior.toolArtifacts?.find(
        (artifact) => artifact.type === "mcp_read_invocation",
      )?.data as { inputHash?: string } | undefined;
      const run = ledger?.runId
        ? await ctx.db.get(ledger.runId)
        : await ctx.db
            .query("operatorAgentRuns")
            .withIndex("message", (q) => q.eq("userMessageId", prior._id))
            .unique();
      if (
        !run ||
        run.operatorUserId !== args.operatorUserId ||
        (reservation?.inputHash ?? ledger?.inputHash) !== inputHash
      )
        throw new Error("Idempotency key was already used for another action");
      return {
        threadId: run.threadId,
        runId: run._id,
        userMessageId: run.userMessageId,
        agentMessageId: run.agentMessageId,
        duplicate: true,
        summary: run.objective,
        inputHash,
      };
    }
    const now = dayjs().valueOf();
    const summary = spec.summarize(input).slice(0, 20000);
    const userMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: args.operatorUserId,
      channel: "mcp",
      dedupeKey: `operator-tool:${key}`,
      role: "user",
      userId: args.operatorUserId,
      userName: "MCP",
      content: summary,
      toolArtifacts: [{ type: "mcp_read_invocation", data: { inputHash } }],
      createdAt: now,
      updatedAt: now,
    });
    const agentMessageId = await ctx.db.insert("operatorAgentMessages", {
      threadId,
      ownerUserId: args.operatorUserId,
      channel: "mcp",
      role: "agent",
      replyToMessageId: userMessageId,
      content: "",
      status: "processing",
      agentRunStartedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const runId = await ctx.db.insert("operatorAgentRuns", {
      threadId,
      operatorUserId: args.operatorUserId,
      userMessageId,
      agentMessageId,
      executionKind: "direct_tool",
      objective: summary,
      mcpClientId: args.mcpClientId,
      status: "running",
      checkpoint: { iteration: 0, executionCount: 0 },
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return {
      threadId,
      runId,
      userMessageId,
      agentMessageId,
      duplicate: false,
      summary,
      inputHash,
    };
  },
});

export const finish = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    runId: v.id("operatorAgentRuns"),
    content: v.string(),
    toolName: v.string(),
    input: v.any(),
    outcome: v.any(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.operatorUserId !== args.operatorUserId ||
      run.executionKind !== "direct_tool"
    )
      throw new Error("Operator read run not found");
    if (getOperatorAgentToolSpec(args.toolName).effect !== "read")
      throw new Error("MCP read records cannot complete writes");
    if (run.status !== "running") return;
    const now = dayjs().valueOf();
    const failed = args.outcome?.status === "failed";
    await ctx.db.patch(run.agentMessageId, {
      content: sanitizeOperatorReply(args.content),
      status: failed ? "error" : undefined,
      usedTools: [args.toolName],
      toolCalls: [
        {
          name: args.toolName,
          input: serializeToolActivityInput(args.toolName, args.input),
          output: JSON.stringify(args.outcome).slice(0, 500),
        },
      ],
      updatedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: failed ? "failed" : "completed",
      completedAt: now,
      lastError: failed
        ? String(args.outcome.error ?? "Read failed").slice(0, 1000)
        : undefined,
      updatedAt: now,
    });
  },
});

/** Business execution and audit remain with the existing authorized executors. */
export const invoke = internalAction({
  args: invocationArgs,
  handler: async (
    ctx,
    args,
  ): Promise<ReadInvocation & { outcome: unknown }> => {
    const invocation: ReadInvocation = await ctx.runMutation(
      internal.operatorMcpReadCalls.prepare,
      args,
    );
    const spec = getOperatorAgentToolSpec(args.toolName);
    const executionArgs = {
      operatorUserId: args.operatorUserId,
      runId: invocation.runId,
      threadId: invocation.threadId,
      threadMessageId: invocation.agentMessageId,
      toolName: args.toolName,
      input: args.input,
      inputHash: invocation.inputHash,
      idempotencyKey: args.idempotencyKey.trim(),
      channel: "mcp" as const,
    };
    let outcome;
    try {
      outcome =
        spec.execution === "action"
          ? await ctx.runAction(
              internal.operatorAgent.executeUnconfirmedActionToolInternal,
              executionArgs,
            )
          : await ctx.runMutation(
              internal.operatorAgent.executeToolInternal,
              executionArgs,
            );
    } catch (error) {
      console.error("Operator MCP read failed", {
        runId: invocation.runId,
        toolName: args.toolName,
        error,
      });
      if (invocation.duplicate) throw error;
      outcome = executionOperatorToolFailure(
        args.toolName as OperatorAgentToolName,
        error,
      );
    }
    if (!invocation.duplicate)
      await ctx.runMutation(internal.operatorMcpReadCalls.finish, {
        operatorUserId: args.operatorUserId,
        runId: invocation.runId,
        content:
          outcome.status === "succeeded"
            ? `Completed: ${invocation.summary}.`
            : `Read failed (${outcome.status === "failed" ? outcome.failure.code : "unavailable"}). Check the tool result and narrow or correct the read.`,
        toolName: args.toolName,
        input: args.input,
        outcome,
      });
    return { ...invocation, outcome };
  },
});
