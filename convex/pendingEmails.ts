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
import {
  cancelDraftOrPendingEmail,
  invalidateDraftConfirmations,
  restoreCancelledEmailAsDraft,
  updateDraftRecipient,
} from "./lib/emailDraftService";
import { extractStoredEmailPayloadFields } from "./lib/emailPayloadFields";
import { pendingEmailAttachmentValidator } from "./lib/threadMessageValidators";

export const get = query({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const access = await requireOrgAccess(ctx);
    assertCanUseTenantAgent(access);
    const { orgId } = access;
    const pending = await ctx.db.get(args.id);
    if (!pending || pending.orgId !== orgId) return null;
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
    if (!pending || pending.orgId !== orgId) throw new Error("Not found");
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
    if (!pending || pending.orgId !== orgId) throw new Error("Not found");
    if (pending.status !== "cancelled") {
      throw new Error("Only cancelled emails can be restored");
    }

    await restoreCancelledEmailAsDraft(ctx, args.id);
  },
});

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    threadId: v.optional(v.id("threads")),
    emailPayload: v.string(),
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
    const {
      status,
      emailPayload,
      fromHeader,
      replyTo,
      inReplyTo,
      references,
      renderedText,
      renderedHtml,
      ...fields
    } = args;
    const payloadFields = extractStoredEmailPayloadFields(emailPayload);
    return await ctx.db.insert("pendingEmails", {
      ...fields,
      emailPayload,
      fromHeader: fromHeader ?? payloadFields.fromHeader,
      replyTo: replyTo ?? payloadFields.replyTo,
      inReplyTo: inReplyTo ?? payloadFields.inReplyTo,
      references: references ?? payloadFields.references,
      renderedText: renderedText ?? payloadFields.renderedText,
      renderedHtml: renderedHtml ?? payloadFields.renderedHtml,
      status: status ?? "pending",
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
    emailPayload: v.string(),
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
      emailPayload,
      fromHeader,
      replyTo,
      inReplyTo,
      references,
      renderedText,
      renderedHtml,
      ...patch
    } = args;
    const payloadFields = extractStoredEmailPayloadFields(emailPayload);
    const existing = await ctx.db.get(id);
    if (!existing || existing.status !== "draft") {
      throw new Error("Only draft emails can be updated");
    }
    await invalidateDraftConfirmations(ctx, existing, "draft_content_changed");
    await ctx.db.patch(id, {
      ...patch,
      emailPayload,
      fromHeader: fromHeader ?? payloadFields.fromHeader,
      replyTo: replyTo ?? payloadFields.replyTo,
      inReplyTo: inReplyTo ?? payloadFields.inReplyTo,
      references: references ?? payloadFields.references,
      renderedText: renderedText ?? payloadFields.renderedText,
      renderedHtml: renderedHtml ?? payloadFields.renderedHtml,
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
      .filter((row) => row.orgId === args.orgId && row.status === "draft")
      .sort((a, b) => b._creationTime - a._creationTime);
    return drafts;
  },
});

export const cancelInternal = internalMutation({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
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
