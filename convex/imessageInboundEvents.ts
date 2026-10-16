import { v } from "convex/values";
import dayjs from "dayjs";
import { internalMutation } from "./_generated/server";

export const claim = internalMutation({
  args: {
    eventKey: v.string(),
    fromPhone: v.string(),
    chatGuid: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
    messageText: v.string(),
    sourceMessageId: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    recoveryFailure: v.optional(
      v.object({
        stage: v.union(
          v.literal("raw_message"),
          v.literal("attachment_download"),
        ),
        error: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageInboundEvents")
      .withIndex("event", (q) => q.eq("eventKey", args.eventKey))
      .first();

    if (existing?.status === "error" &&
        existing.error === "security_screening_unavailable") {
      await ctx.db.patch(existing._id, {
        status: "processing",
        error: undefined,
        privacyContextPending: args.isGroup === true ? undefined : true,
        updatedAt: dayjs().valueOf(),
      });
      return { duplicate: false, status: "processing" as const };
    }
    if (existing) {
      return {
        duplicate: true,
        status: existing.status,
        response: existing.response,
      };
    }

    const now = dayjs().valueOf();
    await ctx.db.insert("imessageInboundEvents", {
      eventKey: args.eventKey,
      fromPhone: args.fromPhone,
      chatGuid: args.chatGuid,
      isGroup: args.isGroup,
      messageText: args.messageText,
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
      recoveryFailure: args.recoveryFailure,
      privacyContextPending: args.isGroup === true ? undefined : true,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    });

    return { duplicate: false, status: "processing" as const };
  },
});

export const attachPrivacyContext = internalMutation({
  args: {
    eventKey: v.string(),
    threadId: v.id("threads"),
    historyGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageInboundEvents")
      .withIndex("event", (q) => q.eq("eventKey", args.eventKey))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      threadId: args.threadId,
      historyGeneration: args.historyGeneration,
      privacyContextPending: false,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const complete = internalMutation({
  args: {
    eventKey: v.string(),
    response: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageInboundEvents")
      .withIndex("event", (q) => q.eq("eventKey", args.eventKey))
      .first();
    if (!existing) return;

    await ctx.db.patch(existing._id, {
      status: "completed",
      response: args.response,
      error: undefined,
      privacyContextPending: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});

export const fail = internalMutation({
  args: {
    eventKey: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("imessageInboundEvents")
      .withIndex("event", (q) => q.eq("eventKey", args.eventKey))
      .first();
    if (!existing) return;

    await ctx.db.patch(existing._id, {
      status: "error",
      error: args.error,
      privacyContextPending: undefined,
      updatedAt: dayjs().valueOf(),
    });
  },
});
