import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

export type ImessageAttachmentFailureInput = {
  filename?: string;
  error?: string;
};

/**
 * Records attachments that failed iMessage transport delivery on the agent
 * message.
 */
export async function recordImessageAttachmentDeliveryFailures(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    threadMessageId: string;
    attachmentFailures: ImessageAttachmentFailureInput[];
  },
): Promise<void> {
  const failures = args.attachmentFailures
    .map((failure) => ({
      filename: failure.filename?.trim() ?? "",
      error: failure.error?.trim() || undefined,
    }))
    .filter((failure) => failure.filename);
  if (failures.length === 0) return;
  await ctx.runMutation(
    internal.threads.recordImessageAttachmentDeliveryFailure,
    {
      threadMessageId: args.threadMessageId as Id<"threadMessages">,
      stage: "worker_delivery",
      failures,
    },
  );
}
