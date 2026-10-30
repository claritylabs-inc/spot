"use node";

import { v } from "convex/values";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { sendOperatorInboxDraft } from "../lib/operatorInboxSend";
import { getEmailDeliveryMode } from "../lib/resend";
import { isReplyKeyMismatch, teamReplyErrorMessage } from "../lib/teamEmailReply";
import { threadFollowUpRequestValidator } from "../lib/threadFollowUps";

export type TeamComposeSendResult =
  | {
      status: "sent";
      /** The new conversation in the team inbox. */
      teamEmailThreadId: Id<"teamEmailThreads"> | null;
      captured: boolean;
    }
  | { status: "pending"; message: string }
  | { status: "not_sent"; message: string };

const SAFE_FALLBACK = "The email was not sent. Review it and try again.";
const userText = (error: unknown) => teamReplyErrorMessage(error) ?? SAFE_FALLBACK;

/** The outcome as the draft's stored state says it is. */
async function settled(
  ctx: ActionCtx,
  pendingEmailId: Id<"pendingEmails">,
): Promise<TeamComposeSendResult> {
  const draft = await ctx.runQuery(internal.pendingEmails.getInternal, { id: pendingEmailId });
  if (draft?.status === "sent") {
    return {
      status: "sent",
      teamEmailThreadId: draft.teamEmailThreadId ?? null,
      captured: getEmailDeliveryMode() === "capture",
    };
  }
  if (draft?.status === "pending") {
    return {
      status: "pending",
      message: "Delivery is being confirmed. This email is locked and will not be sent again.",
    };
  }
  return { status: "not_sent", message: SAFE_FALLBACK };
}

/**
 * Sends the previewed new email as the signed-in operator, with the same
 * guarantees as a reply (`teamEmailReplies.send`): the session-authenticated
 * `prepareSend` stores the approval on the draft, a repeat with the same key
 * resumes that draft and never sends twice, and `not_sent` is returned only
 * when it is certain nothing left.
 */
export const send = action({
  args: {
    to: v.string(),
    cc: v.array(v.string()),
    bcc: v.array(v.string()),
    subject: v.string(),
    message: v.string(),
    clientOrgId: v.optional(v.id("organizations")),
    requestId: v.optional(v.id("procurementRequests")),
    fromUserId: v.optional(v.id("users")),
    expectedFingerprint: v.string(),
    idempotencyKey: v.string(),
    /** Nudge the recipient automatically until someone replies. */
    followUps: v.optional(threadFollowUpRequestValidator),
  },
  handler: async (ctx, args): Promise<TeamComposeSendResult> => {
    let pendingEmailId: Id<"pendingEmails">;
    try {
      ({ pendingEmailId } = await ctx.runMutation(api.teamEmailCompose.prepareSend, args));
    } catch (error) {
      if (isReplyKeyMismatch(error)) return { status: "not_sent", message: userText(error) };
      const known = await ctx
        .runQuery(api.teamEmailCompose.status, {
          idempotencyKey: args.idempotencyKey,
          fromUserId: args.fromUserId,
        })
        .catch(() => null);
      if (known?.state === "sent" || known?.state === "pending") {
        return await settled(ctx, known.pendingEmailId);
      }
      const message = teamReplyErrorMessage(error);
      if (known !== null && message !== null) return { status: "not_sent", message };
      throw error;
    }
    try {
      await sendOperatorInboxDraft(ctx, { pendingEmailId });
      return await settled(ctx, pendingEmailId);
    } catch (error) {
      const result = await settled(ctx, pendingEmailId);
      return result.status === "not_sent" ? { ...result, message: userText(error) } : result;
    }
  },
});
