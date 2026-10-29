import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** What quoted-history detection reads for one stored message. */
export const messageInternal = internalQuery({
  args: { messageId: v.id("teamEmailMessages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.quotedHistoryStart !== undefined) return null;
    return {
      clientOrgId: message.clientOrgId,
      subject: message.subject,
      fromEmail: message.fromEmail,
      text: message.currentText,
    };
  },
});

/** Records the line where the message's quoted history starts, or null when it has none. */
export const saveInternal = internalMutation({
  args: {
    messageId: v.id("teamEmailMessages"),
    line: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.quotedHistoryStart !== undefined) return;
    await ctx.db.patch(args.messageId, { quotedHistoryStart: args.line });
  },
});
