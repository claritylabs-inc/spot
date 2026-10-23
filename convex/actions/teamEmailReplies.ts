"use node";

import { v } from "convex/values";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import { sendOperatorInboxDraft } from "../lib/operatorInboxSend";
import { getEmailDeliveryMode } from "../lib/resend";

export type TeamReplySent = {
  status: "sent";
  teamEmailThreadId: Id<"teamEmailThreads"> | null;
  recipientEmail: string;
  /** Capture mode: accepted and recorded locally, nothing left Spot. */
  captured: boolean;
};

/**
 * What a send ended as. `pending`: the email is locked (delivery unknown or
 * its record still being finished); the UI must not edit, re-send or use a new
 * key. `not_sent`: nothing left; preview again and use a new key. The status
 * comes from the draft's stored state, never from error text.
 */
export type TeamReplySendResult =
  | TeamReplySent
  | { status: "pending"; pendingEmailId: Id<"pendingEmails">; message: string }
  | { status: "not_sent"; pendingEmailId?: Id<"pendingEmails">; message: string };

async function finish(
  ctx: ActionCtx,
  pendingEmailId: Id<"pendingEmails">,
  recipientEmail: string,
): Promise<TeamReplySent> {
  const sent = await ctx.runQuery(internal.pendingEmails.getInternal, {
    id: pendingEmailId,
  });
  return {
    status: "sent",
    teamEmailThreadId: sent?.teamEmailThreadId ?? null,
    recipientEmail,
    captured: getEmailDeliveryMode() === "capture",
  };
}

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "The reply was not sent.";

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
    let pendingEmailId: Id<"pendingEmails">;
    try {
      ({ pendingEmailId } = await ctx.runMutation(
        api.teamEmailReplies.prepareSend,
        args,
      ));
    } catch (error) {
      return { status: "not_sent", message: errorText(error) };
    }
    try {
      const { recipientEmail } = await sendOperatorInboxDraft(ctx, { pendingEmailId });
      return await finish(ctx, pendingEmailId, recipientEmail);
    } catch (error) {
      const draft = await ctx.runQuery(internal.pendingEmails.getInternal, {
        id: pendingEmailId,
      });
      if (draft?.status === "sent") {
        return await finish(ctx, pendingEmailId, draft.recipientEmail);
      }
      if (draft?.status === "pending") {
        return {
          status: "pending",
          pendingEmailId,
          message:
            "Delivery is being confirmed. This reply is locked and will not be sent again.",
        };
      }
      return { status: "not_sent", pendingEmailId, message: errorText(error) };
    }
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
  handler: async (ctx, args): Promise<TeamReplySent> => {
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
