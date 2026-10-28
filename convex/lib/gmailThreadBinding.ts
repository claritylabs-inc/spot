import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { gmailConnectionForAddress } from "../gmailInbound";
import { getEmailDeliveryMode } from "./resend";

/**
 * Bindings between Spot conversations and the Gmail threads of a connected
 * Gmail (`teamEmailGmailThreads`). Only messages on a bound Gmail thread are
 * ever read from the mailbox. The tables and the Resend inbox links
 * (`teamEmailThreadLinks`) are deliberately separate: Resend reply planning
 * reads the latter.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Gaps between a send's follow-up checks: about +5m, +1h, +6h, +1d, +3d and +7d after the send. */
export const GMAIL_CHECK_GAPS_MS = [
  5 * MINUTE_MS,
  55 * MINUTE_MS,
  5 * HOUR_MS,
  18 * HOUR_MS,
  2 * DAY_MS,
  4 * DAY_MS,
] as const;

/** A reader opening a thread refreshes it only when the last refresh is older than this. */
export const READER_REFRESH_INTERVAL_MS = 5 * MINUTE_MS;
/** A Resend copy is given a moment to reach the Gmail mailbox before the thread is read. */
export const RESEND_COPY_REFRESH_DELAY_MS = 30 * 1000;
/** Conversations with activity inside this window are refreshed after an expired history cursor. */
export const RECOVERY_ACTIVE_WINDOW_MS = 30 * DAY_MS;

export const gmailPushTopic = () => process.env.GOOGLE_GMAIL_PUBSUB_TOPIC?.trim() || null;

/** Capture mode never talks to Gmail: no refreshes, watches or pushes. */
export const gmailSyncEnabled = () => getEmailDeliveryMode() !== "capture";

export type GmailThreadBinding = Doc<"teamEmailGmailThreads">;

/**
 * Binds a Spot conversation to a Gmail thread of `connection`. A Gmail thread
 * belongs to one live conversation: if another one already holds it, that
 * binding is returned untouched. A binding whose conversation is gone, or that
 * was made for another address of a reused connection row, is repointed.
 */
export async function bindGmailThread(
  ctx: MutationCtx,
  args: {
    threadId: Id<"teamEmailThreads">;
    connection: Doc<"operatorGmailConnections">;
    gmailThreadId: string;
    now: number;
  },
): Promise<GmailThreadBinding> {
  const { connection } = args;
  const existing = await ctx.db
    .query("teamEmailGmailThreads")
    .withIndex("by_connectionId_and_gmailThreadId", (q) =>
      q.eq("connectionId", connection._id).eq("gmailThreadId", args.gmailThreadId),
    )
    .first();
  if (existing) {
    if (existing.threadId === args.threadId && existing.address === connection.address)
      return existing;
    const owner = await ctx.db.get(existing.threadId);
    if (owner && !owner.deletedAt && existing.address === connection.address) return existing;
    await ctx.db.patch(existing._id, {
      threadId: args.threadId,
      address: connection.address,
      checks: 0,
      nextCheckAt: undefined,
    });
    return (await ctx.db.get(existing._id))!;
  }
  const id = await ctx.db.insert("teamEmailGmailThreads", {
    threadId: args.threadId,
    connectionId: connection._id,
    address: connection.address,
    gmailThreadId: args.gmailThreadId,
    checks: 0,
    createdAt: args.now,
  });
  return (await ctx.db.get(id))!;
}

/**
 * Restarts a binding's follow-up schedule after a Gmail send. One scheduled job
 * exists per binding: it carries the `nextCheckAt` it was made for, so an older
 * job whose binding has moved on does nothing.
 */
export async function startFollowUpChecks(
  ctx: MutationCtx,
  binding: GmailThreadBinding,
  now: number,
) {
  if (!gmailSyncEnabled()) return;
  const nextCheckAt = now + GMAIL_CHECK_GAPS_MS[0];
  await ctx.db.patch(binding._id, { checks: 0, nextCheckAt });
  await ctx.scheduler.runAt(nextCheckAt, internal.actions.operatorGmailSync.runScheduledCheck, {
    bindingId: binding._id,
    expectedNextCheckAt: nextCheckAt,
  });
}

/**
 * Binds the conversation of a recorded Gmail send to the Gmail thread the send
 * landed in (kept on its `operatorGmailDrafts` row) and schedules the follow-up checks.
 */
export async function bindRecordedGmailSend(
  ctx: MutationCtx,
  args: { threadId: Id<"teamEmailThreads">; messageId: string; now: number },
) {
  const draft = await ctx.db
    .query("operatorGmailDrafts")
    .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
    .first();
  if (!draft?.gmailThreadId) return;
  const connection = await ctx.db.get(draft.connectionId);
  if (!connection) return;
  const binding = await bindGmailThread(ctx, {
    threadId: args.threadId,
    connection,
    gmailThreadId: draft.gmailThreadId,
    now: args.now,
  });
  if (binding.threadId === args.threadId) await startFollowUpChecks(ctx, binding, args.now);
}

/**
 * A Resend copy that names a connected Gmail arrived in `threadId`. A bound
 * conversation is refreshed shortly (the copy may be one of several new
 * messages); an unbound one schedules a lookup of the copy's Message-ID in that
 * Gmail, which binds the Gmail thread it finds. A copy of Spot's own send needs
 * no refresh, only a binding.
 */
export async function noteGmailCopy(
  ctx: MutationCtx,
  args: {
    threadId: Id<"teamEmailThreads">;
    gmailAddress: string;
    messageId?: string;
    fromEmail: string;
    internalCopy: boolean;
  },
) {
  if (!gmailSyncEnabled()) return;
  const connection = await gmailConnectionForAddress(ctx, args.gmailAddress);
  if (!connection || connection.status !== "active") return;
  const bindings = await ctx.db
    .query("teamEmailGmailThreads")
    .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
    .take(20);
  const bound = bindings.find((binding) => binding.connectionId === connection._id);
  if (bound) {
    if (!args.internalCopy)
      await ctx.scheduler.runAfter(
        RESEND_COPY_REFRESH_DELAY_MS,
        internal.actions.operatorGmailSync.refreshBinding,
        { bindingId: bound._id },
      );
    return;
  }
  if (!args.messageId) return;
  await ctx.scheduler.runAfter(
    RESEND_COPY_REFRESH_DELAY_MS,
    internal.actions.operatorGmailSync.bindFromMessageId,
    {
      connectionId: connection._id,
      threadId: args.threadId,
      messageId: args.messageId,
      fromEmail: args.fromEmail,
    },
  );
}
