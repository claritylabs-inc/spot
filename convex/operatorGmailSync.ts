import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import {
  GMAIL_CHECK_GAPS_MS,
  READER_REFRESH_INTERVAL_MS,
  RECOVERY_ACTIVE_WINDOW_MS,
  bindGmailThread,
  gmailSyncEnabled,
} from "./lib/gmailThreadBinding";
import { requireOperator } from "./lib/operatorIdentity";
import {
  inboxAttachmentValidator,
  inboxEmailValidator,
} from "./lib/providerOutreachValidators";
import { mirrorTeamEmail } from "./lib/teamEmailStore";
import { gmailConnectionForAddress } from "./gmailInbound";
import { notifyTeamInbound } from "./teamInboxEvents";

/**
 * Persistence for the Gmail thread refresh (`actions/operatorGmailSync`): the
 * bindings between Spot conversations and Gmail threads, the follow-up check
 * schedule, the Pub/Sub history cursor and its lease, and the mirror of one
 * Gmail message into its bound conversation.
 */

const SYNC_LEASE_MS = 5 * 60 * 1000;
/** A scheduled check that has not run this long after it was due lost its job. */
const OVERDUE_CHECK_MS = 60 * 60 * 1000;
const OVERDUE_BATCH = 50;
const RECOVERY_PAGE = 25;
/** Mail older than the conversation's first stored message is earlier history, not part of it. */
const HISTORY_SLACK_MS = 10 * 60 * 1000;
const RENEWAL_BATCH = 200;
const SYNC_ERROR_CHARS = 300;

const gmailMessageKey = (address: string, gmailMessageId: string) =>
  `google:${address}:${gmailMessageId}`;

/** History ids are unsigned 64-bit numbers in strings: compare them as numbers, never as text. */
const isNewerHistoryId = (candidate: string, current: string | undefined) => {
  if (!/^\d+$/.test(candidate)) return false;
  if (current === undefined || !/^\d+$/.test(current)) return true;
  return BigInt(candidate) > BigInt(current);
};

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * The reader opened a conversation: refresh each Gmail thread bound to it whose
 * last refresh is older than five minutes. The time is claimed here so
 * concurrent readers schedule one refresh.
 */
export const requestRefresh = mutation({
  args: { threadId: v.id("teamEmailThreads") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    if (!gmailSyncEnabled()) return null;
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.deletedAt) return null;
    const bindings = await ctx.db
      .query("teamEmailGmailThreads")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .take(20);
    const now = dayjs().valueOf();
    for (const binding of bindings) {
      if (now - (binding.lastRefreshedAt ?? 0) < READER_REFRESH_INTERVAL_MS) continue;
      const connection = await ctx.db.get(binding.connectionId);
      if (!connection || connection.status !== "active" || connection.address !== binding.address)
        continue;
      await ctx.db.patch(binding._id, { lastRefreshedAt: now });
      await ctx.scheduler.runAfter(0, internal.actions.operatorGmailSync.refreshBinding, {
        bindingId: binding._id,
      });
    }
    return null;
  },
});

/**
 * Ends one follow-up check. `done` moves to the next gap (the schedule ends
 * after the last), `retry` repeats the check later, `stop` ends the schedule.
 * Only the job made for the binding's current `nextCheckAt` has an effect.
 */
export const advanceCheckInternal = internalMutation({
  args: {
    bindingId: v.id("teamEmailGmailThreads"),
    expectedNextCheckAt: v.number(),
    outcome: v.union(v.literal("done"), v.literal("retry"), v.literal("stop")),
    retryInMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const binding = await ctx.db.get(args.bindingId);
    if (!binding || binding.nextCheckAt !== args.expectedNextCheckAt) return null;
    const now = dayjs().valueOf();
    let checks = binding.checks;
    let gap: number | undefined;
    if (args.outcome === "retry") gap = args.retryInMs ?? GMAIL_CHECK_GAPS_MS[0];
    else if (args.outcome === "done") {
      checks += 1;
      gap = GMAIL_CHECK_GAPS_MS[checks];
    }
    if (gap === undefined) {
      await ctx.db.patch(binding._id, { checks, nextCheckAt: undefined });
      return null;
    }
    const nextCheckAt = now + gap;
    await ctx.db.patch(binding._id, { checks, nextCheckAt });
    await ctx.scheduler.runAt(nextCheckAt, internal.actions.operatorGmailSync.runScheduledCheck, {
      bindingId: binding._id,
      expectedNextCheckAt: nextCheckAt,
    });
    return null;
  },
});

/** Daily safety net: a check whose scheduled job was lost runs again soon. */
export const recoverOverdueChecksInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = dayjs().valueOf();
    const overdue = await ctx.db
      .query("teamEmailGmailThreads")
      .withIndex("by_nextCheckAt", (q) =>
        q.gt("nextCheckAt", 0).lt("nextCheckAt", now - OVERDUE_CHECK_MS),
      )
      .take(OVERDUE_BATCH);
    for (const binding of overdue) {
      const nextCheckAt = now + GMAIL_CHECK_GAPS_MS[0];
      await ctx.db.patch(binding._id, { nextCheckAt });
      await ctx.scheduler.runAt(nextCheckAt, internal.actions.operatorGmailSync.runScheduledCheck, {
        bindingId: binding._id,
        expectedNextCheckAt: nextCheckAt,
      });
    }
    return overdue.length;
  },
});

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

/** Whether a scheduled check is still the binding's current one. */
export const pendingCheckInternal = internalQuery({
  args: { bindingId: v.id("teamEmailGmailThreads"), expectedNextCheckAt: v.number() },
  handler: async (ctx, args) =>
    (await ctx.db.get(args.bindingId))?.nextCheckAt === args.expectedNextCheckAt,
});

/** Binds a conversation to a Gmail thread found by a Resend copy's Message-ID. */
export const bindThreadInternal = internalMutation({
  args: {
    threadId: v.id("teamEmailThreads"),
    connectionId: v.id("operatorGmailConnections"),
    gmailThreadId: v.string(),
  },
  handler: async (ctx, args) => {
    const [thread, connection] = await Promise.all([
      ctx.db.get(args.threadId),
      ctx.db.get(args.connectionId),
    ]);
    if (!thread || thread.deletedAt || !connection || connection.status !== "active") return null;
    const binding = await bindGmailThread(ctx, {
      threadId: args.threadId,
      connection,
      gmailThreadId: args.gmailThreadId,
      now: dayjs().valueOf(),
    });
    return { bindingId: binding._id, bound: binding.threadId === args.threadId };
  },
});

/** The bound conversations among a batch of Gmail threads of one connection. */
export const bindingsForGmailThreadsInternal = internalQuery({
  args: { connectionId: v.id("operatorGmailConnections"), gmailThreadIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const found: Id<"teamEmailGmailThreads">[] = [];
    for (const gmailThreadId of args.gmailThreadIds.slice(0, 100)) {
      const binding = await ctx.db
        .query("teamEmailGmailThreads")
        .withIndex("by_connectionId_and_gmailThreadId", (q) =>
          q.eq("connectionId", args.connectionId).eq("gmailThreadId", gmailThreadId),
        )
        .first();
      if (binding) found.push(binding._id);
    }
    return found;
  },
});

/** One page of the connection's bindings whose conversation was active in the last 30 days. */
export const recoveryPageInternal = internalQuery({
  args: { connectionId: v.id("operatorGmailConnections"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("teamEmailGmailThreads")
      .withIndex("by_connectionId_and_gmailThreadId", (q) => q.eq("connectionId", args.connectionId))
      .paginate({ cursor: args.cursor, numItems: RECOVERY_PAGE });
    const since = dayjs().valueOf() - RECOVERY_ACTIVE_WINDOW_MS;
    const bindingIds: Id<"teamEmailGmailThreads">[] = [];
    for (const binding of page.page) {
      const thread = await ctx.db.get(binding.threadId);
      if (thread && !thread.deletedAt && thread.latestMessageAt >= since)
        bindingIds.push(binding._id);
    }
    return { bindingIds, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/** What a refresh needs about a binding: null when it should do nothing. */
export const refreshContextInternal = internalQuery({
  args: { bindingId: v.id("teamEmailGmailThreads") },
  handler: async (ctx, args) => {
    const binding = await ctx.db.get(args.bindingId);
    if (!binding) return null;
    const [connection, thread] = await Promise.all([
      ctx.db.get(binding.connectionId),
      ctx.db.get(binding.threadId),
    ]);
    if (!connection || !thread || thread.deletedAt) return null;
    const first = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
      .first();
    return {
      gmailThreadId: binding.gmailThreadId,
      address: binding.address,
      connectionId: connection._id,
      connectionActive: connection.status === "active" && connection.address === binding.address,
      /** Gmail messages older than this are history from before the conversation reached Spot. */
      importedSince: first ? first.receivedAt - HISTORY_SLACK_MS : 0,
    };
  },
});

/** Which of a Gmail thread's message ids Spot has not stored yet. */
export const unstoredMessageIdsInternal = internalQuery({
  args: { address: v.string(), gmailMessageIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const unstored: string[] = [];
    for (const gmailMessageId of args.gmailMessageIds.slice(0, 200)) {
      const key = gmailMessageKey(args.address, gmailMessageId);
      const stored = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_resendInboxEmailId", (q) => q.eq("resendInboxEmailId", key))
        .first();
      if (!stored) unstored.push(gmailMessageId);
    }
    return unstored;
  },
});

/**
 * Mirrors one Gmail message into the conversation its Gmail thread is bound to.
 * A message from the Sent label is the operator's own outbound mail and stops
 * automated follow-ups, as a reply sent from Spot does; anything else is
 * inbound and alerts the team. A copy already stored through the Resend inbox
 * (same Message-ID and sender in this conversation) is not stored again.
 */
export const mirrorGmailMessageInternal = internalMutation({
  args: {
    bindingId: v.id("teamEmailGmailThreads"),
    email: inboxEmailValidator,
    attachments: v.array(inboxAttachmentValidator),
    sent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const dropUploads = () =>
      Promise.all(args.attachments.map((file) => ctx.storage.delete(file.fileId)));
    const binding = await ctx.db.get(args.bindingId);
    const connection = binding ? await ctx.db.get(binding.connectionId) : null;
    const thread = binding ? await ctx.db.get(binding.threadId) : null;
    if (
      !binding ||
      !connection ||
      connection.status !== "active" ||
      connection.address !== binding.address ||
      !thread ||
      thread.deletedAt ||
      !args.email.resendInboxEmailId.startsWith(gmailMessageKey(binding.address, ""))
    ) {
      await dropUploads();
      return { applied: false as const };
    }
    const now = dayjs().valueOf();
    const mirrored = await mirrorTeamEmail(ctx, {
      target: { thread },
      email: args.email,
      direction: args.sent ? "outbound" : "inbound",
      attachments: args.attachments,
      sentByUserId: args.sent ? connection.ownerUserId : undefined,
      gmailAddress: connection.address,
      ownCopyCheck: args.sent,
      now,
    });
    if ("rejected" in mirrored) return { applied: false as const };
    if (!mirrored.duplicate) {
      if (args.sent)
        await ctx.scheduler.runAfter(
          0,
          internal.providerOutreach.stopFollowUpsForOperatorReplyInternal,
          { teamEmailThreadId: mirrored.threadId },
        );
      else
        await notifyTeamInbound(ctx, {
          threadId: mirrored.threadId,
          messageId: mirrored.messageId,
          fromEmail: args.email.fromEmail,
          fallbackOwnerUserId: connection.ownerUserId,
          now,
        });
    }
    return { applied: true as const };
  },
});

/** Records that a binding's Gmail thread was read; `gone` ends its schedule (the thread no longer exists). */
export const finishRefreshInternal = internalMutation({
  args: { bindingId: v.id("teamEmailGmailThreads"), gone: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const binding = await ctx.db.get(args.bindingId);
    if (!binding) return null;
    await ctx.db.patch(binding._id, {
      lastRefreshedAt: dayjs().valueOf(),
      ...(args.gone ? { nextCheckAt: undefined } : {}),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// History cursor, lease and watch state
// ---------------------------------------------------------------------------

export const connectionInternal = internalQuery({
  args: { connectionId: v.id("operatorGmailConnections") },
  handler: async (ctx, args) => await ctx.db.get(args.connectionId),
});

/** Active connections, for the daily watch renewal and catch-up. */
export const activeConnectionsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("operatorGmailConnections")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(RENEWAL_BATCH);
    return rows.map((row) => ({ _id: row._id, watchExpiresAt: row.watchExpiresAt }));
  },
});

/** The connection a Pub/Sub notification is for, in any status, and whether it still has a watch. */
export const pushTargetInternal = internalQuery({
  args: { address: v.string() },
  handler: async (ctx, args) => {
    const connection = await gmailConnectionForAddress(ctx, args.address);
    return connection
      ? {
          connectionId: connection._id,
          status: connection.status,
          watching: connection.watchExpiresAt !== undefined,
        }
      : null;
  },
});

/** Takes the connection's history lease, or says why nothing should run. */
export const claimSyncInternal = internalMutation({
  args: { connectionId: v.id("operatorGmailConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status === "disconnected")
      return { status: "skipped" as const, reason: "inactive" as const };
    if (connection.status !== "active")
      return { status: "skipped" as const, reason: "needs_reconnect" as const };
    const now = dayjs().valueOf();
    if ((connection.syncLeaseUntil ?? 0) > now) return { status: "leased" as const };
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch(connection._id, {
      syncLeaseToken: leaseToken,
      syncLeaseUntil: now + SYNC_LEASE_MS,
    });
    return {
      status: "claimed" as const,
      leaseToken,
      address: connection.address,
      historyId: connection.historyId ?? null,
    };
  },
});

/**
 * Releases the lease. `historyId` moves the cursor forward (never back) only
 * when the whole batch it covers is processed; `error` records a short note
 * for the profile card, `ok` clears it and stamps the sync time.
 */
export const releaseSyncInternal = internalMutation({
  args: {
    connectionId: v.id("operatorGmailConnections"),
    leaseToken: v.string(),
    historyId: v.optional(v.string()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.syncLeaseToken !== args.leaseToken) return null;
    await ctx.db.patch(connection._id, {
      syncLeaseToken: undefined,
      syncLeaseUntil: undefined,
      ...(args.historyId && isNewerHistoryId(args.historyId, connection.historyId)
        ? { historyId: args.historyId }
        : {}),
      ...(args.ok ? { lastSyncAt: dayjs().valueOf(), syncError: undefined } : {}),
      ...(args.error ? { syncError: args.error.slice(0, SYNC_ERROR_CHARS) } : {}),
    });
    return null;
  },
});

/** The first watch keeps its history id as the baseline; a renewal keeps the cursor it has. */
export const recordWatchInternal = internalMutation({
  args: {
    connectionId: v.id("operatorGmailConnections"),
    historyId: v.optional(v.string()),
    watchExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || connection.status !== "active") return null;
    await ctx.db.patch(connection._id, {
      watchExpiresAt: args.watchExpiresAt,
      ...(args.historyId && connection.historyId === undefined ? { historyId: args.historyId } : {}),
    });
    return null;
  },
});

export const clearWatchInternal = internalMutation({
  args: { connectionId: v.id("operatorGmailConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (connection?.watchExpiresAt !== undefined)
      await ctx.db.patch(connection._id, { watchExpiresAt: undefined });
    return null;
  },
});

export const recordSyncErrorInternal = internalMutation({
  args: { connectionId: v.id("operatorGmailConnections"), error: v.string() },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (connection)
      await ctx.db.patch(connection._id, { syncError: args.error.slice(0, SYNC_ERROR_CHARS) });
    return null;
  },
});

/** After an expired cursor: start again from the mailbox's current history id and say so. */
export const resetHistoryInternal = internalMutation({
  args: {
    connectionId: v.id("operatorGmailConnections"),
    historyId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    await ctx.db.patch(connection._id, {
      historyId: args.historyId,
      syncError: args.error.slice(0, SYNC_ERROR_CHARS),
    });
    return null;
  },
});
