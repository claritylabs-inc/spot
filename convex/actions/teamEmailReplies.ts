"use node";

import { v } from "convex/values";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction } from "../_generated/server";
import { sendOperatorInboxDraft } from "../lib/operatorInboxSend";
import { getEmailDeliveryMode } from "../lib/resend";

export type TeamReplySendResult = {
  teamEmailThreadId: Id<"teamEmailThreads"> | null;
  recipientEmail: string;
  /** Capture mode: accepted and recorded locally, nothing left Spot. */
  captured: boolean;
};

async function finish(
  ctx: Parameters<typeof sendOperatorInboxDraft>[0],
  pendingEmailId: Id<"pendingEmails">,
  recipientEmail: string,
): Promise<TeamReplySendResult> {
  const sent = await ctx.runQuery(internal.pendingEmails.getInternal, {
    id: pendingEmailId,
  });
  return {
    teamEmailThreadId: sent?.teamEmailThreadId ?? null,
    recipientEmail,
    captured: getEmailDeliveryMode() === "capture",
  };
}

/**
 * Sends the previewed reply as the signed-in operator. The caller's session
 * authenticates `prepareSend`, which stores the approved fingerprint on the
 * draft; the send below reads that approval from the draft and takes no
 * operator id, so no other route can send it. A repeat with the same key
 * resumes the same draft and can never create a second one.
 */
export const send = action({
  args: {
    threadId: v.id("teamEmailThreads"),
    message: v.string(),
    expectedFingerprint: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args): Promise<TeamReplySendResult> => {
    const { pendingEmailId } = await ctx.runMutation(
      api.teamEmailReplies.prepareSend,
      args,
    );
    const { recipientEmail } = await sendOperatorInboxDraft(ctx, { pendingEmailId });
    return await finish(ctx, pendingEmailId, recipientEmail);
  },
});

/** Operator-agent and MCP replies; the completed exact confirmation is the grant. */
export const sendAgentReplyInternal = internalAction({
  args: {
    operatorUserId: v.id("users"),
    confirmationId: v.id("operatorAgentConfirmations"),
    teamEmailThreadId: v.id("teamEmailThreads"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<TeamReplySendResult> => {
    const { pendingEmailId } = await ctx.runMutation(
      internal.teamEmailReplies.prepareAgentReplyInternal,
      args,
    );
    const { recipientEmail } = await sendOperatorInboxDraft(ctx, {
      pendingEmailId,
      confirmationId: args.confirmationId,
    });
    return await finish(ctx, pendingEmailId, recipientEmail);
  },
});
