import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

async function resolveReferencedThread(
  ctx: ActionCtx,
  notification: Doc<"notifications">,
): Promise<Doc<"threads"> | null> {
  for (const candidate of [notification.actionPayload, notification.sourceRef]) {
    if (!candidate || !("threadId" in candidate)) continue;
    const thread = await ctx.runQuery(internal.threads.getInternal, {
      id: candidate.threadId,
    });
    if (thread?.orgId === notification.orgId) return thread;
  }
  return null;
}

export async function resolveNotificationThreadContext(
  ctx: ActionCtx,
  notification: Doc<"notifications">,
): Promise<{
  thread: Doc<"threads"> | null;
  privateThreadOwner?: Id<"users">;
  threadLabel?: string;
}> {
  const thread = await resolveReferencedThread(ctx, notification);
  const privateThreadOwner =
    notification.actionType === "view_thread" &&
    thread?.visibility === "user_private"
      ? thread.createdBy
      : undefined;
  return {
    thread,
    privateThreadOwner,
    threadLabel: thread?.title.trim() || undefined,
  };
}
