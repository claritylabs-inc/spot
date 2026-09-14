import dayjs from "dayjs";
import { OPERATOR_EMAIL_DOMAIN } from "./lib/operatorEmailAddress";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  createOrGetChannelThread,
  enqueueOperatorMessage,
} from "./operatorAgent";
import { resolveActiveOperatorEmail } from "./lib/operatorIdentity";

export const resolveIdentity = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const operator = await resolveActiveOperatorEmail(ctx, email);
    return operator ? { operatorUserId: operator.userId } : null;
  },
});

export const accept = internalMutation({
  args: {
    providerId: v.string(),
    messageId: v.string(),
    sender: v.string(),
    subject: v.string(),
    content: v.string(),
    threadToken: v.optional(v.string()),
    attachments: v.array(
      v.object({
        fileId: v.id("_storage"),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const operator = await resolveActiveOperatorEmail(ctx, args.sender);
    if (!operator) throw new Error("Operator email sender is not authorized");
    const existing =
      (await ctx.db
        .query("operatorEmailReceipts")
        .withIndex("provider", (q) => q.eq("providerId", args.providerId))
        .unique()) ??
      (await ctx.db
        .query("operatorEmailReceipts")
        .withIndex("sender_message", (q) =>
          q
            .eq("operatorUserId", operator.userId)
            .eq("messageId", args.messageId),
        )
        .unique());
    if (existing) return { duplicate: true, receiptId: existing._id };
    let threadId;
    if (args.threadToken) {
      const id = ctx.db.normalizeId("operatorAgentThreads", args.threadToken);
      const thread = id ? await ctx.db.get(id) : null;
      if (
        !thread ||
        thread.channel !== "email" ||
        thread.ownerUserId !== operator.userId ||
        thread.visibility !== "private"
      ) {
        throw new Error("Operator email thread is not available");
      }
      threadId = thread._id;
    } else {
      const thread = await createOrGetChannelThread(ctx, {
        operatorUserId: operator.userId,
        channel: "email",
        conversationKey: args.messageId,
        title: args.subject,
      });
      threadId = thread.threadId;
    }
    const queued = await enqueueOperatorMessage(ctx, {
      operatorUserId: operator.userId,
      threadId,
      channel: "email",
      content: args.content,
      dedupeKey: `operator-email:${args.providerId}`,
      attachments: args.attachments,
    });
    const receiptId = await ctx.db.insert("operatorEmailReceipts", {
      providerId: args.providerId,
      messageId: args.messageId,
      operatorUserId: operator.userId,
      sender: args.sender,
      subject: args.subject,
      threadId,
      runId: queued.runId,
      createdAt: dayjs().valueOf(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.handleInboundOperatorEmail.deliver,
      { receiptId },
    );
    return { duplicate: false, receiptId };
  },
});

export const getDeliveryContext = internalQuery({
  args: { receiptId: v.id("operatorEmailReceipts") },
  handler: async (ctx, { receiptId }) => {
    const receipt = await ctx.db.get(receiptId);
    if (!receipt) return null;
    const operator = await resolveActiveOperatorEmail(ctx, receipt.sender);
    if (operator?.userId !== receipt.operatorUserId) return null;
    const thread = await ctx.db.get(receipt.threadId);
    if (
      thread?.ownerUserId !== operator.userId ||
      thread.visibility !== "private"
    )
      return null;
    const run = await ctx.db.get(receipt.runId);
    if (
      !run ||
      run.operatorUserId !== operator.userId ||
      run.threadId !== receipt.threadId
    )
      return null;
    const response = await ctx.db.get(run.agentMessageId);
    const pending = run.checkpoint?.pendingConfirmationId
      ? await ctx.db.get(run.checkpoint.pendingConfirmationId)
      : null;
    const confirmation =
      pending?.status === "pending" &&
      pending.payload.runId === run._id &&
      pending.threadId === receipt.threadId &&
      pending.operatorUserId === operator.userId
        ? pending
        : null;
    return { receipt, run, response, confirmation };
  },
});

export const claimDelivery = internalMutation({
  args: {
    receiptId: v.id("operatorEmailReceipts"),
    phase: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const now = dayjs().valueOf();
    const existing = await ctx.db
      .query("operatorEmailDeliveries")
      .withIndex("receipt_phase", (q) =>
        q.eq("receiptId", args.receiptId).eq("phase", args.phase),
      )
      .unique();
    if (
      existing?.status === "sending" &&
      existing.attempts >= 3 &&
      existing.leaseUntil <= now
    ) {
      await ctx.db.patch(existing._id, { status: "failed" });
    }
    if (
      existing &&
      (existing.status === "sent" ||
        existing.attempts >= 3 ||
        (existing.status === "sending" && existing.leaseUntil > now))
    )
      return null;
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt) return null;
    const operator = await resolveActiveOperatorEmail(ctx, receipt.sender);
    if (operator?.userId !== receipt.operatorUserId) return null;
    const attempts = (existing?.attempts ?? 0) + 1;
    const leaseUntil = now + 120_000;
    const messageId =
      existing?.messageId ?? `<operator-${crypto.randomUUID()}@${OPERATOR_EMAIL_DOMAIN}>`;
    const id =
      existing?._id ??
      (await ctx.db.insert("operatorEmailDeliveries", {
        ...args,
        messageId,
        attempts,
        leaseUntil,
        status: "sending",
        createdAt: now,
      }));
    if (existing)
      await ctx.db.patch(id, { status: "sending", attempts, leaseUntil });
    // Recover a lost action with the same provider idempotency key and payload.
    await ctx.scheduler.runAfter(
      120_000,
      internal.actions.handleInboundOperatorEmail.deliver,
      { receiptId: args.receiptId },
    );
    return { id, messageId, attempts, text: existing?.text ?? args.text };
  },
});

export const finishDelivery = internalMutation({
  args: {
    deliveryId: v.id("operatorEmailDeliveries"),
    attempts: v.number(),
    sent: v.boolean(),
  },
  handler: async (ctx, { deliveryId, attempts, sent }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (
      !delivery ||
      delivery.attempts !== attempts ||
      delivery.status === "sent"
    )
      return;
    await ctx.db.patch(deliveryId, {
      status: sent ? "sent" : "failed",
      ...(sent ? { sentAt: dayjs().valueOf() } : {}),
    });
  },
});
