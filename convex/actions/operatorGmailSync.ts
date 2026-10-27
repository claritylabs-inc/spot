"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { extractEmailAddress } from "../lib/emailAddress";
import {
  SYNC_NOTES,
  classifySyncError,
  decodePushNotification,
  describeFailure,
  startWatch,
  stopWatchBestEffort,
  verifyPushAuthorization,
  type SyncFailure,
} from "../lib/gmailSync";
import { gmailPushTopic, gmailSyncEnabled } from "../lib/gmailThreadBinding";
import { importGmailMessage } from "../lib/gmailThreadMessage";
import { messageHeaders } from "../lib/googleWorkspace/messages";
import { createGoogleWorkspaceProvider } from "../lib/googleWorkspaceProvider";
import { bareRfcId } from "../lib/messageId";

/**
 * Reads Gmail threads that are bound to Spot conversations
 * (`teamEmailGmailThreads`) and mirrors their new messages. Nothing else in
 * the mailbox is ever fetched: a thread is read only because a Spot send, a
 * Resend copy or a reader opening a conversation bound it, and a push
 * notification only names the threads to look at.
 */

/** A Gmail thread contributes at most its newest messages, and a refresh imports a bounded batch. */
const MAX_THREAD_MESSAGES = 100;
const MAX_IMPORTS_PER_REFRESH = 25;
const HISTORY_PAGE_SIZE = 100;
const BINDING_LOOKUP_CHUNK = 50;
/** Work stops short of the action's time limit and carries on in a fresh run. */
const RUN_BUDGET_MS = 7 * 60 * 1000;
const LEASE_RETRY_MS = 15 * 1000;
const MAX_LEASE_RETRIES = 5;
const MAX_BACKOFF_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const WATCH_RENEW_BEFORE_MS = 48 * 60 * 60 * 1000;
const CATCH_UP_STAGGER_MS = 5 * 1000;
const SKIPPED_LABELS = ["DRAFT", "TRASH", "SPAM"];
/** A Message-ID that is safe to put in a Gmail search: no whitespace, quotes or search operators. */
const SEARCHABLE_MESSAGE_ID = /^[^\s"'(){}<>:]+$/;

const warn = (what: string, failure: SyncFailure) =>
  console.warn(`[gmail-sync] ${what}: ${describeFailure(failure)}`);

type RefreshResult =
  | { status: "ok"; imported: number }
  | { status: "skipped"; reason: "capture_mode" | "unavailable" | "inactive" | "thread_gone" }
  | { status: "failed"; failure: SyncFailure };

/**
 * Reads one bound Gmail thread and mirrors the messages Spot has not stored.
 * Mail from before the conversation reached Spot, drafts, trash and spam are
 * not imported; a message already stored by either path is recognised by its
 * `google:<address>:<gmailMessageId>` key, or by Message-ID and sender when the
 * Resend inbox stored it.
 */
async function refreshThread(
  ctx: ActionCtx,
  bindingId: Id<"teamEmailGmailThreads">,
): Promise<RefreshResult> {
  if (!gmailSyncEnabled()) return { status: "skipped", reason: "capture_mode" };
  const context = await ctx.runQuery(internal.operatorGmailSync.refreshContextInternal, {
    bindingId,
  });
  if (!context) return { status: "skipped", reason: "unavailable" };
  if (!context.connectionActive) return { status: "skipped", reason: "inactive" };
  try {
    const provider = createGoogleWorkspaceProvider({ kind: "oauth", ctx });
    let summaries: Awaited<ReturnType<typeof provider.getThreadMessageSummaries>>;
    try {
      summaries = await provider.getThreadMessageSummaries({
        mailbox: context.address,
        threadId: context.gmailThreadId,
      });
    } catch (error) {
      if (classifySyncError(error).kind !== "not_found") throw error;
      await ctx.runMutation(internal.operatorGmailSync.finishRefreshInternal, {
        bindingId,
        gone: true,
      });
      return { status: "skipped", reason: "thread_gone" };
    }
    const candidates = summaries
      .slice(-MAX_THREAD_MESSAGES)
      .filter(
        (message) =>
          !message.labelIds.some((label) => SKIPPED_LABELS.includes(label)) &&
          (message.internalDate === null || message.internalDate >= context.importedSince),
      )
      .map((message) => message.id);
    const unstored = await ctx.runQuery(internal.operatorGmailSync.unstoredMessageIdsInternal, {
      address: context.address,
      gmailMessageIds: candidates,
    });
    let imported = 0;
    for (const gmailMessageId of unstored.slice(0, MAX_IMPORTS_PER_REFRESH)) {
      const raw = await provider.getMessageRaw({
        mailbox: context.address,
        messageId: gmailMessageId,
      });
      const message = await importGmailMessage(ctx, { address: context.address, message: raw });
      try {
        const mirrored = await ctx.runMutation(internal.operatorGmailSync.mirrorGmailMessageInternal, {
          bindingId,
          email: message.email,
          attachments: message.attachments,
          sent: message.sent,
        });
        if (mirrored.applied) imported += 1;
      } catch (error) {
        await Promise.all(
          message.attachments.map((file) => ctx.storage.delete(file.fileId).catch(() => null)),
        );
        throw error;
      }
    }
    await ctx.runMutation(internal.operatorGmailSync.finishRefreshInternal, { bindingId });
    return { status: "ok", imported };
  } catch (error) {
    const failure = classifySyncError(error);
    if (failure.kind === "reconnect")
      await ctx.runMutation(internal.operatorGmail.markNeedsReconnectInternal, {
        connectionId: context.connectionId,
        error: SYNC_NOTES.reconnect,
      });
    return { status: "failed", failure };
  }
}

/** The shared ingest step, addressed by Gmail thread. */
export const refreshGmailThread = internalAction({
  args: { connectionId: v.id("operatorGmailConnections"), gmailThreadId: v.string() },
  handler: async (ctx, args): Promise<RefreshResult> => {
    const [bindingId] = await ctx.runQuery(internal.operatorGmailSync.bindingsForGmailThreadsInternal, {
      connectionId: args.connectionId,
      gmailThreadIds: [args.gmailThreadId],
    });
    return bindingId
      ? await refreshThread(ctx, bindingId)
      : { status: "skipped", reason: "unavailable" };
  },
});

/** Refresh by binding: reader opens and Resend copies of bound conversations. */
export const refreshBinding = internalAction({
  args: { bindingId: v.id("teamEmailGmailThreads") },
  handler: async (ctx, args): Promise<RefreshResult> => {
    const result = await refreshThread(ctx, args.bindingId);
    if (result.status === "failed") warn("refresh failed", result.failure);
    return result;
  },
});

// ---------------------------------------------------------------------------
// Event triggers
// ---------------------------------------------------------------------------

/** One follow-up check after a Gmail send, then the schedule moves to its next gap. */
export const runScheduledCheck = internalAction({
  args: { bindingId: v.id("teamEmailGmailThreads"), expectedNextCheckAt: v.number() },
  handler: async (ctx, args): Promise<null> => {
    if (!(await ctx.runQuery(internal.operatorGmailSync.pendingCheckInternal, args))) return null;
    const result = await refreshThread(ctx, args.bindingId);
    let outcome: "done" | "retry" | "stop" = "done";
    let retryInMs: number | undefined;
    if (result.status === "skipped") outcome = "stop";
    else if (result.status === "failed") {
      warn("scheduled check failed", result.failure);
      if (result.failure.kind === "reconnect") outcome = "stop";
      else if (result.failure.kind === "throttled") {
        outcome = "retry";
        retryInMs = Math.min(result.failure.retryAfterMs, MAX_BACKOFF_MS);
      }
    }
    await ctx.runMutation(internal.operatorGmailSync.advanceCheckInternal, {
      bindingId: args.bindingId,
      expectedNextCheckAt: args.expectedNextCheckAt,
      outcome,
      ...(retryInMs !== undefined ? { retryInMs } : {}),
    });
    return null;
  },
});

/**
 * A Resend copy names a connected Gmail but its conversation has no Gmail
 * binding: find the copy in that Gmail by Message-ID and bind the thread it is
 * on. The Gmail message must be from the same sender as the copy, so a forged
 * Message-ID cannot pull another conversation into this one.
 */
export const bindFromMessageId = internalAction({
  args: {
    connectionId: v.id("operatorGmailConnections"),
    threadId: v.id("teamEmailThreads"),
    messageId: v.string(),
    fromEmail: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    if (!gmailSyncEnabled()) return null;
    const bare = bareRfcId(args.messageId);
    if (!SEARCHABLE_MESSAGE_ID.test(bare)) return null;
    const connection = await ctx.runQuery(internal.operatorGmailSync.connectionInternal, {
      connectionId: args.connectionId,
    });
    if (!connection || connection.status !== "active") return null;
    try {
      const provider = createGoogleWorkspaceProvider({ kind: "oauth", ctx });
      const found = await provider.listMessages({
        mailbox: connection.address,
        query: `rfc822msgid:${bare}`,
        maxResults: 1,
      });
      const match = found.messages[0];
      if (!match) return null;
      const headers = await messageHeaders(
        await provider.getMessageMetadata({ mailbox: connection.address, messageId: match.id }),
      );
      const sender = extractEmailAddress(headers.value("From") ?? undefined)?.toLowerCase();
      if (sender !== args.fromEmail.trim().toLowerCase()) return null;
      const bound = await ctx.runMutation(internal.operatorGmailSync.bindThreadInternal, {
        threadId: args.threadId,
        connectionId: connection._id,
        gmailThreadId: match.threadId,
      });
      if (bound?.bound) await refreshThread(ctx, bound.bindingId);
    } catch (error) {
      const failure = classifySyncError(error);
      warn("binding lookup failed", failure);
      if (failure.kind === "reconnect")
        await ctx.runMutation(internal.operatorGmail.markNeedsReconnectInternal, {
          connectionId: connection._id,
          error: SYNC_NOTES.reconnect,
        });
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Pub/Sub push
// ---------------------------------------------------------------------------

/**
 * Handles a Pub/Sub push request (`POST /operator-gmail/push`). The Google OIDC
 * token is verified first; anything unverified is 401. Beyond it, every
 * outcome acknowledges (204) so Pub/Sub stops retrying: the work is scheduled,
 * and unknown, inactive or malformed notifications have nothing to retry.
 */
export const handlePush = internalAction({
  args: { authorization: v.string(), body: v.string() },
  handler: async (ctx, args): Promise<{ status: 204 | 401 }> => {
    if (!(await verifyPushAuthorization(args.authorization))) return { status: 401 };
    const notification = decodePushNotification(args.body);
    if (!notification || !gmailSyncEnabled()) return { status: 204 };
    const target = await ctx.runQuery(internal.operatorGmailSync.pushTargetInternal, {
      address: notification.emailAddress,
    });
    if (!target || target.status === "disconnected") return { status: 204 };
    if (target.status === "needs_reconnect") {
      if (target.watching)
        await ctx.scheduler.runAfter(0, internal.actions.operatorGmailSync.stopWatch, {
          connectionId: target.connectionId,
        });
      return { status: 204 };
    }
    await ctx.scheduler.runAfter(0, internal.actions.operatorGmailSync.processHistory, {
      connectionId: target.connectionId,
      notifiedHistoryId: notification.historyId,
    });
    return { status: 204 };
  },
});

/** Stops the watch of a connection that needs reconnecting, if its grant still allows it. */
export const stopWatch = internalAction({
  args: { connectionId: v.id("operatorGmailConnections") },
  handler: async (ctx, args): Promise<null> => {
    const connection = await ctx.runQuery(internal.operatorGmailSync.connectionInternal, args);
    if (!connection || connection.status === "active") return null;
    await stopWatchBestEffort(connection);
    await ctx.runMutation(internal.operatorGmailSync.clearWatchInternal, args);
    return null;
  },
});

/** A thread refresh failed in a way that should retry the whole history page. */
class SyncFailureError extends Error {
  constructor(readonly failure: SyncFailure) {
    super(failure.kind);
  }
}

const backoffMs = (attempt: number, retryAfterMs?: number) =>
  Math.min(retryAfterMs ?? 30 * 1000 * 2 ** attempt, MAX_BACKOFF_MS);

/**
 * Catches a connection up from its stored history cursor, one page per run:
 * the threads of added messages that are bound to a conversation are
 * refreshed and every other message is ignored without fetching it. The cursor
 * moves forward only after the last page is processed. More pages, a busy
 * lease and throttling reschedule the run rather than looping.
 */
export const processHistory = internalAction({
  args: {
    connectionId: v.id("operatorGmailConnections"),
    notifiedHistoryId: v.optional(v.string()),
    pageToken: v.optional(v.string()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ status: string }> => {
    if (!gmailSyncEnabled()) return { status: "disabled" };
    const attempt = args.attempt ?? 0;
    const claim = await ctx.runMutation(internal.operatorGmailSync.claimSyncInternal, {
      connectionId: args.connectionId,
    });
    if (claim.status === "skipped") return { status: claim.reason };
    if (claim.status === "leased") {
      // The holder may already be past the page this notification is about.
      if (attempt < MAX_LEASE_RETRIES)
        await ctx.scheduler.runAfter(LEASE_RETRY_MS, internal.actions.operatorGmailSync.processHistory, {
          ...args,
          attempt: attempt + 1,
        });
      return { status: "leased" };
    }
    const release = (fields: { historyId?: string; ok?: boolean; error?: string } = {}) =>
      ctx.runMutation(internal.operatorGmailSync.releaseSyncInternal, {
        connectionId: args.connectionId,
        leaseToken: claim.leaseToken,
        ...fields,
      });
    const started = dayjs().valueOf();
    try {
      const provider = createGoogleWorkspaceProvider({ kind: "oauth", ctx });
      if (claim.historyId === null) {
        // First notification after the watch: the mailbox's current position is the baseline.
        const profile = await provider.getProfile({ mailbox: claim.address });
        await release({ ...(profile.historyId ? { historyId: profile.historyId } : {}), ok: true });
        return { status: "baseline" };
      }
      if (
        !args.pageToken &&
        args.notifiedHistoryId &&
        BigInt(args.notifiedHistoryId) <= BigInt(claim.historyId)
      ) {
        await release({ ok: true });
        return { status: "up_to_date" };
      }
      const page = await provider.listHistory({
        mailbox: claim.address,
        startHistoryId: claim.historyId,
        pageToken: args.pageToken,
        maxResults: HISTORY_PAGE_SIZE,
      });
      const gmailThreadIds = [
        ...new Set(page.history.flatMap((record) => record.messagesAdded.map((added) => added.threadId))),
      ];
      for (let at = 0; at < gmailThreadIds.length; at += BINDING_LOOKUP_CHUNK) {
        const bindingIds = await ctx.runQuery(internal.operatorGmailSync.bindingsForGmailThreadsInternal, {
          connectionId: args.connectionId,
          gmailThreadIds: gmailThreadIds.slice(at, at + BINDING_LOOKUP_CHUNK),
        });
        for (const bindingId of bindingIds) {
          if (dayjs().valueOf() - started > RUN_BUDGET_MS) {
            // Nothing is advanced: the next run re-reads this page, and refreshes are idempotent.
            await release();
            await ctx.scheduler.runAfter(0, internal.actions.operatorGmailSync.processHistory, args);
            return { status: "continued" };
          }
          const result = await refreshThread(ctx, bindingId);
          if (result.status !== "failed") continue;
          if (result.failure.kind === "permanent") {
            // One unreadable thread must not hold the cursor back forever.
            warn("thread refresh failed", result.failure);
            continue;
          }
          // Retry the whole page later rather than move the cursor past an unread thread.
          throw new SyncFailureError(result.failure);
        }
      }
      if (page.nextPageToken) {
        await release();
        await ctx.scheduler.runAfter(0, internal.actions.operatorGmailSync.processHistory, {
          connectionId: args.connectionId,
          notifiedHistoryId: args.notifiedHistoryId,
          pageToken: page.nextPageToken,
        });
        return { status: "next_page" };
      }
      await release({ ...(page.historyId ? { historyId: page.historyId } : {}), ok: true });
      return { status: "processed" };
    } catch (error) {
      const failure = error instanceof SyncFailureError ? error.failure : classifySyncError(error);
      warn("history sync failed", failure);
      if (failure.kind === "not_found") {
        // The cursor is older than Gmail keeps history for.
        await release();
        await recoverHistory(ctx, args.connectionId);
        return { status: "recovering" };
      }
      if (failure.kind === "reconnect") {
        await release({ error: SYNC_NOTES.reconnect });
        await ctx.runMutation(internal.operatorGmail.markNeedsReconnectInternal, {
          connectionId: args.connectionId,
          error: SYNC_NOTES.reconnect,
        });
        return { status: "needs_reconnect" };
      }
      if (failure.kind === "throttled" || failure.kind === "transient") {
        if (attempt < MAX_BACKOFF_ATTEMPTS) {
          await release();
          await ctx.scheduler.runAfter(
            backoffMs(attempt, failure.kind === "throttled" ? failure.retryAfterMs : undefined),
            internal.actions.operatorGmailSync.processHistory,
            { ...args, attempt: attempt + 1 },
          );
          return { status: "retry_scheduled" };
        }
        await release({ error: failure.kind === "throttled" ? SYNC_NOTES.throttled : SYNC_NOTES.failed });
        return { status: "gave_up" };
      }
      // A permanent failure on one thread must not hold the cursor forever.
      await release({ error: SYNC_NOTES.failed });
      return { status: "failed" };
    }
  },
});

/**
 * The stored history id is too old. Start over from the mailbox's current
 * position, say so on the profile card, and refresh the conversations that
 * were active in the last 30 days: mail that arrived in the gap sits on one of
 * their Gmail threads or on none that matter.
 */
async function recoverHistory(ctx: ActionCtx, connectionId: Id<"operatorGmailConnections">) {
  try {
    const connection = await ctx.runQuery(internal.operatorGmailSync.connectionInternal, {
      connectionId,
    });
    if (!connection || connection.status !== "active") return;
    const profile = await createGoogleWorkspaceProvider({ kind: "oauth", ctx }).getProfile({
      mailbox: connection.address,
    });
    if (profile.historyId)
      await ctx.runMutation(internal.operatorGmailSync.resetHistoryInternal, {
        connectionId,
        historyId: profile.historyId,
        error: SYNC_NOTES.historyExpired,
      });
    await ctx.scheduler.runAfter(0, internal.actions.operatorGmailSync.recoverBindings, {
      connectionId,
      cursor: null,
    });
  } catch (error) {
    const failure = classifySyncError(error);
    warn("history recovery failed", failure);
    await ctx.runMutation(internal.operatorGmailSync.recordSyncErrorInternal, {
      connectionId,
      error: SYNC_NOTES.failed,
    });
  }
}

/** Refreshes the connection's recently active bindings one page at a time. */
export const recoverBindings = internalAction({
  args: {
    connectionId: v.id("operatorGmailConnections"),
    cursor: v.union(v.string(), v.null()),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<null> => {
    if (!gmailSyncEnabled()) return null;
    const page = await ctx.runQuery(internal.operatorGmailSync.recoveryPageInternal, {
      connectionId: args.connectionId,
      cursor: args.cursor,
    });
    for (const bindingId of page.bindingIds) {
      const result = await refreshThread(ctx, bindingId);
      if (result.status === "skipped" && result.reason === "inactive") return null;
      if (result.status !== "failed") continue;
      warn("recovery refresh failed", result.failure);
      if (result.failure.kind === "reconnect") return null;
      if (result.failure.kind === "throttled" || result.failure.kind === "transient") {
        const attempt = args.attempt ?? 0;
        if (attempt < MAX_BACKOFF_ATTEMPTS)
          await ctx.scheduler.runAfter(
            backoffMs(
              attempt,
              result.failure.kind === "throttled" ? result.failure.retryAfterMs : undefined,
            ),
            internal.actions.operatorGmailSync.recoverBindings,
            { ...args, attempt: attempt + 1 },
          );
        return null;
      }
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.actions.operatorGmailSync.recoverBindings, {
        connectionId: args.connectionId,
        cursor: page.continueCursor,
      });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Daily renewal
// ---------------------------------------------------------------------------

/**
 * Daily: renews watches that lapse within 48 hours (or were never started),
 * runs one history catch-up per connection, and restarts any follow-up check
 * whose scheduled job was lost.
 */
export const renewAll = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    if (!gmailSyncEnabled()) return null;
    await ctx.runMutation(internal.operatorGmailSync.recoverOverdueChecksInternal, {});
    if (!gmailPushTopic()) return null;
    const connections = await ctx.runQuery(internal.operatorGmailSync.activeConnectionsInternal, {});
    const renewBefore = dayjs().valueOf() + WATCH_RENEW_BEFORE_MS;
    let position = 0;
    for (const connection of connections) {
      if (connection.watchExpiresAt === undefined || connection.watchExpiresAt < renewBefore) {
        try {
          const row = await ctx.runQuery(internal.operatorGmailSync.connectionInternal, {
            connectionId: connection._id,
          });
          if (row) await startWatch(ctx, row);
        } catch (error) {
          const failure = classifySyncError(error);
          warn("watch renewal failed", failure);
          if (failure.kind === "reconnect")
            await ctx.runMutation(internal.operatorGmail.markNeedsReconnectInternal, {
              connectionId: connection._id,
              error: SYNC_NOTES.reconnect,
            });
          else
            await ctx.runMutation(internal.operatorGmailSync.recordSyncErrorInternal, {
              connectionId: connection._id,
              error: SYNC_NOTES.watchFailed,
            });
          continue;
        }
      }
      await ctx.scheduler.runAfter(
        position * CATCH_UP_STAGGER_MS,
        internal.actions.operatorGmailSync.processHistory,
        { connectionId: connection._id },
      );
      position += 1;
    }
    return null;
  },
});
