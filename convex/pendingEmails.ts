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
import { isOperatorEmailDraft } from "./lib/actionConfirmationFingerprint";
import { extractEmailAddress } from "./lib/emailAddress";
import { normalizeProcurementSubject } from "./lib/procurement";
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
    if (!pending || pending.orgId !== orgId || pending.operatorThreadId)
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
    if (!pending || pending.orgId !== orgId || pending.operatorThreadId)
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
    if (!pending || pending.orgId !== orgId || pending.operatorThreadId)
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
          !row.operatorThreadId,
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

    // Files stay referenced: client files by storage within the client, the rest as unfiled.
    const clientFileIds: Id<"clientFiles">[] = [];
    const unfiled: NonNullable<Doc<"teamEmailMessages">["unfiledAttachments"]> =
      [];
    for (const attachment of pending.attachments ?? []) {
      const file = pending.orgId
        ? (
            await ctx.db
              .query("clientFiles")
              .withIndex("storage", (q) => q.eq("fileId", attachment.fileId))
              .take(10)
          ).find((candidate) => candidate.orgId === pending.orgId)
        : undefined;
      if (file) clientFileIds.push(file._id);
      else
        unfiled.push({
          storageId: attachment.fileId,
          name: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
        });
    }

    const intended = pending.teamEmailThreadId
      ? await ctx.db.get(pending.teamEmailThreadId)
      : null;
    if (pending.teamEmailThreadId && (!intended || intended.deletedAt !== undefined)) {
      throw new Error("The team email thread is no longer available.");
    }
    const existingMessage = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_resendInboxEmailId", (q) =>
        q.eq("resendInboxEmailId", args.emailId),
      )
      .first();
    const provisional = existingMessage
      ? await ctx.db.get(existingMessage.threadId)
      : null;

    let threadId: Id<"teamEmailThreads">;
    if (existingMessage && provisional && intended && provisional._id !== intended._id) {
      // The webhook won the race into its own thread: the approved target is authoritative.
      await ctx.db.patch(existingMessage._id, { threadId: intended._id });
      await ctx.db.patch(intended._id, {
        participantEmails: [
          ...new Set([...intended.participantEmails, ...copied]),
        ].filter((address) => address !== fromEmail),
        latestDirection: "outbound",
        preview,
        latestFromName: fromName,
        latestFromEmail: fromEmail,
        latestSentByUserId: senderUserId,
        latestMessageAt: Math.max(intended.latestMessageAt, existingMessage.receivedAt),
        messageCount: intended.messageCount + 1,
        updatedAt: now,
      });
      const remaining = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_threadId_and_receivedAt", (q) =>
          q.eq("threadId", provisional._id),
        )
        .first();
      const referenced = await ctx.db
        .query("pendingEmails")
        .withIndex("by_teamEmailThreadId", (q) =>
          q.eq("teamEmailThreadId", provisional._id),
        )
        .first();
      if (!remaining && !referenced) {
        // Only a genuinely empty provisional thread is removed; its Resend
        // conversation stays reachable through the approved thread.
        const links = await ctx.db
          .query("teamEmailThreadLinks")
          .withIndex("by_threadId", (q) => q.eq("threadId", provisional._id))
          .take(20);
        for (const link of links) {
          await ctx.db.patch(link._id, { threadId: intended._id });
        }
        if (provisional.resendThreadId && attempt.inboxId) {
          const inboxId = attempt.inboxId;
          const resendThreadId = provisional.resendThreadId;
          const mapped = await ctx.db
            .query("teamEmailThreadLinks")
            .withIndex("by_inboxId_and_resendThreadId", (q) =>
              q.eq("inboxId", inboxId).eq("resendThreadId", resendThreadId),
            )
            .first();
          if (!mapped) {
            await ctx.db.insert("teamEmailThreadLinks", {
              threadId: intended._id,
              inboxId,
              resendThreadId,
            });
          }
        }
        const reads = await ctx.db
          .query("teamInboxReads")
          .withIndex("by_threadId", (q) => q.eq("threadId", provisional._id))
          .take(100);
        for (const read of reads) await ctx.db.delete(read._id);
        await ctx.db.delete(provisional._id);
      }
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

    if (existingMessage) {
      await ctx.db.patch(existingMessage._id, {
        sentByUserId: senderUserId,
        pendingEmailId: pending._id,
        ...(existingMessage.clientFileIds.length === 0 && clientFileIds.length
          ? { clientFileIds }
          : {}),
        ...(!existingMessage.unfiledAttachments?.length && unfiled.length
          ? { unfiledAttachments: unfiled }
          : {}),
      });
    } else {
      await ctx.db.insert("teamEmailMessages", {
        direction: "outbound",
        sentByUserId: senderUserId,
        pendingEmailId: pending._id,
        resendInboxEmailId: args.emailId,
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
        clientFileIds,
        ...(unfiled.length ? { unfiledAttachments: unfiled } : {}),
        receivedAt: now,
        createdAt: now,
      });
    }
    await ctx.db.patch(pending._id, {
      status: "sent",
      sentMessageId: args.emailId,
      resendInboxEmailId: args.emailId,
      teamEmailThreadId: threadId,
      sendBlockedReason: undefined,
      explicitSendAuthorization: undefined,
    });
    return { teamEmailThreadId: threadId };
  },
});
