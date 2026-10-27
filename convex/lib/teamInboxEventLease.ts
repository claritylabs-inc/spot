import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const EVENT_ERROR_CHARS = 500;

/** A row for an inbox this deployment created (active or retired), else null. */
export async function knownInbox(ctx: QueryCtx | MutationCtx, inboxId: string) {
  return await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_inboxId", (q) => q.eq("inboxId", inboxId))
    .first();
}

export async function fencedEvent(
  ctx: MutationCtx,
  eventId: Id<"providerOutreachWebhookEvents">,
  leaseToken: string,
  now: number,
) {
  const event = await ctx.db.get(eventId);
  if (!event || event.status !== "processing" || event.leaseToken !== leaseToken || (event.leaseUntil ?? 0) <= now)
    return null;
  return event;
}

export async function finishEvent(
  ctx: MutationCtx,
  event: Doc<"providerOutreachWebhookEvents">,
  now: number,
  error?: string,
) {
  await ctx.db.patch(event._id, {
    status: error ? "failed" : "completed",
    error: error ? clipEventError(error) : undefined,
    leaseToken: undefined,
    leaseUntil: undefined,
    updatedAt: now,
  });
}

export function clipEventError(error: string) {
  return error.length > EVENT_ERROR_CHARS ? `${error.slice(0, EVENT_ERROR_CHARS - 1)}…` : error;
}
