import dayjs from "dayjs";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { normalizedSearchText } from "./lib/searchTokenizer";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  AGENT_CHANNEL_HISTORY_POLICY,
  THREAD_SUMMARY_VERSION,
  selectBoundedAgentHistory,
} from "./lib/agentMessageHistory";
import { invalidatePendingConfirmations } from "./threadActionConfirmations";

const surfaceValidator = v.union(
  v.literal("web"),
  v.literal("email"),
  v.literal("imessage"),
  v.literal("slack"),
  v.literal("mcp"),
);

const SUMMARY_SOURCE_BATCH_SIZE = 48;

export const prepareForTurn = internalMutation({
  args: {
    threadId: v.id("threads"),
    currentMessageId: v.id("threadMessages"),
    surface: surfaceValidator,
  },
  handler: async (ctx, args) => {
    const [thread, currentMessage, existing] = await Promise.all([
      ctx.db.get(args.threadId),
      ctx.db.get(args.currentMessageId),
      ctx.db
        .query("threadContextStates")
        .withIndex("thread", (q) => q.eq("threadId", args.threadId))
        .unique(),
    ]);
    if (!thread || !currentMessage || currentMessage.threadId !== thread._id) {
      throw new Error("Thread history turn not found");
    }

    const policy = AGENT_CHANNEL_HISTORY_POLICY[args.surface];
    const continuityMode = policy.continuityMode;
    const now = dayjs().valueOf();
    if (!existing) {
      const stateId = await ctx.db.insert("threadContextStates", {
        threadId: thread._id,
        orgId: thread.orgId,
        continuityMode,
        taskEpoch: 0,
        taskStartedAt: thread._creationTime,
        lastUserMessageAt: currentMessage._creationTime,
        summaryVersion: THREAD_SUMMARY_VERSION,
        status: "idle",
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.get(stateId);
    }

    const modeChanged = existing.continuityMode !== continuityMode;
    if (modeChanged) {
      await invalidatePendingConfirmations(
        ctx,
        args.threadId,
        "task_epoch_changed",
      );
    }
    await ctx.db.patch(existing._id, {
      continuityMode,
      lastUserMessageAt: currentMessage._creationTime,
      ...(modeChanged
        ? {
            taskEpoch: existing.taskEpoch + 1,
            taskStartedAt:
              continuityMode === "task_scoped"
                ? currentMessage._creationTime
                : thread._creationTime,
            summary: undefined,
            summarizedThroughMessageId: undefined,
            summarizedThroughCreatedAt: undefined,
            summaryVersion: THREAD_SUMMARY_VERSION,
            status: "idle" as const,
            attemptCount: 0,
            lastError: undefined,
          }
        : {}),
      updatedAt: now,
    });
    return ctx.db.get(existing._id);
  },
});

export const resetTask = internalMutation({
  args: {
    threadId: v.id("threads"),
    currentMessageId: v.id("threadMessages"),
  },
  handler: async (ctx, args) => {
    const [thread, currentMessage, existing] = await Promise.all([
      ctx.db.get(args.threadId),
      ctx.db.get(args.currentMessageId),
      ctx.db
        .query("threadContextStates")
        .withIndex("thread", (q) => q.eq("threadId", args.threadId))
        .unique(),
    ]);
    if (!thread || !currentMessage || currentMessage.threadId !== thread._id) {
      throw new Error("Thread history turn not found");
    }
    const now = dayjs().valueOf();
    await invalidatePendingConfirmations(ctx, args.threadId, "task_reset");
    if (!existing) {
      await ctx.db.insert("threadContextStates", {
        threadId: thread._id,
        orgId: thread.orgId,
        continuityMode: "task_scoped",
        taskEpoch: 1,
        taskStartedAt: currentMessage._creationTime,
        lastUserMessageAt: currentMessage._creationTime,
        summaryVersion: THREAD_SUMMARY_VERSION,
        status: "idle",
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(existing._id, {
      continuityMode: "task_scoped",
      taskEpoch: existing.taskEpoch + 1,
      taskStartedAt: currentMessage._creationTime,
      lastUserMessageAt: currentMessage._creationTime,
      summary: undefined,
      summarizedThroughMessageId: undefined,
      summarizedThroughCreatedAt: undefined,
      summaryVersion: THREAD_SUMMARY_VERSION,
      status: "idle",
      attemptCount: 0,
      lastError: undefined,
      updatedAt: now,
    });
  },
});

export const getContextState = internalQuery({
  args: { threadId: v.id("threads") },
  handler: (ctx, args) =>
    ctx.db
      .query("threadContextStates")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .unique(),
});

export const getMessagePage = internalQuery({
  args: {
    threadId: v.id("threads"),
    taskStartedAt: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => {
        const threadQuery = q.eq("threadId", args.threadId);
        return args.taskStartedAt === undefined
          ? threadQuery
          : threadQuery.gte("_creationTime", args.taskStartedAt);
      })
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getLatestUserMessage = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(16);
    return messages.find((message) => message.role === "user") ?? null;
  },
});

export const getRecentControlMessages = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query("threadMessages")
        .withIndex("thread", (q) => q.eq("threadId", args.threadId))
        .order("desc")
        .take(32)
    ).reverse(),
});

export const scheduleCompaction = internalMutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("threadContextStates")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!state || state.status === "scheduled") return;
    await ctx.db.patch(state._id, {
      status: "scheduled",
      lastError: undefined,
      updatedAt: dayjs().valueOf(),
    });
    await ctx.scheduler.runAfter(0, internal.actions.compactThreadHistory.run, {
      threadId: args.threadId,
    });
  },
});

export const getSummaryCutoff = internalQuery({
  args: {
    threadId: v.id("threads"),
    taskStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) =>
        q
          .eq("threadId", args.threadId)
          .gte("_creationTime", args.taskStartedAt),
      )
      .order("desc")
      .take(256);
    const selected = selectBoundedAgentHistory([...recent].reverse(), {
      taskStartedAt: args.taskStartedAt,
    });
    if (selected.omittedMessageCount === 0 || selected.messages.length === 0) {
      return null;
    }
    const earliestSelectedAt = selected.messages[0]._creationTime;
    return ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) =>
        q
          .eq("threadId", args.threadId)
          .gte("_creationTime", args.taskStartedAt)
          .lt("_creationTime", earliestSelectedAt),
      )
      .order("desc")
      .first();
  },
});

export const getSummarySourceBatch = internalQuery({
  args: {
    threadId: v.id("threads"),
    taskStartedAt: v.number(),
    afterCreatedAt: v.optional(v.number()),
    throughCreatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("threadMessages")
      .withIndex("thread", (q) => {
        const threadQuery = q.eq("threadId", args.threadId);
        return args.afterCreatedAt === undefined
          ? threadQuery
              .gte("_creationTime", args.taskStartedAt)
              .lte("_creationTime", args.throughCreatedAt)
          : threadQuery
              .gt("_creationTime", args.afterCreatedAt)
              .lte("_creationTime", args.throughCreatedAt);
      })
      .order("asc")
      .take(SUMMARY_SOURCE_BATCH_SIZE + 1);
    return {
      messages: rows.slice(0, SUMMARY_SOURCE_BATCH_SIZE),
      hasMore: rows.length > SUMMARY_SOURCE_BATCH_SIZE,
    };
  },
});

export const commitSummary = internalMutation({
  args: {
    threadId: v.id("threads"),
    expectedTaskEpoch: v.number(),
    expectedSummarizedThroughMessageId: v.optional(v.id("threadMessages")),
    expectedSummarizedThroughCreatedAt: v.optional(v.number()),
    summary: v.string(),
    lastMessageId: v.id("threadMessages"),
    lastMessageCreatedAt: v.number(),
    hasMore: v.boolean(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("threadContextStates")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      !state ||
      state.taskEpoch !== args.expectedTaskEpoch ||
      state.summarizedThroughMessageId !==
        args.expectedSummarizedThroughMessageId ||
      state.summarizedThroughCreatedAt !==
        args.expectedSummarizedThroughCreatedAt
    ) {
      return { committed: false };
    }
    await ctx.db.patch(state._id, {
      summary: args.summary,
      summarizedThroughMessageId: args.lastMessageId,
      summarizedThroughCreatedAt: args.lastMessageCreatedAt,
      status: args.hasMore ? "scheduled" : "ready",
      attemptCount: 0,
      lastError: undefined,
      updatedAt: dayjs().valueOf(),
    });
    if (args.hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.compactThreadHistory.run,
        { threadId: args.threadId },
      );
    }
    return { committed: true };
  },
});

export const finishCompactionWithoutChanges = internalMutation({
  args: {
    threadId: v.id("threads"),
    taskEpoch: v.number(),
    expectedSummarizedThroughMessageId: v.optional(v.id("threadMessages")),
    expectedSummarizedThroughCreatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("threadContextStates")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      !state ||
      state.taskEpoch !== args.taskEpoch ||
      state.summarizedThroughMessageId !==
        args.expectedSummarizedThroughMessageId ||
      state.summarizedThroughCreatedAt !==
        args.expectedSummarizedThroughCreatedAt
    ) {
      return;
    }
    await ctx.db.patch(state._id, {
      status: state.summary ? "ready" : "idle",
      attemptCount: 0,
      lastError: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const recordCompactionFailure = internalMutation({
  args: {
    threadId: v.id("threads"),
    taskEpoch: v.number(),
    expectedSummarizedThroughMessageId: v.optional(v.id("threadMessages")),
    expectedSummarizedThroughCreatedAt: v.optional(v.number()),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("threadContextStates")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      !state ||
      state.taskEpoch !== args.taskEpoch ||
      state.summarizedThroughMessageId !==
        args.expectedSummarizedThroughMessageId ||
      state.summarizedThroughCreatedAt !==
        args.expectedSummarizedThroughCreatedAt
    ) {
      return;
    }
    const attempts = state.attemptCount + 1;
    const delays = [60_000, 300_000, 1_800_000] as const;
    await ctx.db.patch(state._id, {
      status: attempts >= delays.length ? "error" : "scheduled",
      attemptCount: attempts,
      lastError: args.error.slice(0, 500),
      updatedAt: dayjs().valueOf(),
    });
    if (attempts < delays.length) {
      await ctx.scheduler.runAfter(
        delays[attempts - 1],
        internal.actions.compactThreadHistory.run,
        { threadId: args.threadId },
      );
    }
  },
});

function canReadThread(args: {
  thread: Doc<"threads">;
  userId: Id<"users">;
  readOrgIds: Id<"organizations">[];
}) {
  if (args.thread.visibility === "user_private") {
    return args.thread.createdBy === args.userId;
  }
  return args.readOrgIds.some((orgId) => orgId === args.thread.orgId);
}

export const searchThreadHistory = internalQuery({
  args: {
    threadId: v.id("threads"),
    userId: v.id("users"),
    readOrgIds: v.array(v.id("organizations")),
    query: v.string(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (
      !thread ||
      !canReadThread({
        thread,
        userId: args.userId,
        readOrgIds: args.readOrgIds,
      })
    ) {
      return [];
    }
    const limit = Math.max(1, Math.min(8, Math.floor(args.limit)));
    const normalizedQuery =
      normalizedSearchText(args.query) || args.query.trim();
    if (!normalizedQuery) return [];
    const rows = await ctx.db
      .query("threadMessages")
      .withSearchIndex("content", (q) =>
        q.search("content", normalizedQuery).eq("threadId", args.threadId),
      )
      .take(limit * 2);
    return rows
      .filter(
        (message) =>
          message.status !== "processing" &&
          message.status !== "cancelled" &&
          message.role !== "system",
      )
      .slice(0, limit)
      .map((message) => ({
        messageId: message._id,
        role: message.role,
        speaker:
          message.role === "user" ? (message.userName ?? "User") : "Spot",
        createdAt: message._creationTime,
        excerpt: message.content.slice(0, 1_200),
        attachments: (message.attachments ?? []).map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
        })),
      }));
  },
});

export const getThreadAttachment = internalQuery({
  args: {
    threadId: v.id("threads"),
    messageId: v.string(),
    filename: v.string(),
    userId: v.id("users"),
    readOrgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const normalizedMessageId = ctx.db.normalizeId(
      "threadMessages",
      args.messageId,
    );
    if (!normalizedMessageId) return null;
    const [thread, message] = await Promise.all([
      ctx.db.get(args.threadId),
      ctx.db.get(normalizedMessageId),
    ]);
    if (
      !thread ||
      !message ||
      message.threadId !== thread._id ||
      !canReadThread({
        thread,
        userId: args.userId,
        readOrgIds: args.readOrgIds,
      })
    ) {
      return null;
    }
    const normalizedFilename = args.filename.trim().toLowerCase();
    const attachment = (message.attachments ?? []).find(
      (candidate) =>
        candidate.filename.trim().toLowerCase() === normalizedFilename,
    );
    if (!attachment?.fileId) return null;
    const [url, metadata] = await Promise.all([
      ctx.storage.getUrl(attachment.fileId),
      ctx.db.system.get("_storage", attachment.fileId),
    ]);
    if (!url || !metadata) return null;
    return {
      messageId: message._id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      fileId: attachment.fileId,
      url,
    };
  },
});
