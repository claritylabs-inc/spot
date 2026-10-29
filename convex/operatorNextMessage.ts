import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const CONTEXT_MESSAGES = 6;
const CONTEXT_MESSAGE_CHARS = 1_500;

type Message = Doc<"operatorAgentMessages">;

/** The reply still ends its thread and has not been rewritten since scheduling. */
async function currentReply(
  ctx: QueryCtx | MutationCtx,
  messageId: Message["_id"],
  revision: number,
) {
  const message = await ctx.db.get(messageId);
  if (
    !message ||
    message.channel !== "chat" ||
    message.role !== "agent" ||
    message.status ||
    (message.presentationRevision ?? 0) !== revision
  )
    return null;
  const latest = await ctx.db
    .query("operatorAgentMessages")
    .withIndex("thread", (index) => index.eq("threadId", message.threadId))
    .order("desc")
    .first();
  return latest?._id === message._id ? message : null;
}

/** Suggests the operator's next message after a finished web chat reply. */
export async function scheduleNextMessageSuggestion(
  ctx: MutationCtx,
  message: Message,
) {
  if (
    message.channel !== "chat" ||
    message.role !== "agent" ||
    message.status ||
    !message.content.trim()
  )
    return;
  await ctx.scheduler.runAfter(0, internal.actions.operatorNextMessage.suggest, {
    messageId: message._id,
    revision: message.presentationRevision ?? 0,
  });
}

export const contextInternal = internalQuery({
  args: { messageId: v.id("operatorAgentMessages"), revision: v.number() },
  handler: async (ctx, args) => {
    const message = await currentReply(ctx, args.messageId, args.revision);
    if (!message) return null;
    const recent = await ctx.db
      .query("operatorAgentMessages")
      .withIndex("thread", (index) => index.eq("threadId", message.threadId))
      .order("desc")
      .take(CONTEXT_MESSAGES);
    return recent
      .reverse()
      .filter((item) => item.role !== "system" && item.content.trim())
      .map((item) => ({
        role: item.role === "user" ? ("operator" as const) : ("agent" as const),
        content: item.content.trim().slice(-CONTEXT_MESSAGE_CHARS),
      }));
  },
});

export const saveInternal = internalMutation({
  args: {
    messageId: v.id("operatorAgentMessages"),
    revision: v.number(),
    suggestion: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await currentReply(ctx, args.messageId, args.revision);
    if (message)
      await ctx.db.patch(message._id, {
        nextMessageSuggestion: args.suggestion,
      });
    return null;
  },
});
