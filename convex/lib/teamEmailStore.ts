import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { scheduleClientFileCompanyInformation } from "../companyInformation";
import { boundedClientFileHint } from "./clientFileNames";
import { createClientFileFromProcurementEmail } from "./clientFiles";
import {
  normalizeProcurementEmail,
  normalizeProcurementSubject,
  uniqueProcurementEmails,
  type ProcurementEmailCategory,
} from "./procurement";
import { messageIdForms } from "./messageId";
import type { InboxEmail } from "./providerOutreachValidators";
import { queueTeamReplySuggestion } from "./teamReplySuggestions";

type Ctx = QueryCtx | MutationCtx;
export type TeamThread = Doc<"teamEmailThreads">;
export type TeamMessage = Doc<"teamEmailMessages">;

export const MAX_EMAIL_ATTACHMENTS = 20;
/** Unlinked mail keeps its uploads until a client is linked: bound what it can hold. */
export const MAX_UNFILED_PER_THREAD = 50;
const PREVIEW_CHARS = 240;
const UNFILED_SCAN_LIMIT = 300;
export const MESSAGE_READ_BYTES = 6 * 1024 * 1024;
export type StoredUpload = {
  fileId: Id<"_storage">;
  filename: string;
  contentType: string;
  size: number;
  /** MIME Content-ID without angle brackets, for inline parts referenced as `cid:`. */
  contentId?: string;
};
export type ProcurementEmailAttachment = StoredUpload;

export function activeTeamThread(thread: TeamThread) {
  return !thread.archivedAt && !thread.deletedAt;
}

/** Outreach conversations stay with their originating request. */
export function isOutreachLocked(thread: Pick<TeamThread, "source">) {
  return thread.source === "outreach";
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
    /** Owned draft storage must survive content deduplication. */
    preserveSourceStorage?: boolean;
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
        preserveSourceStorage: args.preserveSourceStorage,
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

/** Pairs inline attachments with the client files `storeProcurementEmailAttachments` returned for them, in order. */
export function inlineClientFiles(
  attachments: { contentId?: string }[],
  clientFileIds: Id<"clientFiles">[],
) {
  const inline = attachments
    .slice(0, clientFileIds.length)
    .flatMap((file, index) =>
      file.contentId ? [{ contentId: file.contentId, clientFileId: clientFileIds[index] }] : [],
    );
  return inline.length ? inline : undefined;
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
    .paginate({ cursor: null, numItems: UNFILED_SCAN_LIMIT, maximumBytesRead: MESSAGE_READ_BYTES });
  if (!messages.isDone) return 0;
  const held = messages.page.reduce(
    (total, message) => total + (message.unfiledAttachments?.length ?? 0),
    0,
  );
  return Math.max(0, MAX_UNFILED_PER_THREAD - held);
}

// ---------------------------------------------------------------------------
// RFC Message-IDs
// ---------------------------------------------------------------------------

/** The outbound message stored under this Message-ID in any spelling, or null. */
export async function outboundByMessageId(ctx: Ctx, messageId: string) {
  for (const form of messageIdForms(messageId)) {
    const stored = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", form))
      .take(5);
    const own = stored.find((message) => message.direction === "outbound");
    if (own) return own;
  }
  return null;
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
    const own = await outboundByMessageId(ctx, email.messageId);
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
  let inlineFiles: TeamMessage["inlineFiles"];
  let unfiled: TeamMessage["unfiledAttachments"];
  let skippedNotice = "";
  if (args.attachments.length) {
    if (thread.clientOrgId) {
      clientFileIds = await storeProcurementEmailAttachments(ctx, {
        clientOrgId: thread.clientOrgId,
        attachments: args.attachments,
        subject,
      });
      inlineFiles = inlineClientFiles(args.attachments, clientFileIds);
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
            ...(file.contentId ? { contentId: file.contentId } : {}),
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
    inlineFiles,
    receivedAt: email.occurredAt,
    createdAt: now,
  });
  if (args.direction === "inbound")
    await ctx.scheduler.runAfter(0, internal.actions.teamEmailQuotes.detect, { messageId });
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
  if (args.direction === "inbound" && thread.requestId)
    await ctx.scheduler.runAfter(0, internal.procurementInformationEmail.queueEmail, {messageId});
  if (args.direction === "inbound" && newest)
    await queueTeamReplySuggestion(ctx, { threadId: thread._id, messageId });
  return { duplicate: false, threadId: thread._id, messageId, internalCopy: false };
}
