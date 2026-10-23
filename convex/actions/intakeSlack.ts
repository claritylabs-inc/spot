"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { slackWebApi } from "../lib/slackWebApi";
import { requireSlackMessageId } from "../lib/slackDelivery";
import { formatSlackAnswerText } from "../lib/slackBlocks";
import { splitIntakeSlackMessage } from "../lib/intakeSlackContext";
export const deliver = internalAction({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(internal.intakeSlack.claim, args);
    if (!claim) return null;
    try {
      const slack = slackWebApi(ctx);
      const summary = claim.event.eventKey.startsWith("summary:");
      const chunks = splitIntakeSlackMessage(formatSlackAnswerText(claim.event.content));
      const destination = { teamId: claim.event.teamId, channelId: claim.event.channelId };
      let messageTs: string | undefined;
      for (const [index, chunk] of chunks.entries()) {
        const text = chunks.length > 1 ? `(Application details ${index + 1}/${chunks.length})\n${chunk}` : chunk;
        if (summary && index === 0) {
          if (!claim.threadTs) throw new Error("Intake thread is missing");
          const result = await slack.updateMessage({ ...destination, messageTs: claim.threadTs, mrkdwnText: text });
          messageTs = requireSlackMessageId(result);
        } else {
          const result = await slack.sendMessage({
            ...destination,
            threadTs: claim.threadTs ?? messageTs,
            clientMessageId: `intake:${claim.event._id}${index ? `:${index}` : ""}`,
            mrkdwnText: `${index === 0 && claim.event.eventKey.startsWith("submitted:") ? "<!here> " : ""}${text}`,
          });
          const sentMessageTs = requireSlackMessageId(result);
          messageTs ??= sentMessageTs;
        }
      }
      if (!messageTs) throw new Error("Slack did not return a message timestamp");
      await ctx.runMutation(internal.intakeSlack.finish, {
        eventId: claim.event._id, lease: claim.lease, messageTs,
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
