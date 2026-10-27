import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import {
  assertCanUseTenantAgent,
  requireCurrentOrgAccess as requireOrgAccess,
} from "./lib/access";
import dayjs from "dayjs";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { isOperatorEmailDraft } from "./lib/actionConfirmationFingerprint";
import { extractEmailAddress } from "./lib/emailAddress";
import { gmailAddressOf, isOperatorGmailInbox } from "./lib/operatorGmail";
import { normalizeProcurementSubject } from "./lib/procurement";
import { MAX_EMAIL_ATTACHMENTS, teamTargetProblem, bindTeamInboxThread, outboundByMessageId } from "./lib/teamEmailStore";
import {
  cancelDraftOrPendingEmail,
  invalidateDraftConfirmations,
  restoreCancelledEmailAsDraft,
  updateDraftRecipient,
} from "./lib/emailDraftService";
import { pendingEmailAttachmentValidator } from "./lib/threadMessageValidators";

export const get = query({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { orgId } = access;
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.orgId !== orgId || isOperatorEmailDraft(pending))
      return null;
    return pending;
  },
});

export const cancel = mutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { orgId } = access;
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.orgId !== orgId || isOperatorEmailDraft(pending))
      throw new Error("Not found");
    if (!(await cancelDraftOrPendingEmail(ctx, args.id))) {
      throw new Error("Email already processed");
    }
  },
});

export const restoreAsDraft = mutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { orgId } = access;
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.orgId !== orgId || isOperatorEmailDraft(pending))
      throw new Error("Not found");
    if (pending.status !== "cancelled") {
      throw new Error("Only cancelled emails can be restored");
    }

    await restoreCancelledEmailAsDraft(ctx, args.id);
  },
});

export const create = internalMutation({
  args: {
    orgId: v.optional(v.id("organizations")),
    senderUserId: v.optional(v.id("users")),
    operatorAlwaysCcEmail: v.optional(v.string()),
    transport: v.optional(v.literal("operator_inbox")),
    procurementRequestId: v.optional(v.id("procurementRequests")),
    teamEmailThreadId: v.optional(v.id("teamEmailThreads")),
    threadId: v.optional(v.id("threads")),
    operatorThreadId: v.optional(v.id("operatorAgentThreads")),
    scheduledSendTime: v.number(),
    chatMessageId: v.optional(v.id("threadMessages")),
    threadMessageId: v.optional(v.id("threadMessages")),
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    emailBody: v.string(),
    fromHeader: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    renderedText: v.optional(v.string()),
    renderedHtml: v.optional(v.string()),
    attachments: v.optional(v.array(pendingEmailAttachmentValidator)),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    explicitSendAuthorization: v.optional(
      v.object({
        actorUserId: v.id("users"),
        sourceMessageId: v.id("threadMessages"),
      }),
    ),
    sendBlockedReason: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("pending"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pendingEmails", {
      ...args,
      status: args.status ?? "pending",
    });
  },
});

export const setThreadMessage = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    threadMessageId: v.id("threadMessages"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { threadMessageId: args.threadMessageId });
  },
});

export const updateDraftInternal = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    // Operator drafts re-sign as the current operator on every revision.
    senderUserId: v.optional(v.id("users")),
    operatorAlwaysCcEmail: v.optional(v.string()),
    transport: v.optional(v.literal("operator_inbox")),
    // Links a revision may add; an existing link can only be repeated, never changed.
    orgId: v.optional(v.id("organizations")),
    procurementRequestId: v.optional(v.id("procurementRequests")),
    teamEmailThreadId: v.optional(v.id("teamEmailThreads")),
    recipientEmail: v.string(),
    ccAddresses: v.optional(v.array(v.string())),
    bccAddresses: v.optional(v.array(v.string())),
    subject: v.string(),
    emailBody: v.string(),
    fromHeader: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    renderedText: v.optional(v.string()),
    renderedHtml: v.optional(v.string()),
    attachments: v.optional(v.array(pendingEmailAttachmentValidator)),
    referencedPolicyIds: v.optional(v.array(v.id("policies"))),
    chatMessageId: v.optional(v.id("threadMessages")),
    sendBlockedReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const {
      id,
      orgId,
      procurementRequestId,
      teamEmailThreadId,
      operatorAlwaysCcEmail,
      ...patch
    } = args;
    const existing = await ctx.db.get(id);
    if (!existing || existing.status !== "draft") {
      throw new Error("Only draft emails can be updated");
    }
    // A reply is approved for one exact target and message; it is previewed again, not edited.
    if (existing.directReplyKey) {
      throw new Error("A team inbox reply cannot be edited.");
    }
    if (
      (orgId && existing.orgId && existing.orgId !== orgId) ||
      (procurementRequestId &&
        existing.procurementRequestId &&
        existing.procurementRequestId !== procurementRequestId) ||
      (teamEmailThreadId &&
        existing.teamEmailThreadId &&
        existing.teamEmailThreadId !== teamEmailThreadId)
    ) {
      throw new Error("An email draft's links cannot be changed.");
    }
    await invalidateDraftConfirmations(ctx, existing, "draft_content_changed");
    await ctx.db.patch(id, {
      ...patch,
      ...(args.senderUserId
        ? {
            senderUserId: args.senderUserId,
            transport: args.transport,
            operatorAlwaysCcEmail,
            orgId: orgId ?? existing.orgId,
            procurementRequestId:
              procurementRequestId ?? existing.procurementRequestId,
            teamEmailThreadId: teamEmailThreadId ?? existing.teamEmailThreadId,
          }
        : {}),
      ccAddresses: args.ccAddresses,
      bccAddresses: args.bccAddresses,
      fromHeader: args.fromHeader,
      replyTo: args.replyTo,
      inReplyTo: args.inReplyTo,
      references: args.references,
      renderedText: args.renderedText,
      renderedHtml: args.renderedHtml,
      attachments: args.attachments,
      referencedPolicyIds: args.referencedPolicyIds,
      status: "draft",
      scheduledSendTime: 0,
      sendBlockedReason: args.sendBlockedReason,
      // Any edit voids a browser reply's approval of the earlier content.
      directApproval: undefined,
      explicitSendAuthorization: undefined,
      coiBatchAuthorization: undefined,
    });
  },
});

export const updateDraftRecipientInternal = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    recipientEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.id);
    if (draft?.directApproval) {
      await ctx.db.patch(draft._id, { directApproval: undefined });
    }
    return await updateDraftRecipient(ctx, args.id, args.recipientEmail);
  },
});

export const scheduleDraftInternal = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    scheduledSendTime: v.number(),
    explicitSendAuthorization: v.optional(
      v.object({
        actorUserId: v.id("users"),
        sourceMessageId: v.id("threadMessages"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.status !== "draft") {
      throw new Error("Only draft emails can be scheduled");
    }
    if (isOperatorEmailDraft(pending)) {
      throw new Error("Operator drafts cannot be scheduled.");
    }

    if (pending.threadId) {
      const threadId = pending.threadId;
      const recipientEmail = pending.recipientEmail.trim().toLowerCase();
      const threadEmails = await ctx.db
        .query("pendingEmails")
        .withIndex("thread", (q) => q.eq("threadId", threadId))
        .collect();
      const supersededDrafts = threadEmails.filter(
        (candidate) =>
          candidate._id !== pending._id &&
          candidate.status === "draft" &&
          candidate.recipientEmail.trim().toLowerCase() === recipientEmail,
      );
      for (const superseded of supersededDrafts) {
        await cancelDraftOrPendingEmail(ctx, superseded._id);
      }
    }

    await ctx.db.patch(args.id, {
      status: "pending",
      scheduledSendTime: args.scheduledSendTime,
      sendBlockedReason: undefined,
      explicitSendAuthorization: args.explicitSendAuthorization,
    });
    return args.id;
  },
});

export const markSent = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    sentMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.id);
    if (pending && isOperatorEmailDraft(pending)) {
      throw new Error("Operator drafts are marked sent by the inbox transport.");
    }
    await ctx.db.patch(args.id, {
      status: "sent",
      sentMessageId: args.sentMessageId,
      explicitSendAuthorization: undefined,
    });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

export const findPendingByThread = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("pendingEmails")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return all.filter((e) => e.status === "pending");
  },
});

export const findDraftByThread = internalQuery({
  args: { threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("pendingEmails")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return (
      all
        .filter((e) => e.status === "draft")
        .sort((a, b) => b._creationTime - a._creationTime)[0] ?? null
    );
  },
});

export const findDraftByThreadAndRecipient = internalQuery({
  args: {
    threadId: v.id("threads"),
    recipientEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const recipientEmail = args.recipientEmail.trim().toLowerCase();
    const all = await ctx.db
      .query("pendingEmails")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return (
      all
        .filter(
          (e) =>
            e.status === "draft" &&
            e.recipientEmail.trim().toLowerCase() === recipientEmail,
        )
        .sort((a, b) => b._creationTime - a._creationTime)[0] ?? null
    );
  },
});

export const findDraftByOperatorThreadAndRecipient = internalQuery({
  args: {
    orgId: v.optional(v.id("organizations")),
    teamEmailThreadId: v.optional(v.id("teamEmailThreads")),
    operatorThreadId: v.id("operatorAgentThreads"),
    recipientEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const recipientEmail = args.recipientEmail.trim().toLowerCase();
    const drafts = await ctx.db
      .query("pendingEmails")
      .withIndex("operator_thread", (q) =>
        q.eq("operatorThreadId", args.operatorThreadId),
      )
      .order("desc")
      .take(100);
    return (
      drafts.find(
        (draft) =>
          draft.orgId === args.orgId &&
          draft.teamEmailThreadId === args.teamEmailThreadId &&
          draft.status === "draft" &&
          draft.recipientEmail.trim().toLowerCase() === recipientEmail,
      ) ?? null
    );
  },
});

export const findLatestCancelledByThread = internalQuery({
  args: {
    threadId: v.id("threads"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("pendingEmails")
      .withIndex("thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    return (
      all
        .filter((e) => e.orgId === args.orgId && e.status === "cancelled")
        .sort((a, b) => b._creationTime - a._creationTime)[0] ?? null
    );
  },
});

export const listDraftsInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
  },
  handler: async (ctx, args) => {
    const threadId = args.threadId;
    const rows = threadId
      ? await ctx.db
          .query("pendingEmails")
          .withIndex("thread", (q) => q.eq("threadId", threadId))
          .collect()
      : await ctx.db
          .query("pendingEmails")
          .withIndex("status", (q) => q.eq("status", "draft"))
          .collect();
    const drafts = rows
      .filter(
        (row) =>
          row.orgId === args.orgId &&
          row.status === "draft" &&
          !isOperatorEmailDraft(row),
      )
      .sort((a, b) => b._creationTime - a._creationTime);
    return drafts;
  },
});

export const cancelInternal = internalMutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.id);
    // A claimed operator send may already have left; it can no longer be cancelled.
    if (pending && isOperatorEmailDraft(pending) && pending.status === "pending") {
      throw new Error("This email is already being sent.");
    }
    // A cancelled reply keeps no approval to send.
    if (pending?.directApproval) {
      await ctx.db.patch(pending._id, { directApproval: undefined });
    }
    return await cancelDraftOrPendingEmail(ctx, args.id);
  },
});

export const restoreAsDraftInternal = internalMutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const restored = await restoreCancelledEmailAsDraft(ctx, args.id);
    return restored ? { id: args.id } : null;
  },
});

const THREAD_PREVIEW_CHARS = 200;

/** Explains a locked operator draft (unknown delivery, record being retried); null clears it. */
export const setOperatorPendingReasonInternal = internalMutation({
  args: { id: v.id("pendingEmails"), reason: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.id);
    if (
      pending &&
      isOperatorEmailDraft(pending) &&
      pending.status === "pending"
    ) {
      await ctx.db.patch(pending._id, {
        sendBlockedReason: args.reason ?? undefined,
      });
    }
    return null;
  },
});

const MERGE_MESSAGE_LIMIT = 50;
const MERGE_LINK_LIMIT = 20;
const MERGE_READ_LIMIT = 100;

/**
 * Folds a webhook-created provisional thread into the approved target when the
 * sent webhook raced ahead of the immediate mirror. Only a provably
 * provisional conversation qualifies: an unlinked `team` thread
 * whose messages and link rows all belong to this inbox's one Resend
 * conversation, with no draft pointing at it and no other thread claiming that
 * conversation. Anything else throws, which leaves the draft pending for
 * manual reconciliation instead of splitting or overwriting linkage. Messages
 * (replies included), links, reads and thread state all move together.
 */
async function mergeProvisionalThread(
  ctx: MutationCtx,
  args: {
    provisional: Doc<"teamEmailThreads">;
    intended: Doc<"teamEmailThreads">;
    ourMessage: Doc<"teamEmailMessages">;
    inboxId: string | undefined;
    senderAddress: string;
    now: number;
  },
) {
  const { provisional, intended } = args;
  const unsafe = (why: string) =>
    new Error(`Team inbox reconciliation needed: ${why}.`);
  if (
    provisional.source !== "team" ||
    provisional.deletedAt !== undefined ||
    provisional.outreachId ||
    provisional.clientOrgId ||
    provisional.requestId ||
    provisional.addressedRequestId ||
    provisional.linkedAt
  ) {
    throw unsafe("the webhook thread is linked or not provisional");
  }
  const inboxId = args.inboxId;
  const resendThreadId =
    args.ourMessage.resendThreadId ?? provisional.resendThreadId;
  if (!inboxId || !resendThreadId) throw unsafe("the inbox mapping is unknown");

  const [links, mapped, sameConversation, messages, reads, referenced] =
    await Promise.all([
      ctx.db
        .query("teamEmailThreadLinks")
        .withIndex("by_threadId", (q) => q.eq("threadId", provisional._id))
        .take(MERGE_LINK_LIMIT + 1),
      ctx.db
        .query("teamEmailThreadLinks")
        .withIndex("by_inboxId_and_resendThreadId", (q) =>
          q.eq("inboxId", inboxId).eq("resendThreadId", resendThreadId),
        )
        .take(5),
      ctx.db
        .query("teamEmailThreads")
        .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", resendThreadId))
        .take(5),
      ctx.db
        .query("teamEmailMessages")
        .withIndex("by_threadId_and_receivedAt", (q) =>
          q.eq("threadId", provisional._id),
        )
        .take(MERGE_MESSAGE_LIMIT + 1),
      ctx.db
        .query("teamInboxReads")
        .withIndex("by_threadId", (q) => q.eq("threadId", provisional._id))
        .take(MERGE_READ_LIMIT + 1),
      ctx.db
        .query("pendingEmails")
        .withIndex("by_teamEmailThreadId", (q) =>
          q.eq("teamEmailThreadId", provisional._id),
        )
        .first(),
    ]);
  if (
    links.length > MERGE_LINK_LIMIT ||
    messages.length > MERGE_MESSAGE_LIMIT ||
    reads.length > MERGE_READ_LIMIT
  ) {
    throw unsafe("the webhook thread is too large to merge safely");
  }
  if (
    links.some(
      (link) => link.inboxId !== inboxId || link.resendThreadId !== resendThreadId,
    ) ||
    messages.some(
      (message) =>
        (message.resendThreadId ?? provisional.resendThreadId) !== resendThreadId,
    ) ||
    mapped.some(
      (link) => link.threadId !== provisional._id && link.threadId !== intended._id,
    ) ||
    sameConversation.some(
      (thread) => thread._id !== provisional._id && thread._id !== intended._id,
    ) ||
    referenced
  ) {
    throw unsafe("the webhook thread mixes other conversations");
  }

  const targetOrgId = intended.clientOrgId;
  const targetRequestId = intended.requestId ?? intended.addressedRequestId;
  for (const message of messages) {
    await ctx.db.patch(message._id, {
      threadId: intended._id,
      ...(targetOrgId && !message.clientOrgId ? { clientOrgId: targetOrgId } : {}),
      ...(targetRequestId && !message.addressedRequestId
        ? { addressedRequestId: targetRequestId }
        : {}),
    });
  }
  const newest = messages.reduce((latest, message) =>
    message.receivedAt >= latest.receivedAt ? message : latest,
  );
  const newestInbound = messages
    .filter((message) => message.direction === "inbound")
    .reduce<number | undefined>(
      (latest, message) => Math.max(latest ?? 0, message.receivedAt),
      undefined,
    );
  const participants = new Set(intended.participantEmails);
  for (const message of messages) {
    for (const address of [message.fromEmail, ...message.toAddresses, ...message.ccAddresses]) {
      participants.add(address.trim().toLowerCase());
    }
  }
  participants.delete(args.senderAddress);
  const newestIsLatest = newest.receivedAt >= intended.latestMessageAt;
  await ctx.db.patch(intended._id, {
    participantEmails: [...participants],
    messageCount: intended.messageCount + messages.length,
    latestMessageAt: Math.max(intended.latestMessageAt, newest.receivedAt),
    ...(newestIsLatest
      ? {
          latestDirection: newest.direction,
          preview: newest.currentText.replace(/\s+/g, " ").trim().slice(0, 200),
          latestFromName: newest.fromName,
          latestFromEmail: newest.fromEmail,
          latestSentByUserId:
            newest.direction === "outbound" ? newest.sentByUserId : undefined,
        }
      : {}),
    ...(newestInbound
      ? {
          latestInboundAt: Math.max(intended.latestInboundAt ?? 0, newestInbound),
          archivedAt: undefined,
          archivedByUserId: undefined,
        }
      : {}),
    updatedAt: args.now,
  });
  for (const link of links) {
    await ctx.db.patch(link._id, { threadId: intended._id });
  }
  if (!mapped.length && !links.length) {
    await ctx.db.insert("teamEmailThreadLinks", {
      threadId: intended._id,
      inboxId,
      resendThreadId,
    });
  }
  for (const read of reads) await ctx.db.delete(read._id);
  await ctx.db.delete(provisional._id);
}

/**
 * Records an operator inbox send in the team inbox and marks the draft sent in
 * one transaction, so a mirror failure leaves the draft pending (never resent)
 * and a retry only finishes the record. Keyed by `resendInboxEmailId`: if the
 * `inbox.email.sent` webhook already stored the message (possibly in a
 * provisional thread of its own) it is moved into the approved target thread
 * instead of being duplicated or splitting the conversation.
 */
export const recordOperatorInboxSentInternal = internalMutation({
  args: {
    id: v.id("pendingEmails"),
    attemptId: v.id("emailDeliveryAttempts"),
    emailId: v.string(),
  },
  handler: async (ctx, args) => {
    const [pending, attempt] = await Promise.all([
      ctx.db.get(args.id),
      ctx.db.get(args.attemptId),
    ]);
    if (
      !pending ||
      pending.transport !== "operator_inbox" ||
      !pending.senderUserId ||
      !attempt ||
      attempt.pendingEmailId !== pending._id ||
      attempt.operatorStage !== "sent" ||
      attempt.resendEmailId !== args.emailId
    ) {
      throw new Error("Operator send was not recorded as delivered.");
    }
    if (pending.status === "sent" && pending.teamEmailThreadId) {
      return { teamEmailThreadId: pending.teamEmailThreadId };
    }
    if (pending.status !== "pending") {
      throw new Error("Only a claimed operator email can be recorded as sent.");
    }
    const senderUserId = pending.senderUserId;

    const now = dayjs().valueOf();
    const fromEmail = extractEmailAddress(pending.fromHeader) ?? "";
    const fromName = pending.fromHeader?.split("<")[0]?.trim() || undefined;
    const copied = [pending.recipientEmail, ...(pending.ccAddresses ?? [])].map(
      (address) => address.trim().toLowerCase(),
    );
    const preview = pending.emailBody
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, THREAD_PREVIEW_CHARS);

    // The sent files are held on the message first (the draft's own storage, which is
    // never deleted); a linked thread files them as client files right after this commit.
    const held: NonNullable<Doc<"teamEmailMessages">["unfiledAttachments"]> = (
      pending.attachments ?? []
    )
      .slice(0, MAX_EMAIL_ATTACHMENTS)
      .map((attachment) => ({
        storageId: attachment.fileId,
        name: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      }));

    const intended = pending.teamEmailThreadId
      ? await ctx.db.get(pending.teamEmailThreadId)
      : null;
    if (pending.teamEmailThreadId && (!intended || intended.deletedAt !== undefined)) {
      throw new Error("The team email thread is no longer available.");
    }
    // A connected-Gmail send's emailId is its Message-ID: the Resend Cc copy may already hold it.
    const existingMessage =
      (await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_resendInboxEmailId", (q) =>
          q.eq("resendInboxEmailId", args.emailId),
        )
        .first()) ??
      (attempt.inboxId && isOperatorGmailInbox(attempt.inboxId)
        ? await outboundByMessageId(ctx, args.emailId)
        : null);
    const provisional = existingMessage
      ? await ctx.db.get(existingMessage.threadId)
      : null;

    let threadId: Id<"teamEmailThreads">;
    if (existingMessage && provisional && intended && provisional._id !== intended._id) {
      // The webhook won the race into its own thread: the approved target is authoritative.
      await mergeProvisionalThread(ctx, {
        provisional,
        intended,
        ourMessage: existingMessage,
        inboxId: attempt.inboxId,
        senderAddress: fromEmail,
        now,
      });
      threadId = intended._id;
    } else if (existingMessage && provisional) {
      // Same thread, or no approved target: adopt the webhook's thread and fill in the links.
      threadId = provisional._id;
      const linked = Boolean(pending.orgId || pending.procurementRequestId);
      if (!provisional.clientOrgId && !provisional.requestId && linked) {
        await ctx.db.patch(provisional._id, {
          clientOrgId: pending.orgId,
          requestId: pending.procurementRequestId,
          linkedAt: now,
          linkedByUserId: senderUserId,
        });
      }
      if (!provisional.ownerUserId) {
        await ctx.db.patch(provisional._id, { ownerUserId: senderUserId });
      }
    } else if (intended) {
      threadId = intended._id;
      await ctx.db.patch(intended._id, {
        participantEmails: [
          ...new Set([...intended.participantEmails, ...copied]),
        ].filter((address) => address !== fromEmail),
        latestDirection: "outbound",
        preview,
        latestFromName: fromName,
        latestFromEmail: fromEmail,
        latestSentByUserId: senderUserId,
        latestMessageAt: now,
        messageCount: intended.messageCount + 1,
        updatedAt: now,
      });
    } else {
      const linked = Boolean(pending.orgId || pending.procurementRequestId);
      threadId = await ctx.db.insert("teamEmailThreads", {
        source: "team",
        ownerUserId: senderUserId,
        ...(linked ? { linkedAt: now, linkedByUserId: senderUserId } : {}),
        clientOrgId: pending.orgId,
        requestId: pending.procurementRequestId,
        normalizedSubject: normalizeProcurementSubject(pending.subject),
        subject: pending.subject,
        category: "other",
        categorySource: "auto",
        participantEmails: [...new Set(copied)].filter(
          (address) => address !== fromEmail,
        ),
        latestDirection: "outbound",
        preview,
        latestFromName: fromName,
        latestFromEmail: fromEmail,
        latestSentByUserId: senderUserId,
        latestMessageAt: now,
        messageCount: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    const gmailThreadId = attempt.inboxId?.startsWith("gmail:") ? (intended?.resendThreadId ?? args.emailId) : undefined;
    if(gmailThreadId && attempt.inboxId) await bindTeamInboxThread(ctx,{threadId,inboxId:attempt.inboxId,resendThreadId:gmailThreadId});
    // A connected-Gmail send is recorded under its deterministic Message-ID (the emailId), so the
    // Cc copy that returns through Resend is recognised as our own outbound and not stored twice.
    const gmailAddress =
      attempt.inboxId && isOperatorGmailInbox(attempt.inboxId)
        ? gmailAddressOf(attempt.inboxId)
        : undefined;
    if (existingMessage) {
      await ctx.db.patch(existingMessage._id, {
        sentByUserId: senderUserId,
        pendingEmailId: pending._id,
        ...(gmailAddress ? { gmailAddress } : {}),
        ...(!existingMessage.clientOrgId && pending.orgId
          ? { clientOrgId: pending.orgId }
          : {}),
        ...(!existingMessage.addressedRequestId && pending.procurementRequestId
          ? { addressedRequestId: pending.procurementRequestId }
          : {}),
        ...(!existingMessage.unfiledAttachments?.length &&
        !existingMessage.clientFileIds.length &&
        held.length
          ? { unfiledAttachments: held }
          : {}),
      });
    } else {
      await ctx.db.insert("teamEmailMessages", {
        direction: "outbound",
        sentByUserId: senderUserId,
        pendingEmailId: pending._id,
        resendInboxEmailId: args.emailId,
        ...(gmailThreadId ? { messageId: args.emailId, resendThreadId:gmailThreadId } : {}),
        ...(gmailAddress ? { messageId: args.emailId, gmailAddress } : {}),
        threadId,
        clientOrgId: pending.orgId,
        addressedRequestId: pending.procurementRequestId,
        references: [],
        subject: pending.subject,
        fromName,
        fromEmail,
        toAddresses: [pending.recipientEmail],
        ccAddresses: pending.ccAddresses ?? [],
        bccAddresses: pending.bccAddresses ?? [],
        currentText: pending.emailBody,
        bodyHtml: pending.renderedHtml,
        clientFileIds: [],
        ...(held.length ? { unfiledAttachments: held } : {}),
        receivedAt: now,
        createdAt: now,
      });
    }
    if (gmailAddress) await ctx.db.patch(threadId, { gmailAddress });
    await ctx.db.patch(pending._id, {
      status: "sent",
      sentMessageId: args.emailId,
      resendInboxEmailId: args.emailId,
      teamEmailThreadId: threadId,
      sendBlockedReason: undefined,
      explicitSendAuthorization: undefined,
    });
    // Files held by this thread's messages (this send and any merged mail) are
    // filed outside this transaction by the canonical thread filing, so a
    // filing problem can never undo or repeat the delivery record; held storage
    // stays until it is filed. A thread with no link revision gets one now.
    const target = await ctx.db.get(threadId);
    if (
      target?.clientOrgId &&
      !(await teamTargetProblem(ctx, {
        clientOrgId: target.clientOrgId,
        requestId: target.requestId,
      }))
    ) {
      const linkedAt = target.linkedAt ?? now;
      if (target.linkedAt === undefined) {
        await ctx.db.patch(target._id, { linkedAt });
      }
      await ctx.scheduler.runAfter(
        0,
        internal.procurementRequests.linkTeamEmailThreadBatchInternal,
        {
          threadId,
          linkedAt,
          clientOrgId: target.clientOrgId,
          ...(target.requestId ? { requestId: target.requestId } : {}),
          cursor: null,
        },
      );
    }
    return { teamEmailThreadId: threadId };
  },
});
