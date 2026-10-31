import dayjs from "dayjs";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import {
  drainOperatorInputs,
  insertOperatorThread,
  operatorInputStartProblem,
  startOperatorInput,
} from "./operatorAgent";
import {
  MAX_PENDING_INPUTS_PER_THREAD,
  OPERATOR_STEER_ARTIFACT,
  resolveOperatorInput,
} from "./lib/operatorAgentInputs";
import { requireOperator } from "./lib/operatorIdentity";
import { activeOperatorRuns } from "./lib/operatorTasks";

/** Starts the conversation's next waiting message if no run holds it. */
export const drainInternal = internalMutation({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const started = await drainOperatorInputs(ctx, args.threadId);
    return started ? { inputId: started.inputId, runId: started.runId } : null;
  },
});

/**
 * The runner takes its operator's guidance at a step boundary. With
 * `claimNew` (no model call submitted yet for this iteration), pending steers
 * are applied at `iteration` and written to the transcript. Either way it
 * returns exactly the steers applied at `iteration`, so a resumed step
 * rebuilds the request it submitted and a router retry gets old and new ones.
 */
export const claimRunSteersInternal = internalMutation({
  args: {
    runId: v.id("operatorAgentRuns"),
    expectedRunnerAttempt: v.number(),
    iteration: v.number(),
    claimNew: v.boolean(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (
      !run ||
      run.status !== "running" ||
      run.cancellationRequestedAt ||
      run.runnerAttempt !== args.expectedRunnerAttempt ||
      (run.checkpoint?.iteration ?? 0) !== args.iteration
    )
      return [];
    if (args.claimNew) {
      const now = dayjs().valueOf();
      const pending = await ctx.db
        .query("operatorAgentInputs")
        .withIndex("by_targetRunId_and_status", (q) =>
          q.eq("targetRunId", run._id).eq("status", "pending"),
        )
        .take(MAX_PENDING_INPUTS_PER_THREAD);
      for (const input of pending) {
        if (input.mode !== "steer" || input.operatorUserId !== run.operatorUserId)
          continue;
        const author = await ctx.db.get(input.operatorUserId);
        const messageId = await ctx.db.insert("operatorAgentMessages", {
          threadId: run.threadId,
          ownerUserId: input.operatorUserId,
          channel: input.channel,
          role: "user",
          userId: input.operatorUserId,
          userName: author?.name ?? author?.email ?? "Operator",
          replyToMessageId: run.userMessageId,
          content: input.content,
          toolArtifacts: [
            ...(input.toolArtifacts ?? []),
            {
              type: OPERATOR_STEER_ARTIFACT,
              data: {
                runId: run._id,
                inputId: input._id,
                userMessageId: run.userMessageId,
                iteration: args.iteration,
              },
            },
          ],
          createdAt: now,
          updatedAt: now,
        });
        await resolveOperatorInput(
          ctx,
          input,
          { status: "applied", appliedIteration: args.iteration, messageId },
          now,
        );
      }
    }
    const applied = await ctx.db
      .query("operatorAgentInputs")
      .withIndex("by_targetRunId_and_status", (q) =>
        q.eq("targetRunId", run._id).eq("status", "applied"),
      )
      .take(100);
    return Promise.all(
      applied
        .filter((input) => input.appliedIteration === args.iteration)
        .map(async (input) => {
          const author = await ctx.db.get(input.operatorUserId);
          return {
            inputId: input._id,
            content: input.content,
            authorName: input.parentThreadId
              ? "the task that started this subtask"
              : (author?.name ?? author?.email ?? "the operator"),
          };
        }),
    );
  },
});

async function requireOwnInput(
  ctx: MutationCtx,
  inputId: Id<"operatorAgentInputs">,
  statuses: ReadonlyArray<Doc<"operatorAgentInputs">["status"]>,
) {
  const operator = await requireOperator(ctx);
  const input = await ctx.db.get(inputId);
  if (!input || input.operatorUserId !== operator.userId)
    throw new ConvexError("Only its sender can change a waiting message.");
  if (!statuses.includes(input.status))
    throw new ConvexError("That message is no longer waiting.");
  return input;
}

/** The sender withdraws a waiting message, or dismisses one that failed to start. */
export const cancelInput = mutation({
  args: { inputId: v.id("operatorAgentInputs") },
  handler: async (ctx, args) => {
    const input = await requireOwnInput(ctx, args.inputId, ["pending", "failed"]);
    await resolveOperatorInput(
      ctx,
      input,
      { status: "cancelled", error: input.error },
      dayjs().valueOf(),
    );
    return { cancelled: true as const, content: input.content };
  },
});

/**
 * Starts the sender's queued message now, ahead of the queue. It replaces the
 * sender's own running request; another operator's request rejects it.
 */
export const sendInputNow = mutation({
  args: { inputId: v.id("operatorAgentInputs") },
  handler: async (ctx, args) => {
    const input = await requireOwnInput(ctx, args.inputId, ["pending"]);
    const active = await activeOperatorRuns(ctx, input.threadId);
    if (input.mode === "steer" && active.some((run) => run._id === input.targetRunId))
      throw new ConvexError(
        "This guidance is waiting for the request's next step. Stop the request to send it as a new message.",
      );
    const started = await startOperatorInput(ctx, input);
    if (!started) {
      const failed = await ctx.db.get(input._id);
      throw new ConvexError(failed?.error ?? "The message could not start.");
    }
    return { threadId: input.threadId, runId: started.runId };
  },
});

/** Moves a waiting message to a new chat of its own, for example out of a long approval wait. */
export const sendInputInNewChat = mutation({
  args: { inputId: v.id("operatorAgentInputs") },
  handler: async (ctx, args) => {
    const input = await requireOwnInput(ctx, args.inputId, ["pending", "failed"]);
    const problem = await operatorInputStartProblem(ctx, input);
    if (problem) throw new ConvexError(problem);
    const threadId = await insertOperatorThread(ctx, {
      operatorUserId: input.operatorUserId,
      channel: "chat",
      initialContext: input.pageContext,
    });
    const started = await startOperatorInput(ctx, input, { threadId });
    if (!started) throw new ConvexError("The message could not start.");
    return { threadId, runId: started.runId };
  },
});
