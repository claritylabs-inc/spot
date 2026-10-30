"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { runOperatorEmailTool } from "../lib/operatorEmailTools";
import { sendOperatorInboxDraft } from "../lib/operatorInboxSend";
import { threadFollowUpRequestValidator } from "../lib/threadFollowUps";

/**
 * Hand edits from the operator chat's draft artifact. They run the same
 * executors as the agent's `update_email_draft` and `cancel_email_draft`, as
 * the signed-in operator. The draft is re-signed as `fromUserId` (any active
 * operator with a team address; the signed-in one by default), keeps its links
 * and files, and any earlier exact approval is voided.
 */
export const update = action({
  args: {
    draftId: v.id("pendingEmails"),
    fromUserId: v.optional(v.id("users")),
    to: v.string(),
    cc: v.array(v.string()),
    bcc: v.array(v.string()),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { draftId, fromUserId, ...fields }): Promise<null> => {
    const target = await ctx.runQuery(
      internal.operatorEmailDrafts.editTargetInternal,
      { draftId },
    );
    const result = await runOperatorEmailTool(ctx, {
      operatorUserId: target.operatorUserId,
      senderUserId: fromUserId,
      threadId: target.threadId,
      toolName: "update_email_draft",
      input: {
        draftId,
        ...fields,
        attachmentFileIds: target.attachmentFileIds,
      },
    });
    if ("status" in result && result.status === "error") {
      throw new Error(String(result.message ?? "The draft could not be saved."));
    }
    return null;
  },
});

export const cancel = action({
  args: { draftId: v.id("pendingEmails") },
  handler: async (ctx, { draftId }): Promise<null> => {
    const target = await ctx.runQuery(
      internal.operatorEmailDrafts.editTargetInternal,
      { draftId },
    );
    await runOperatorEmailTool(ctx, {
      operatorUserId: target.operatorUserId,
      threadId: target.threadId,
      toolName: "cancel_email_draft",
      input: { draftId },
    });
    return null;
  },
});

/**
 * Sends a chat draft from its artifact: any active operator's click approves
 * the exact draft shown, as its signer, then the same claimed delivery as an
 * inbox reply sends it once. With `followUps`, Spot nudges the recipient on
 * the sent thread until anyone replies, as for an inbox reply.
 */
export const send = action({
  args: {
    draftId: v.id("pendingEmails"),
    expectedFingerprint: v.string(),
    followUps: v.optional(threadFollowUpRequestValidator),
  },
  handler: async (ctx, args): Promise<{ recipientEmail: string }> => {
    await ctx.runMutation(internal.operatorEmailDrafts.approveSendInternal, args);
    return await sendOperatorInboxDraft(ctx, { pendingEmailId: args.draftId });
  },
});
