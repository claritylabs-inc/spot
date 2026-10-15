"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { sendOperatorSlackResponse } from "./handleInboundSlack";
export const deliver = internalAction({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(internal.intakeSlack.claim, args);
    if (!claim) return null;
    try {
      const messageTs = await sendOperatorSlackResponse(ctx, {
        delivery: {
          teamId: claim.event.teamId,
          channelId: claim.event.channelId,
          threadTs: claim.threadTs,
        },
        mentionHere: claim.event.eventKey.startsWith("submitted:"),
        clientMessageId: `intake:${claim.event._id}`,
        response: { content: claim.event.content },
      });
      if (!messageTs)
        throw new Error("Slack did not return a message timestamp");
      await ctx.runMutation(internal.intakeSlack.finish, {
        eventId: claim.event._id,
        lease: claim.lease,
        messageTs,
      });
    } catch (error) {
      await ctx.runMutation(internal.intakeSlack.finish, {
        eventId: claim.event._id,
        lease: claim.lease,
        error: error instanceof Error ? error.message : "Slack delivery failed",
      });
    }
    return null;
  },
});
