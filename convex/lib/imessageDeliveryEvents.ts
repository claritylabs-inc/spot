import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ImessageChannelRole } from "./imessageConfig";

export type ImessageAttachmentFailureInput = {
  filename?: string;
  error?: string;
};

/**
 * Records attachments that failed iMessage transport delivery on the agent
 * message. Returns false when the referenced operator message is missing.
 */
export async function recordImessageAttachmentDeliveryFailures(
  ctx: Pick<ActionCtx, "runMutation">,
  role: ImessageChannelRole,
  args: {
    threadMessageId: string;
    attachmentFailures: ImessageAttachmentFailureInput[];
  },
): Promise<boolean> {
  const failures = args.attachmentFailures
    .map((failure) => ({
      filename: failure.filename?.trim() ?? "",
      error: failure.error?.trim() || undefined,
    }))
    .filter((failure) => failure.filename);
  if (failures.length === 0) return true;
  if (role === "operator") {
    return await ctx.runMutation(
      internal.operatorAgent.recordImessageAttachmentDeliveryFailureInternal,
      {
        operatorMessageId: args.threadMessageId as Id<"operatorAgentMessages">,
        stage: "worker_delivery",
        failures,
      },
    );
  }
  await ctx.runMutation(
    internal.threads.recordImessageAttachmentDeliveryFailure,
    {
      threadMessageId: args.threadMessageId as Id<"threadMessages">,
      stage: "worker_delivery",
      failures,
    },
  );
  return true;
}
