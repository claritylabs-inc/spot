import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const emailSendAuthorizationDecisionValidator = v.object({
  sendProbability: v.number(),
  negatedProbability: v.number(),
  model: v.string(),
  decidedAt: v.number(),
});

export const recordDecision = internalMutation({
  args: {
    messageId: v.id("threadMessages"),
    decision: emailSendAuthorizationDecisionValidator,
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.role !== "user") return null;
    await ctx.db.patch(args.messageId, {
      emailSendAuthorization: args.decision,
    });
    return null;
  },
});
