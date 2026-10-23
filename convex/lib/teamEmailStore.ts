import type { PaginationOptions } from "convex/server";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { scheduleClientFileCompanyInformation } from "../companyInformation";
import { boundedClientFileHint } from "./clientFileNames";
import { createClientFileFromProcurementEmail } from "./clientFiles";
import { operatorPerson, type OperatorPerson } from "./operatorAvatar";
import { getAgentDomain } from "./resend";
import {
  normalizeProcurementEmail,
  procurementForwardingAddress,
  normalizeProcurementSubject,
  uniqueProcurementEmails,
  type ProcurementEmailCategory,
} from "./procurement";
import type { InboxEmail } from "./providerOutreachValidators";

type Ctx = QueryCtx | MutationCtx;
export type TeamThread = Doc<"teamEmailThreads">;
export type TeamMessage = Doc<"teamEmailMessages">;
type LegacyThread = Doc<"procurementEmailThreads">;
type LegacyMessage = Doc<"procurementEmailMessages">;

export const MAX_EMAIL_ATTACHMENTS = 20;
/** Unlinked mail keeps its uploads until a client is linked: bound what it can hold. */
export const MAX_UNFILED_PER_THREAD = 50;
const PREVIEW_CHARS = 240;
const UNFILED_SCAN_LIMIT = 300;
/**
 * Messages copied per transaction. A message body can reach ~300 KB, and a
 * transaction reads the legacy row and writes its copy, so a page must stay far
 * under the read and write limits.
 */
export const COPY_MESSAGE_PAGE = 15;

export type StoredUpload = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
};
export type ProcurementEmailAttachment = StoredUpload;

export function activeTeamThread(thread: TeamThread) {
  return !thread.archivedAt && !thread.deletedAt;
}

/** Outreach conversations stay with their originating request. */
export function isOutreachLocked(thread: Pick<TeamThread, "source">) {
  return thread.source === "outreach";
}

/**
 * Extraction identity is keyed by the legacy thread id when a thread was
 * migrated, so source refs and fingerprints (and the wiki facts filed under
 * them) survive the cutover without re-running extraction.
 */
export function teamThreadSourceId(thread: Pick<TeamThread, "_id" | "legacyThreadId">) {
  return String(thread.legacyThreadId ?? thread._id);
}

export function previewText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);
}

/** Denormalized list fields for a thread whose newest message is `message`. */
export function threadSummaryPatch(message: {
  direction: "inbound" | "outbound";
  currentText: string;
  fromName?: string;
  fromEmail: string;
  sentByUserId?: Id<"users">;
}) {
  return {
    latestDirection: message.direction,
    preview: previewText(message.currentText),
    latestFromName: message.fromName,
    latestFromEmail: message.fromEmail,
    latestSentByUserId:
      message.direction === "outbound" ? message.sentByUserId : undefined,
  };
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Stores uploaded email attachments as org-owned client files (reusing identical
 * content), schedules naming and company-information extraction for new files,
 * and returns the client file ids in attachment order, at most 20.
 *
 * Authorization is the caller's: resolve the request or client with the
 * company-request helpers and pass that client's id. Call
 * `insertProcurementEmailFileItems` with the resulting ids once the message row exists.
 */
export async function storeProcurementEmailAttachments(
  ctx: MutationCtx,
  args: {
    clientOrgId: Id<"organizations">;
    attachments: ProcurementEmailAttachment[];
    /** Subject of the carrying email; bounds the file-naming hint. */
    subject: string;
  },
): Promise<Id<"clientFiles">[]> {
  const storedClientFiles = await Promise.all(
    args.attachments.slice(0, MAX_EMAIL_ATTACHMENTS).map((attachment) =>
      createClientFileFromProcurementEmail(ctx, {
        orgId: args.clientOrgId,
        fileId: attachment.fileId,
        originalName: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      }),
    ),
  );
  for (const stored of storedClientFiles) {
    if (!stored.created) continue;
    await ctx.scheduler.runAfter(0, internal.actions.clientFileNaming.infer, {
      clientFileId: stored.clientFileId,
      expectedUpdatedAt: stored.expectedUpdatedAt,
      hint: boundedClientFileHint(args.subject),
    });
    await scheduleClientFileCompanyInformation(ctx, stored.clientFileId);
  }
  return storedClientFiles.map((stored) => stored.clientFileId);
}

/**
 * Lists stored email attachments as request file items tied to their source message.
 * Same caller-owned authorization as `storeProcurementEmailAttachments`;
 * `requestId` must belong to `clientOrgId`. Idempotent per (message, file).
 */
export async function insertProcurementEmailFileItems(
  ctx: MutationCtx,
  args: {
    requestId: Id<"procurementRequests">;
    clientOrgId: Id<"organizations">;
    emailMessageId: Id<"teamEmailMessages">;
    clientFileIds: Id<"clientFiles">[];
    now: number;
  },
) {
  if (!args.clientFileIds.length) return;
  const existing = await ctx.db
    .query("procurementFileItems")
    .withIndex("email", (index) => index.eq("sourceEmailMessageId", args.emailMessageId))
    .take(MAX_EMAIL_ATTACHMENTS * 2);
  const listed = new Set(
    existing
      .filter((item) => item.requestId === args.requestId)
      .map((item) => item.clientFileId),
  );
  for (const clientFileId of args.clientFileIds) {
    if (listed.has(clientFileId)) continue;
    const file = await ctx.db.get(clientFileId);
    if (!file) continue;
    await ctx.db.insert("procurementFileItems", {
      requestId: args.requestId,
      clientOrgId: args.clientOrgId,
      clientFileId,
      sourceEmailMessageId: args.emailMessageId,
      label: file.name,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
}

/**
 * How many more uploads an unlinked thread may hold. The count is the whole
 * thread's retained uploads; if the thread has more messages than one bounded
 * scan can cover, the count is unknown and there is no room (fail closed).
 */
async function unfiledUploadRoom(ctx: Ctx, threadId: Id<"teamEmailThreads">) {
  const messages = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", threadId))
    .take(UNFILED_SCAN_LIMIT + 1);
  if (messages.length > UNFILED_SCAN_LIMIT) return 0;
  const held = messages.reduce(
    (total, message) => total + (message.unfiledAttachments?.length ?? 0),
    0,
  );
  return Math.max(0, MAX_UNFILED_PER_THREAD - held);
}

// ---------------------------------------------------------------------------
// Inbox bindings and live-target validation
// ---------------------------------------------------------------------------

/**
 * Records that `inboxId` holds Resend thread `resendThreadId` as part of this
 * conversation. Every real inbox/thread association gets a link row, including
 * a conversation's first thread: the owner's id alone cannot prove which inbox
 * holds a thread once an address or domain has rotated. The thread's
 * `resendThreadId` is the primary id and is set when absent. An association
 * that already belongs to another conversation throws instead of being ignored.
 */
export async function bindTeamInboxThread(
  ctx: MutationCtx,
  args: { threadId: Id<"teamEmailThreads">; inboxId: string; resendThreadId: string },
) {
  const link = await ctx.db
    .query("teamEmailThreadLinks")
    .withIndex("by_inboxId_and_resendThreadId", (q) =>
      q.eq("inboxId", args.inboxId).eq("resendThreadId", args.resendThreadId),
    )
    .first();
  if (link && link.threadId !== args.threadId)
    throw new Error("This inbox thread already belongs to another conversation");
  const owner = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", args.resendThreadId))
    .first();
  if (owner && owner._id !== args.threadId && !owner.deletedAt)
    throw new Error("This inbox thread already belongs to another conversation");
  const thread = await ctx.db.get(args.threadId);
  if (!thread) throw new Error("Conversation not found");
  if (!thread.resendThreadId)
    await ctx.db.patch(thread._id, { resendThreadId: args.resendThreadId });
  if (!link)
    await ctx.db.insert("teamEmailThreadLinks", {
      threadId: args.threadId,
      inboxId: args.inboxId,
      resendThreadId: args.resendThreadId,
    });
}

/**
 * Why a client/request target cannot receive new mail, files or file items, or
 * null when it can: the client must be live and a client organization, and a
 * request must be live, a company request, and belong to that client.
 */
export async function teamTargetProblem(
  ctx: Ctx,
  target: { clientOrgId?: Id<"organizations">; requestId?: Id<"procurementRequests"> },
): Promise<string | null> {
  if (target.requestId && !target.clientOrgId) return "request without a client";
  if (target.clientOrgId) {
    const client = await ctx.db.get(target.clientOrgId);
    if (!client || client.deletedAt !== undefined || client.type !== "client")
      return "client is unavailable";
  }
  if (target.requestId) {
    const request = await ctx.db.get(target.requestId);
    if (!request || request.deletedAt || request.clientOrgId !== target.clientOrgId)
      return "request is unavailable";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Legacy (procurementEmail*) copy: shared by the migration and live writers
// ---------------------------------------------------------------------------

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
 * Resolves an id of either generation (stale tool arguments, bookmarks) to the
 * live team thread. Mutations copy a not-yet-mapped legacy thread; queries only
 * see mapped ones.
 */
export async function resolveTeamThreadId(
  ctx: Ctx,
  value: string,
): Promise<Id<"teamEmailThreads"> | null> {
  const current = ctx.db.normalizeId("teamEmailThreads", value);
  if (current) return current;
  const legacyId = ctx.db.normalizeId("procurementEmailThreads", value);
  if (!legacyId) return null;
  const mapped = await mappedTeamThread(ctx, legacyId);
  if (mapped) return mapped._id;
  if ("scheduler" in ctx) {
    const adopted = await adoptLegacyThread(ctx as MutationCtx, legacyId);
    return adopted?.thread._id ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generic mirror
// ---------------------------------------------------------------------------

export type NewTeamThread = {
  source: TeamThread["source"];
  ownerUserId?: Id<"users">;
  clientOrgId?: Id<"organizations">;
  requestId?: Id<"procurementRequests">;
  addressedRequestId?: Id<"procurementRequests">;
  outreachId?: Id<"procurementBrokerOutreaches">;
  resendThreadId?: string;
  category: ProcurementEmailCategory;
  categoryReason: string;
};

export type MirrorTeamEmailResult =
  | {
      duplicate: true;
      threadId: Id<"teamEmailThreads">;
      messageId: Id<"teamEmailMessages">;
      /** A copy of mail Spot itself sent (for example a CC in another inbox). */
      internalCopy: boolean;
    }
  | {
      duplicate: false;
      threadId: Id<"teamEmailThreads">;
      messageId: Id<"teamEmailMessages">;
      internalCopy: false;
    }
  /** The conversation's client or request is gone: nothing was stored and the uploads were deleted. */
  | { rejected: true; reason: string; duplicate?: never };

/**
 * Idempotent mirror of one inbox email into the team inbox. The row is keyed by
 * `resendInboxEmailId`; a repeat only deletes the extra uploads and fills in
 * identifiers a faster path could not know (the RFC Message-ID and Resend thread
 * id learned from `inbox.email.sent`). An inbound email whose RFC Message-ID is
 * already stored as Spot's own outbound message is that message's copy
 * (for example a CC delivered to another operator inbox) and is not stored
 * again; its sender address is never what suppresses it.
 *
 * `attachments` must be NEW uploads this call may consume: linked threads file
 * them as client files (and request file items when the thread has a request),
 * unlinked threads keep them as bounded `unfiledAttachments`, and anything not
 * kept, including every upload of a duplicate or rejected email, is DELETED.
 * Never pass storage that another record still owns (a pending draft's
 * attachments, for example). A conversation whose client or request is no
 * longer live is rejected before anything is stored. Uploads dropped for the
 * unlinked-thread limit are named in the stored text. With `inboxId` and
 * `resendThreadId` the inbox thread is bound to the conversation.
 */
export async function mirrorTeamEmail(
  ctx: MutationCtx,
  args: {
    target: { thread: TeamThread } | { create: NewTeamThread };
    email: InboxEmail;
    direction: "inbound" | "outbound";
    attachments: StoredUpload[];
    /** The Resend thread this email was delivered in. */
    resendThreadId?: string;
    /** The inbox that holds `resendThreadId`; binds it to the conversation. */
    inboxId?: string;
    sentByUserId?: Id<"users">;
    pendingEmailId?: Id<"pendingEmails">;
    /** Known correspondents to add to the thread's participants (for example an outreach recipient). */
    extraParticipants?: string[];
    now: number;
  },
): Promise<MirrorTeamEmailResult> {
  const { email, now } = args;
  const dropUploads = () =>
    Promise.all(args.attachments.map((file) => ctx.storage.delete(file.fileId)));

  const duplicate = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_resendInboxEmailId", (q) => q.eq("resendInboxEmailId", email.resendInboxEmailId))
    .first();
  if (duplicate) {
    await dropUploads();
    const fill: Partial<TeamMessage> = {};
    if (!duplicate.messageId && email.messageId) fill.messageId = email.messageId.slice(0, 500);
    if (!duplicate.resendThreadId && args.resendThreadId) fill.resendThreadId = args.resendThreadId;
    if (!duplicate.sentByUserId && args.sentByUserId) fill.sentByUserId = args.sentByUserId;
    if (!duplicate.pendingEmailId && args.pendingEmailId) fill.pendingEmailId = args.pendingEmailId;
    if (Object.keys(fill).length) await ctx.db.patch(duplicate._id, fill);
    if (args.inboxId && args.resendThreadId)
      await bindTeamInboxThread(ctx, {
        threadId: duplicate.threadId,
        inboxId: args.inboxId,
        resendThreadId: args.resendThreadId,
      });
    return { duplicate: true, threadId: duplicate.threadId, messageId: duplicate._id, internalCopy: false };
  }
  if (args.direction === "inbound" && email.messageId) {
    const sent = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", email.messageId!.slice(0, 500)))
      .take(5);
    const own = sent.find((message) => message.direction === "outbound");
    if (own) {
      await dropUploads();
      if (args.inboxId && args.resendThreadId)
        await bindTeamInboxThread(ctx, {
          threadId: own.threadId,
          inboxId: args.inboxId,
          resendThreadId: args.resendThreadId,
        });
      return { duplicate: true, threadId: own.threadId, messageId: own._id, internalCopy: true };
    }
  }

  const subject = email.subject.trim().slice(0, 500) || "(no subject)";
  const participants = uniqueProcurementEmails([
    ...(args.extraParticipants ?? []),
    email.fromEmail,
    ...email.toAddresses,
    ...email.ccAddresses,
  ]);
  let thread: TeamThread;
  const scoped = "thread" in args.target ? args.target.thread : args.target.create;
  if ("thread" in args.target && args.target.thread.deletedAt) {
    await dropUploads();
    return { rejected: true, reason: "conversation_deleted" };
  }
  const targetProblem = await teamTargetProblem(ctx, {
    clientOrgId: scoped.clientOrgId,
    requestId: scoped.requestId,
  });
  if (targetProblem) {
    await dropUploads();
    return { rejected: true, reason: `target_unavailable: ${targetProblem}` };
  }
  if ("thread" in args.target) {
    thread = args.target.thread;
  } else {
    const create = args.target.create;
    const id = await ctx.db.insert("teamEmailThreads", {
      source: create.source,
      ownerUserId: create.ownerUserId,
      outreachId: create.outreachId,
      resendThreadId: create.resendThreadId ?? args.resendThreadId,
      clientOrgId: create.clientOrgId,
      addressedRequestId: create.addressedRequestId,
      requestId: create.requestId,
      normalizedSubject: normalizeProcurementSubject(subject),
      subject,
      category: create.category,
      categorySource: "auto",
      categoryReason: create.categoryReason,
      participantEmails: participants,
      latestMessageAt: 0,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    thread = (await ctx.db.get(id))!;
  }

  let clientFileIds: Id<"clientFiles">[] = [];
  let unfiled: TeamMessage["unfiledAttachments"];
  let skippedNotice = "";
  if (args.attachments.length) {
    if (thread.clientOrgId) {
      clientFileIds = await storeProcurementEmailAttachments(ctx, {
        clientOrgId: thread.clientOrgId,
        attachments: args.attachments,
        subject,
      });
    } else {
      const room = await unfiledUploadRoom(ctx, thread._id);
      const kept = args.attachments.slice(0, Math.min(room, MAX_EMAIL_ATTACHMENTS));
      const skipped = args.attachments.slice(kept.length);
      await Promise.all(skipped.map((file) => ctx.storage.delete(file.fileId)));
      if (skipped.length)
        skippedNotice = `\n\n[${skipped.length} attachment${skipped.length === 1 ? "" : "s"} not kept because this unlinked conversation is at its attachment limit: ${skipped
          .slice(0, 10)
          .map((file) => file.filename.replace(/\s+/g, " ").slice(0, 100))
          .join("; ")}.]`;
      unfiled = kept.length
        ? kept.map((file) => ({
            storageId: file.fileId,
            name: file.filename,
            contentType: file.contentType,
            size: file.size,
          }))
        : undefined;
    }
  }

  const messageId = await ctx.db.insert("teamEmailMessages", {
    direction: args.direction,
    sentByUserId: args.sentByUserId,
    pendingEmailId: args.pendingEmailId,
    resendThreadId: args.resendThreadId,
    unfiledAttachments: unfiled,
    resendInboxEmailId: email.resendInboxEmailId,
    threadId: thread._id,
    clientOrgId: thread.clientOrgId,
    addressedRequestId: thread.addressedRequestId,
    messageId: email.messageId?.slice(0, 500),
    inReplyTo: email.inReplyTo?.slice(0, 500),
    references: email.references.map((value) => value.slice(0, 500)).slice(0, 50),
    subject,
    fromName: email.fromName?.slice(0, 300),
    fromEmail: normalizeProcurementEmail(email.fromEmail),
    toAddresses: uniqueProcurementEmails(email.toAddresses),
    ccAddresses: uniqueProcurementEmails(email.ccAddresses),
    bccAddresses: uniqueProcurementEmails(email.bccAddresses),
    currentText: `${email.text.slice(0, 120_000 - skippedNotice.length)}${skippedNotice}`,
    forwarded: email.forwarded,
    bodyHtml: email.html?.slice(0, 180_000),
    clientFileIds,
    receivedAt: email.occurredAt,
    createdAt: now,
  });
  if (thread.clientOrgId && thread.requestId)
    await insertProcurementEmailFileItems(ctx, {
      requestId: thread.requestId,
      clientOrgId: thread.clientOrgId,
      emailMessageId: messageId,
      clientFileIds,
      now,
    });

  const newest = email.occurredAt >= thread.latestMessageAt;
  await ctx.db.patch(thread._id, {
    participantEmails: uniqueProcurementEmails([...thread.participantEmails, ...participants]),
    latestMessageAt: Math.max(thread.latestMessageAt, email.occurredAt),
    messageCount: thread.messageCount + 1,
    ...(args.resendThreadId && !thread.resendThreadId
      ? { resendThreadId: args.resendThreadId }
      : {}),
    ...(newest
      ? threadSummaryPatch({
          direction: args.direction,
          currentText: email.text,
          fromName: email.fromName,
          fromEmail: normalizeProcurementEmail(email.fromEmail),
          sentByUserId: args.sentByUserId,
        })
      : {}),
    ...(args.direction === "inbound"
      ? {
          latestInboundAt: Math.max(thread.latestInboundAt ?? 0, email.occurredAt),
          archivedAt: undefined,
          archivedByUserId: undefined,
        }
      : {}),
    updatedAt: now,
  });
  if (args.inboxId && args.resendThreadId)
    await bindTeamInboxThread(ctx, {
      threadId: thread._id,
      inboxId: args.inboxId,
      resendThreadId: args.resendThreadId,
    });
  return { duplicate: false, threadId: thread._id, messageId, internalCopy: false };
}

// ---------------------------------------------------------------------------
// Inbox projection: one reader for the team inbox and the request Inbox
// ---------------------------------------------------------------------------

export const INBOX_PAGE_LIMIT = 40;

function requestForwardingAddressOf(request: Doc<"procurementRequests">) {
  return request.inboxToken
    ? procurementForwardingAddress(request.inboxToken, getAgentDomain())
    : null;
}
const MAX_THREAD_MESSAGES = 300;
const UNREAD_SCAN_LIMIT = 100;

type InboxFilters = {
  mine?: boolean;
  unlinked?: boolean;
  clientOrgId?: Id<"organizations">;
  requestId?: Id<"procurementRequests">;
  category?: ProcurementEmailCategory;
  archived?: boolean;
};

async function personFor(
  ctx: Ctx,
  cache: Map<Id<"users">, OperatorPerson>,
  userId: Id<"users"> | undefined,
) {
  if (!userId) return null;
  const known = cache.get(userId);
  if (known) return known;
  const person = await operatorPerson(ctx, userId);
  cache.set(userId, person);
  return person;
}

async function threadSequence(ctx: Ctx, thread: TeamThread) {
  if (thread.source !== "outreach" || !thread.resendThreadId) return null;
  const candidate = await ctx.db
    .query("procurementOutreachSequences")
    .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", thread.resendThreadId))
    .order("desc")
    .first();
  if (!candidate || candidate.requestId !== thread.requestId) return null;
  const pointsHere =
    candidate.teamEmailThreadId === thread._id ||
    (thread.legacyThreadId !== undefined &&
      candidate.procurementEmailThreadId === thread.legacyThreadId);
  return pointsHere ? candidate : null;
}

async function readAtFor(ctx: Ctx, userId: Id<"users">, threadId: Id<"teamEmailThreads">) {
  const read = await ctx.db
    .query("teamInboxReads")
    .withIndex("by_userId_and_threadId", (q) => q.eq("userId", userId).eq("threadId", threadId))
    .first();
  return read?.readAt ?? null;
}

function isUnread(thread: TeamThread, readAt: number | null) {
  return (
    thread.latestInboundAt !== undefined &&
    (readAt === null || readAt < thread.latestInboundAt)
  );
}

async function linkSuggestionFor(ctx: Ctx, thread: TeamThread) {
  const suggestion = thread.linkSuggestion;
  if (!suggestion || thread.clientOrgId) return null;
  const request = await ctx.db.get(suggestion.requestId);
  if (!request || request.deletedAt || request.clientOrgId !== suggestion.clientOrgId)
    return null;
  return { ...suggestion, requestTitle: request.title };
}

/** Same rule as `teamTargetProblem`, over documents the caller already read. */
function targetIsLive(
  thread: Pick<TeamThread, "clientOrgId" | "requestId">,
  client: Doc<"organizations"> | null,
  request: Doc<"procurementRequests"> | null,
) {
  if (thread.clientOrgId && (!client || client.deletedAt !== undefined || client.type !== "client"))
    return false;
  return !(
    thread.requestId &&
    (!request || request.deletedAt || request.clientOrgId !== thread.clientOrgId)
  );
}

export async function teamInboxRow(
  ctx: Ctx,
  thread: TeamThread,
  viewerUserId: Id<"users">,
  people: Map<Id<"users">, OperatorPerson>,
) {
  const [sequence, client, request, readAt, owner, sentBy, linkSuggestion] = await Promise.all([
    threadSequence(ctx, thread),
    thread.clientOrgId ? ctx.db.get(thread.clientOrgId) : null,
    thread.requestId ? ctx.db.get(thread.requestId) : null,
    readAtFor(ctx, viewerUserId, thread._id),
    personFor(ctx, people, thread.ownerUserId),
    personFor(ctx, people, thread.latestSentByUserId),
    linkSuggestionFor(ctx, thread),
  ]);
  // A conversation whose client or request is gone is hidden, with its stored
  // linkage left as it is; no deleted target's name is ever returned.
  if (!targetIsLive(thread, client, request)) return null;
  const latestDirection = thread.latestDirection ?? ("unknown" as const);
  let counterpart: string | null = null;
  if (latestDirection === "outbound") {
    if (sequence) {
      counterpart = `To ${sequence.recipient.name ?? sequence.recipient.email}`;
    } else {
      const latest = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
        .order("desc")
        .first();
      const recipient = latest?.toAddresses[0];
      counterpart = recipient ? `To ${recipient}` : null;
    }
  }
  const sequenceNeedsReply =
    sequence !== null &&
    ["responded", "stopped", "failed"].includes(sequence.status) &&
    sequence.stopReason !== "bounced";
  return {
    _id: thread._id,
    subject: thread.subject,
    category: thread.category,
    participantEmails: thread.participantEmails,
    latestMessageAt: thread.latestMessageAt,
    messageCount: thread.messageCount,
    source: thread.source,
    latestDirection,
    needsReply:
      latestDirection === "inbound" &&
      (sequence ? sequenceNeedsReply : thread.source === "team" && !thread.archivedAt),
    sequenceStatus: sequence?.status ?? null,
    preview: thread.preview ?? "",
    fromName: thread.latestFromName ?? null,
    fromEmail: thread.latestFromEmail ?? null,
    counterpart,
    archivedAt: thread.archivedAt ?? null,
    unread: isUnread(thread, readAt),
    owner,
    sentBy,
    client: client ? { _id: client._id, name: client.name } : null,
    request: request ? { _id: request._id, title: request.title } : null,
    linkSuggestion,
  };
}

/**
 * One bounded, index-backed page of team threads. The primary scope is chosen
 * from the filters (request, client, mine, category, unlinked, then all) so
 * every page is read in index order; any further filter is applied to that
 * page and its effect is reported (`hiddenCount`, `partial`) instead of being
 * ignored. Contradictory filters throw. Callers authorize the viewer and, for a
 * request scope, the request.
 */
export async function listTeamInbox(
  ctx: QueryCtx,
  args: InboxFilters & {
    viewerUserId: Id<"users">;
    paginationOpts: PaginationOptions;
  },
) {
  const { viewerUserId, mine, unlinked, category, requestId } = args;
  const archived = args.archived === true;
  let clientOrgId = args.clientOrgId;
  if (unlinked && (clientOrgId || requestId))
    throw new Error("Unlinked cannot be combined with a client or request");
  if (requestId) {
    const request = await ctx.db.get(requestId);
    if (!request) throw new Error("Procurement request not found");
    if (clientOrgId && request.clientOrgId !== clientOrgId)
      throw new Error("Request does not belong to that client");
    clientOrgId = request.clientOrgId;
  }
  const opts = {
    ...args.paginationOpts,
    numItems: Math.max(1, Math.min(INBOX_PAGE_LIMIT, args.paginationOpts.numItems)),
  };
  const table = () => ctx.db.query("teamEmailThreads");
  const result = requestId
    ? await table()
        .withIndex("by_requestId_and_archivedAt_and_latestMessageAt", (q) =>
          archived
            ? q.eq("requestId", requestId).gt("archivedAt", 0)
            : q.eq("requestId", requestId).eq("archivedAt", undefined),
        )
        .order("desc")
        .paginate(opts)
    : clientOrgId
      ? await table()
          .withIndex("by_clientOrgId_and_archivedAt_and_latestMessageAt", (q) =>
            archived
              ? q.eq("clientOrgId", clientOrgId).gt("archivedAt", 0)
              : q.eq("clientOrgId", clientOrgId).eq("archivedAt", undefined),
          )
          .order("desc")
          .paginate(opts)
      : mine
        ? await table()
            .withIndex("by_ownerUserId_and_archivedAt_and_latestMessageAt", (q) =>
              archived
                ? q.eq("ownerUserId", viewerUserId).gt("archivedAt", 0)
                : q.eq("ownerUserId", viewerUserId).eq("archivedAt", undefined),
            )
            .order("desc")
            .paginate(opts)
        : category
          ? await table()
              .withIndex("by_category_and_archivedAt_and_latestMessageAt", (q) =>
                archived
                  ? q.eq("category", category).gt("archivedAt", 0)
                  : q.eq("category", category).eq("archivedAt", undefined),
              )
              .order("desc")
              .paginate(opts)
          : unlinked
            ? await table()
                .withIndex("by_clientOrgId_and_archivedAt_and_latestMessageAt", (q) =>
                  archived
                    ? q.eq("clientOrgId", undefined).gt("archivedAt", 0)
                    : q.eq("clientOrgId", undefined).eq("archivedAt", undefined),
                )
                .order("desc")
                .paginate(opts)
            : await table()
                .withIndex("by_archivedAt_and_latestMessageAt", (q) =>
                  archived ? q.gt("archivedAt", 0) : q.eq("archivedAt", undefined),
                )
                .order("desc")
                .paginate(opts);
  const visible = result.page.filter(
    (thread) =>
      !thread.deletedAt &&
      Boolean(thread.archivedAt) === archived &&
      (!mine || thread.ownerUserId === viewerUserId) &&
      (!unlinked || !thread.clientOrgId) &&
      (!clientOrgId || thread.clientOrgId === clientOrgId) &&
      (!requestId || thread.requestId === requestId) &&
      (!category || thread.category === category),
  );
  const people = new Map<Id<"users">, OperatorPerson>();
  const rows = await Promise.all(
    visible.map((thread) => teamInboxRow(ctx, thread, viewerUserId, people)),
  );
  const page = rows.filter((row): row is NonNullable<typeof row> => row !== null);
  return {
    ...result,
    page,
    scanned: result.page.length,
    hiddenCount: result.page.length - page.length,
    partial: result.page.length !== page.length,
    /** Archived pages are in archive-time order (then recency); active pages are by latest message. */
    order: archived ? ("archivedAt" as const) : ("latestMessageAt" as const),
  };
}

const SUGGESTION_LIMIT = 20;

/**
 * Unlinked conversations whose stored link suggestion points at `requestId`
 * (the request's "Suggested" strip), newest first, as inbox rows. Suggestions
 * are only stored, never inferred here. Excluded: deleted or archived
 * conversations, ones already linked to a client, a suggestion naming another
 * client than the request's, and any whose client or request is no longer live.
 * `limited` says more candidates exist than the bounded read returned.
 */
export async function listSuggestedTeamThreads(
  ctx: QueryCtx,
  args: { viewerUserId: Id<"users">; requestId: Id<"procurementRequests"> },
) {
  const request = await ctx.db.get(args.requestId);
  if (!request || request.deletedAt || !request.clientOrgId || (await teamTargetProblem(ctx, request)))
    return { threads: [], limited: false };
  const clientOrgId = request.clientOrgId;
  const candidates = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_suggestedRequestId_and_latestMessageAt", (q) =>
      q.eq("linkSuggestion.requestId", args.requestId),
    )
    .order("desc")
    .take(SUGGESTION_LIMIT + 1);
  const eligible = candidates
    .slice(0, SUGGESTION_LIMIT)
    .filter(
      (thread) =>
        !thread.deletedAt &&
        !thread.archivedAt &&
        !thread.clientOrgId &&
        thread.linkSuggestion?.clientOrgId === clientOrgId,
    );
  const people = new Map<Id<"users">, OperatorPerson>();
  const rows = await Promise.all(
    eligible.map((thread) => teamInboxRow(ctx, thread, args.viewerUserId, people)),
  );
  return {
    threads: rows.filter((row): row is NonNullable<typeof row> => row !== null),
    limited: candidates.length > SUGGESTION_LIMIT,
  };
}

/**
 * Newest-first count of team mail the viewer has not read. Shared inbox: every
 * operator sees all threads, and the operator's own sends never count because
 * only inbound mail sets `latestInboundAt`. The scan is bounded, so a full scan
 * reports `limited` and the count is a lower bound.
 */
export async function teamInboxUnreadCount(ctx: QueryCtx, viewerUserId: Id<"users">) {
  const threads = await ctx.db
    .query("teamEmailThreads")
    .withIndex("by_archivedAt_and_latestInboundAt", (q) =>
      q.eq("archivedAt", undefined).gt("latestInboundAt", 0),
    )
    .order("desc")
    .take(UNREAD_SCAN_LIMIT + 1);
  // Same visibility as the list: a conversation whose client or request is gone is not counted.
  const live = await Promise.all(
    threads.slice(0, UNREAD_SCAN_LIMIT).map(async (thread) =>
      !thread.deletedAt && (await teamTargetProblem(ctx, thread)) === null ? thread : null,
    ),
  );
  const scanned = live.filter((thread): thread is TeamThread => thread !== null);
  const reads = await Promise.all(
    scanned.map((thread) => readAtFor(ctx, viewerUserId, thread._id)),
  );
  return {
    count: scanned.filter((thread, index) => isUnread(thread, reads[index]!)).length,
    limited: threads.length > UNREAD_SCAN_LIMIT,
  };
}

const DRAFT_LIMIT = 20;

/**
 * Drafts being written and sends waiting to go for one conversation, newest
 * first. Indexed by status, so sent and cancelled history can never push a new
 * draft out of view; `limited` says more exist than the cap returns.
 */
async function threadDraftsInProgress(ctx: Ctx, threadId: Id<"teamEmailThreads">) {
  const [drafting, pending] = await Promise.all(
    (["draft", "pending"] as const).map((status) =>
      ctx.db
        .query("pendingEmails")
        .withIndex("by_teamEmailThreadId_and_status", (q) =>
          q.eq("teamEmailThreadId", threadId).eq("status", status),
        )
        .order("desc")
        .take(DRAFT_LIMIT + 1),
    ),
  );
  const all = [...drafting, ...pending].sort((a, b) => b._creationTime - a._creationTime);
  return { rows: all.slice(0, DRAFT_LIMIT), limited: all.length > DRAFT_LIMIT };
}

/** The thread's detail for an authorized viewer; null when missing, deleted or outside the request. */
export async function getTeamThreadDetails(
  ctx: QueryCtx,
  args: {
    threadId: Id<"teamEmailThreads">;
    requestId?: Id<"procurementRequests">;
    viewerUserId?: Id<"users">;
    /** Open an archived conversation inside a request scope (the archive view). */
    includeArchived?: boolean;
  },
) {
  const thread = await ctx.db.get(args.threadId);
  if (
    !thread ||
    thread.deletedAt ||
    (args.requestId &&
      (thread.requestId !== args.requestId || (thread.archivedAt && !args.includeArchived)))
  )
    return null;
  const people = new Map<Id<"users">, OperatorPerson>();
  const [request, addressedRequest, client, messages, sequence, readAt, owner, drafts, linkSuggestion] =
    await Promise.all([
      thread.requestId ? ctx.db.get(thread.requestId) : null,
      thread.addressedRequestId ? ctx.db.get(thread.addressedRequestId) : null,
      thread.clientOrgId ? ctx.db.get(thread.clientOrgId) : null,
      // Newest first, so a long thread keeps its latest history.
      ctx.db
        .query("teamEmailMessages")
        .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
        .order("desc")
        .take(MAX_THREAD_MESSAGES + 1),
      threadSequence(ctx, thread),
      args.viewerUserId ? readAtFor(ctx, args.viewerUserId, thread._id) : null,
      personFor(ctx, people, thread.ownerUserId),
      threadDraftsInProgress(ctx, thread._id),
      linkSuggestionFor(ctx, thread),
    ]);
  // A deleted client or request hides the conversation (its stored linkage is kept)
  // and no deleted target's metadata is returned.
  if (!targetIsLive(thread, client, request)) return null;
  const outreachInbox = sequence?.inboxId
    ? await ctx.db
        .query("operatorOutreachInboxes")
        .withIndex("by_inboxId", (q) => q.eq("inboxId", sequence.inboxId!))
        .first()
    : null;
  const pendingSteps = sequence
    ? (
        await ctx.db
          .query("procurementOutreachSteps")
          .withIndex("by_sequenceId_and_index", (q) => q.eq("sequenceId", sequence._id))
          .take(10)
      ).filter((step) => step.status === "scheduled" || step.status === "sending")
    : [];
  const truncated = messages.length > MAX_THREAD_MESSAGES;
  // Retain the newest 300 and present them oldest to newest.
  const hydrated = await Promise.all(
    messages.slice(0, MAX_THREAD_MESSAGES).reverse().map(async ({ bodyHtml: _bodyHtml, ...message }) => ({
      ...message,
      sentBy: await personFor(ctx, people, message.sentByUserId),
      files: await Promise.all(
        message.clientFileIds.map(async (clientFileId) => {
          const file = await ctx.db.get(clientFileId);
          return file && !file.archivedAt && !file.deletedAt
            ? {
                clientFileId,
                name: file.name,
                contentType: file.contentType,
                size: file.size,
                url: await ctx.storage.getUrl(file.fileId),
              }
            : null;
        }),
      ),
      unfiledFiles: await Promise.all(
        (message.unfiledAttachments ?? []).map(async (file) => ({
          storageId: file.storageId,
          name: file.name,
          contentType: file.contentType,
          size: file.size,
          url: await ctx.storage.getUrl(file.storageId),
        })),
      ),
    })),
  );
  const draftsInProgress = await Promise.all(
    drafts.rows.map(async (draft) => ({
      _id: draft._id,
      subject: draft.subject,
      status: draft.status as "draft" | "pending",
      updatedAt: draft._creationTime,
      sender: await personFor(ctx, people, draft.senderUserId),
    })),
  );
  const liveAddressed =
    addressedRequest && !addressedRequest.deletedAt && addressedRequest.clientOrgId === thread.clientOrgId
      ? addressedRequest
      : null;
  const forwardingAddress = liveAddressed ? requestForwardingAddressOf(liveAddressed) : null;
  return {
    thread,
    request: request ? { requestId: request._id, title: request.title } : null,
    addressedRequest: liveAddressed
      ? { requestId: liveAddressed._id, title: liveAddressed.title, forwardingAddress }
      : null,
    client: client ? { _id: client._id, name: client.name } : null,
    messages: hydrated,
    messagesTruncated: truncated,
    outboundAddress: outreachInbox ? normalizeProcurementEmail(outreachInbox.emailAddress) : null,
    canReply: Boolean(outreachInbox && sequence),
    followUps: sequence
      ? {
          sequenceId: sequence._id,
          audience: sequence.audience ?? ("provider" as const),
          status: sequence.status,
          stopReason: sequence.stopReason ?? null,
          recipient: sequence.recipient.name ?? sequence.recipient.email,
          remaining: pendingSteps.length,
          nextDueAt: pendingSteps[0]?.dueAt ?? null,
        }
      : null,
    owner,
    readAt,
    linkSuggestion,
    draftsInProgress,
    draftsLimited: drafts.limited,
  };
}
