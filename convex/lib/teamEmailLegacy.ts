import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeProcurementEmail } from "./procurement";
import {
  bindTeamInboxThread,
  threadSummaryPatch,
  type TeamThread,
} from "./teamEmailStore";

/**
 * Temporary: copies the legacy `procurementEmail*` tables into the team inbox
 * tables for the migration and for live writers that meet a not-yet-copied
 * thread. Delete this module with the legacy tables once every target's
 * readback is clean. Nothing here is imported by the permanent store.
 */

type Ctx = QueryCtx | MutationCtx;
type LegacyThread = Doc<"procurementEmailThreads">;
type LegacyMessage = Doc<"procurementEmailMessages">;

/**
 * Messages copied per transaction. A message body can reach ~300 KB, and a
 * transaction reads the legacy row and writes its copy, so a page must stay far
 * under the read and write limits.
 */
export const COPY_MESSAGE_PAGE = 15;

/** Where the legacy thread's mail was sent from: the owning sequence's inbox. */
async function legacyThreadInbox(ctx: Ctx, legacy: LegacyThread) {
  if (!legacy.resendThreadId) return null;
  const sequence = await ctx.db
    .query("procurementOutreachSequences")
    .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", legacy.resendThreadId))
    .first();
  if (!sequence || sequence.requestId !== legacy.requestId) return null;
  const inbox = sequence.inboxId
    ? await ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", sequence.inboxId!))
        .first()
    : null;
  return {
    inboxId: sequence.inboxId,
    senderUserId: sequence.senderUserId,
    inboxAddress: inbox ? normalizeProcurementEmail(inbox.emailAddress) : null,
    inboxOwnerUserId: inbox?.userId,
  };
}

type LegacyInbox = Awaited<ReturnType<typeof legacyThreadInbox>>;

function legacyDirection(message: LegacyMessage, inbox: LegacyInbox) {
  return inbox?.inboxAddress &&
    normalizeProcurementEmail(message.fromEmail) === inbox.inboxAddress
    ? ("outbound" as const)
    : ("inbound" as const);
}

/**
 * Idempotent copy of one legacy thread, keyed by `by_legacyThreadId`. Timestamps,
 * counts and every other field are preserved verbatim: extraction fingerprints
 * and archive state depend on them.
 */
export async function copyLegacyThread(
  ctx: MutationCtx,
  legacy: LegacyThread,
): Promise<TeamThread> {
  const existing = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_legacyThreadId", (q) => q.eq("legacyThreadId", legacy._id))
    .first();
  const inbox = await legacyThreadInbox(ctx, legacy);
  if (existing) {
    // Copies made before inbox bindings existed gain theirs on the next touch.
    if (inbox?.inboxId && legacy.resendThreadId)
      await bindTeamInboxThread(ctx, {
        threadId: existing._id,
        inboxId: inbox.inboxId,
        resendThreadId: legacy.resendThreadId,
      });
    return existing;
  }
  const latest = await ctx.db
    .query("procurementEmailMessages")
    .withIndex("thread", (q) => q.eq("threadId", legacy._id))
    .order("desc")
    .first();
  const summary = latest
    ? threadSummaryPatch({
        direction: legacyDirection(latest, inbox),
        currentText: latest.currentText,
        fromName: latest.fromName,
        fromEmail: latest.fromEmail,
        sentByUserId: inbox?.inboxOwnerUserId ?? inbox?.senderUserId,
      })
    : {};
  const id = await ctx.db.insert("teamEmailThreads", {
    legacyThreadId: legacy._id,
    ownerUserId: inbox?.senderUserId,
    source: legacy.resendThreadId ? "outreach" : "forward",
    outreachId: legacy.outreachId,
    resendThreadId: legacy.resendThreadId,
    clientOrgId: legacy.clientOrgId,
    addressedRequestId: legacy.addressedRequestId,
    requestId: legacy.requestId,
    normalizedSubject: legacy.normalizedSubject,
    subject: legacy.subject,
    category: legacy.category,
    categorySource: legacy.categorySource,
    categoryReason: legacy.categoryReason,
    participantEmails: legacy.participantEmails,
    ...summary,
    // Migrated history counts as read: only mail that arrives after the cutover is unread.
    latestMessageAt: legacy.latestMessageAt,
    messageCount: legacy.messageCount,
    archivedAt: legacy.archivedAt,
    archivedByUserId: legacy.archivedByUserId,
    deletedAt: legacy.deletedAt,
    deletedByUserId: legacy.deletedByUserId,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  });
  if (inbox?.inboxId && legacy.resendThreadId)
    await bindTeamInboxThread(ctx, {
      threadId: id,
      inboxId: inbox.inboxId,
      resendThreadId: legacy.resendThreadId,
    });
  return (await ctx.db.get(id))!;
}

/** Idempotent copy of one legacy message into its already-copied thread. */
export async function copyLegacyMessage(
  ctx: MutationCtx,
  legacy: LegacyMessage,
  thread: TeamThread,
  legacyThread?: LegacyThread,
): Promise<Id<"teamEmailMessages">> {
  const existing = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_legacyMessageId", (q) => q.eq("legacyMessageId", legacy._id))
    .first();
  if (existing) return existing._id;
  const parent = legacyThread ?? (await ctx.db.get(legacy.threadId));
  const inbox = parent ? await legacyThreadInbox(ctx, parent) : null;
  const direction = legacyDirection(legacy, inbox);
  return await ctx.db.insert("teamEmailMessages", {
    legacyMessageId: legacy._id,
    direction,
    sentByUserId:
      direction === "outbound"
        ? (inbox?.inboxOwnerUserId ?? inbox?.senderUserId)
        : undefined,
    resendThreadId: parent?.resendThreadId,
    resendInboxEmailId: legacy.resendInboxEmailId,
    threadId: thread._id,
    clientOrgId: legacy.clientOrgId,
    addressedRequestId: legacy.addressedRequestId,
    resendEmailId: legacy.resendEmailId,
    messageId: legacy.messageId,
    inReplyTo: legacy.inReplyTo,
    references: legacy.references,
    subject: legacy.subject,
    fromName: legacy.fromName,
    fromEmail: legacy.fromEmail,
    toAddresses: legacy.toAddresses,
    ccAddresses: legacy.ccAddresses,
    bccAddresses: legacy.bccAddresses,
    currentText: legacy.currentText,
    bodyHtml: legacy.bodyHtml,
    forwarded: legacy.forwarded,
    clientFileIds: legacy.clientFileIds,
    receivedAt: legacy.receivedAt,
    createdAt: legacy.createdAt,
  });
}

/**
 * Copy-on-resolve for live writers: adopts an existing mapped team thread, or
 * copies the legacy thread and its messages (bounded) before anything new is
 * written to it. Never creates a second team thread for one legacy thread.
 * `complete` is false only when the legacy thread has more messages than fit
 * inline; the migration finishes the copy.
 */
/** Copies one bounded page of a legacy thread's messages (oldest first). */
export async function copyLegacyMessagesPage(
  ctx: MutationCtx,
  legacy: LegacyThread,
  thread: TeamThread,
  cursor: string | null,
) {
  const page = await ctx.db
    .query("procurementEmailMessages")
    .withIndex("thread", (q) => q.eq("threadId", legacy._id))
    .paginate({ cursor, numItems: COPY_MESSAGE_PAGE });
  for (const message of page.page) await copyLegacyMessage(ctx, message, thread, legacy);
  return { isDone: page.isDone, continueCursor: page.continueCursor };
}

/**
 * Copy-on-resolve for live writers: adopts an existing mapped team thread, or
 * copies the legacy thread and its first page of messages before anything new
 * is written to it. Never creates a second team thread for one legacy thread.
 * The rest of a longer thread is copied by a scheduled continuation, and
 * `complete` is false until then; a bounded read is never reported as the whole
 * thread.
 */
export async function adoptLegacyThread(
  ctx: MutationCtx,
  legacyThreadId: Id<"procurementEmailThreads">,
): Promise<{ thread: TeamThread; complete: boolean } | null> {
  const legacy = await ctx.db.get(legacyThreadId);
  if (!legacy) return null;
  const thread = await copyLegacyThread(ctx, legacy);
  const page = await copyLegacyMessagesPage(ctx, legacy, thread, null);
  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.teamInboxMigrations.copyThreadMessagesInternal, {
      legacyThreadId,
      cursor: page.continueCursor,
    });
  return { thread, complete: page.isDone };
}

/**
 * The team thread behind a sequence, adopting its legacy thread when the
 * pointer has not been repointed yet. The legacy pointer is cleared only once
 * the mapping exists.
 */
export async function teamThreadForSequence(
  ctx: MutationCtx,
  sequence: Doc<"procurementOutreachSequences">,
): Promise<TeamThread | null> {
  if (sequence.teamEmailThreadId) {
    const thread = await ctx.db.get(sequence.teamEmailThreadId);
    if (thread) return thread;
  }
  if (!sequence.procurementEmailThreadId) return null;
  const adopted = await adoptLegacyThread(ctx, sequence.procurementEmailThreadId);
  if (!adopted) return null;
  await ctx.db.patch(sequence._id, {
    teamEmailThreadId: adopted.thread._id,
    procurementEmailThreadId: undefined,
  });
  return adopted.thread;
}

/** Read-only: the already-copied team thread for a legacy id. */
export async function mappedTeamThread(
  ctx: Ctx,
  legacyThreadId: Id<"procurementEmailThreads">,
) {
  return await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_legacyThreadId", (q) => q.eq("legacyThreadId", legacyThreadId))
    .first();
}

/**
 * Read-only: the live team thread for an id of either generation (stale tool
 * arguments, bookmarks). A legacy id resolves only once it has been copied.
 */
export async function mappedTeamThreadId(
  ctx: Ctx,
  value: string,
): Promise<Id<"teamEmailThreads"> | null> {
  const current = ctx.db.normalizeId("teamEmailThreads", value);
  if (current) return current;
  const legacyId = ctx.db.normalizeId("procurementEmailThreads", value);
  return legacyId ? ((await mappedTeamThread(ctx, legacyId))?._id ?? null) : null;
}

/**
 * Like `mappedTeamThreadId`, but writes: a legacy thread that is not copied yet
 * is adopted (copied) first. Only mutations that must act on such a thread
 * should use it; previews, preflights and read tools use the read-only form.
 */
export async function adoptTeamThreadId(
  ctx: MutationCtx,
  value: string,
): Promise<Id<"teamEmailThreads"> | null> {
  const mapped = await mappedTeamThreadId(ctx, value);
  if (mapped) return mapped;
  const legacyId = ctx.db.normalizeId("procurementEmailThreads", value);
  if (!legacyId) return null;
  return (await adoptLegacyThread(ctx, legacyId))?.thread._id ?? null;
}

