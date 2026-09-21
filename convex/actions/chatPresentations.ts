"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { composeChatPresentation } from "../lib/chatPresentationComposer";

export const compose = internalAction({
  args: {
    messageId: v.union(v.id("operatorAgentMessages"), v.id("threadMessages")),
    sourceRevision: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const input = await ctx.runQuery(internal.chatPresentations.load, args);
      if (!input) return;
      const presentation = await composeChatPresentation(ctx, {
        ...input,
        sourceRevision: args.sourceRevision,
      });
      if (presentation)
        await ctx.runMutation(internal.chatPresentations.save, {
          ...args,
          presentation,
        });
    } catch {
      console.warn("Chat presentation unavailable", {
        messageId: args.messageId,
      });
    }
  },
});
