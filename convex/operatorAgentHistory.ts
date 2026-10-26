import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  selectBoundedAgentHistory,
  THREAD_SUMMARY_VERSION,
  estimateAgentHistoryTokens,
  formatMessagesForThreadSummary,
} from "./lib/agentMessageHistory";

export async function scheduleOperatorHistoryCompaction(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
) {
  const state = await ctx.db
    .query("operatorThreadContextStates")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
  if (state?.status === "scheduled") return;
  const recent = await ctx.db
    .query("operatorAgentMessages")
    .withIndex("thread", (q) => q.eq("threadId", threadId))
    .order("desc")
    .take(96);
  const current = recent.find((message) => message.role === "user");
  const selected = selectBoundedAgentHistory(recent, {
    currentMessageId: current?._id,
  });
  const cutoffCreatedAt = selected.messages[0]?._creationTime;

  if (state)
    await ctx.db.patch(state._id, {
      status: "scheduled",
      generation: state.generation + 1,
      cutoffCreatedAt,
      lastError: undefined,
    });
  else
    await ctx.db.insert("operatorThreadContextStates", {
      threadId,
      cutoffCreatedAt,
      summaryVersion: THREAD_SUMMARY_VERSION,
      generation: 0,
      status: "scheduled",
      updatedAt: dayjs().valueOf(),
    });
  await ctx.scheduler.runAfter(
    0,
    internal.actions.compactOperatorThreadHistory.run,
    { threadId },
  );
}

export const getState = internalQuery({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: (ctx, args) =>
    ctx.db
      .query("operatorThreadContextStates")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique(),
});

export const getSource = internalQuery({
  args: { threadId: v.id("operatorAgentThreads") },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("operatorThreadContextStates")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!state || state.status !== "scheduled") return null;
    const earliest = state.cutoffCreatedAt;
    if (earliest === undefined) return { state, messages: [], hasMore: false };
    const rows = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread", (q) => {
        const query = q.eq("threadId", args.threadId);
        return state.summarizedThroughCreatedAt === undefined
          ? query.lt("_creationTime", earliest)
          : query
              .gt("_creationTime", state.summarizedThroughCreatedAt)
              .lt("_creationTime", earliest);
      })
      .order("asc")
      .take(49);
    const messages = [];
    let tokens = 0;
    for (const row of rows.slice(0, 48)) {
      const cost = estimateAgentHistoryTokens(
        formatMessagesForThreadSummary([row]),
      );
      if (tokens + cost > 16_000 && messages.length) break;
      messages.push(row);
      tokens += cost;
    }
    return { state, messages, hasMore: rows.length > messages.length };
  },
});

export const finish = internalMutation({
  args: {
    threadId: v.id("operatorAgentThreads"),
    generation: v.number(),
    expectedThrough: v.optional(v.id("operatorAgentMessages")),
    summary: v.optional(v.string()),
    lastMessageId: v.optional(v.id("operatorAgentMessages")),
    hasMore: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("operatorThreadContextStates")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      !state ||
      state.generation !== args.generation ||
      state.status !== "scheduled" ||
      state.summarizedThroughMessageId !== args.expectedThrough
    )
      return;
    const last = args.lastMessageId
      ? await ctx.db.get(args.lastMessageId)
      : null;
    if (last && last.threadId !== args.threadId)
      throw new Error("Summary source belongs to another thread");
    await ctx.db.patch(state._id, {
      ...(args.summary && last
        ? {
            summary: args.summary,
            summarizedThroughMessageId: last._id,
            summarizedThroughCreatedAt: last._creationTime,
          }
        : {}),
      status: args.error ? "error" : args.hasMore ? "scheduled" : "ready",
      generation: state.generation + 1,
      lastError: args.error?.slice(0, 500),
      updatedAt: dayjs().valueOf(),
    });
    if (args.hasMore && !args.error)
      await ctx.scheduler.runAfter(
        0,
        internal.actions.compactOperatorThreadHistory.run,
        { threadId: args.threadId },
      );
  },
});
