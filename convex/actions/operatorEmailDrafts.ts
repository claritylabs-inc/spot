"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { runOperatorEmailTool } from "../lib/operatorEmailTools";

/**
 * Hand edits from the operator chat's draft artifact. They run the same
 * executors as the agent's `update_email_draft` and `cancel_email_draft`, as
 * the signed-in operator: the draft is re-signed, keeps its links and files,
 * and any earlier exact approval is voided.
 */
export const update = action({
  args: {
    draftId: v.id("pendingEmails"),
    to: v.string(),
    cc: v.array(v.string()),
    bcc: v.array(v.string()),
    subject: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { draftId, ...fields }): Promise<null> => {
    const target = await ctx.runQuery(
      internal.operatorEmailDrafts.editTargetInternal,
      { draftId },
    );
    const result = await runOperatorEmailTool(ctx, {
      operatorUserId: target.operatorUserId,
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
