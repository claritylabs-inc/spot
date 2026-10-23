import dayjs from "dayjs";
import { operatorEmailContentValidator } from "./lib/threadMessageValidators";
import { OPERATOR_EMAIL_DOMAIN } from "./lib/operatorEmailAddress";
import { v, type Infer } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  createOrGetChannelThread,
  enqueueOperatorMessage,
} from "./operatorAgent";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  normalizeOperatorEmail,
  resolveActiveOperatorEmail,
} from "./lib/operatorIdentity";

type Operator = NonNullable<
  Awaited<ReturnType<typeof resolveActiveOperatorEmail>>
>;

const attachmentsValidator = v.array(
  v.object({
    fileId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
  }),
);

/** The exact ids of a received inbox message routed to the command channel. */
const inboxCommandValidator = v.object({
  inboxId: v.string(),
  resendThreadId: v.string(),
  emailId: v.string(),
});

/**
 * The recorded shared command inbox for `inboxId`. Only `kind: "agent"` rows
 * with no owner qualify, so an unknown inbox or any operator's own inbox is
 * never a command channel. Retired rows still resolve so replies in old
 * threads keep working; callers decide what a retired inbox may start.
 */
async function commandInboxRow(ctx: QueryCtx | MutationCtx, inboxId: string) {
  const rows = await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_inboxId", (q) => q.eq("inboxId", inboxId))
    .take(2);
  const row = rows.length === 1 ? rows[0] : null;
  return row && row.kind === "agent" && row.userId === undefined ? row : null;
}

function commandInboxView(row: Doc<"operatorOutreachInboxes">) {
  return {
    inboxId: row.inboxId,
    emailAddress: row.emailAddress.toLowerCase(),
    retired: (row.status ?? "active") === "retired",
  };
}

/** `operatorAgentThreads` mapped to a Resend thread, or `"ambiguous"`. */
async function threadForResendThread(
  ctx: QueryCtx | MutationCtx,
  resendThreadId: string,
) {
  const threads = await ctx.db
    .query("operatorAgentThreads")
    .withIndex("by_resendThreadId", (q) => q.eq("resendThreadId", resendThreadId))
    .take(2);
  return threads.length > 1 ? "ambiguous" : (threads[0] ?? null);
}

async function findReceipt(
  ctx: MutationCtx,
  operator: Operator,
  providerId: string,
  messageId: string,
) {
  return (
    (await ctx.db
      .query("operatorEmailReceipts")
      .withIndex("provider", (q) => q.eq("providerId", providerId))
      .unique()) ??
    (await ctx.db
      .query("operatorEmailReceipts")
      .withIndex("sender_message", (q) =>
        q.eq("operatorUserId", operator.userId).eq("messageId", messageId),
      )
      .unique())
  );
}

/** A confirmation-only reply keeps a pending approval instead of superseding it. */
function isConfirmationReply(
  threadToken: boolean,
  emailContent: Infer<typeof operatorEmailContentValidator> | undefined,
) {
  return Boolean(
    threadToken &&
      emailContent &&
      !emailContent.forwarded &&
      /^(?:(?:yes|no)[,\s]+)?(?:approve|approved|reject|rejected|cancel)(?:\s+(?:it|this|that))?[.!]?$/i.test(
        emailContent.currentText.trim().split(/\n\s*\n/)[0],
      ),
  );
}

type EmailCommand = {
  providerId: string;
  messageId: string;
  sender: string;
  subject: string;
  content: string;
  emailContent?: Infer<typeof operatorEmailContentValidator>;
  attachments: Infer<typeof attachmentsValidator>;
};

/** Queues the operator run for an accepted email, records its receipt and schedules the reply. */
async function enqueueEmailCommand(
  ctx: MutationCtx,
  operator: Operator,
  threadId: Id<"operatorAgentThreads">,
  command: EmailCommand,
  options: {
    confirmationReply: boolean;
    emailReadOnly: boolean;
    inbox?: Infer<typeof inboxCommandValidator>;
  },
) {
  const queued = await enqueueOperatorMessage(ctx, {
    operatorUserId: operator.userId,
    threadId,
    channel: "email",
    content: command.content,
    emailContent: command.emailContent,
    preservePendingEmailConfirmation: options.confirmationReply,
    ...(options.emailReadOnly ? { emailReadOnly: true } : {}),
    dedupeKey: `operator-email:${command.providerId}`,
    attachments: command.attachments,
  });
  const receiptId = await ctx.db.insert("operatorEmailReceipts", {
    providerId: command.providerId,
    ...(options.inbox
      ? {
          inboxId: options.inbox.inboxId,
          resendThreadId: options.inbox.resendThreadId,
          resendInboxEmailId: options.inbox.emailId,
        }
      : {}),
    ...(options.emailReadOnly ? { emailReadOnly: true } : {}),
    messageId: command.messageId,
    operatorUserId: operator.userId,
    sender: command.sender,
    subject: command.subject,
    threadId,
    runId: queued.runId,
    createdAt: dayjs().valueOf(),
  });
  await ctx.scheduler.runAfter(
    0,
    internal.actions.handleInboundOperatorEmail.deliver,
    { receiptId },
  );
  return receiptId;
}

/** Legacy `operator(+thread)@agent…` mail, authenticated by `/resend-inbound`. */
export const accept = internalMutation({
  args: {
    providerId: v.string(),
    messageId: v.string(),
    sender: v.string(),
    subject: v.string(),
    content: v.string(),
    emailContent: v.optional(operatorEmailContentValidator),
    threadToken: v.optional(v.string()),
    attachments: attachmentsValidator,
  },
  handler: async (ctx, args) => {
    const operator = await resolveActiveOperatorEmail(ctx, args.sender);
    if (!operator) throw new Error("Operator email sender is not authorized");
    const existing = await findReceipt(
      ctx,
      operator,
      args.providerId,
      args.messageId,
    );
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
    const receiptId = await enqueueEmailCommand(ctx, operator, threadId, args, {
      confirmationReply: isConfirmationReply(
        Boolean(args.threadToken),
        args.emailContent,
      ),
      emailReadOnly: false,
    });
    return { duplicate: false, receiptId };
  },
});

export type InboxCommandRejection =
  | "unknown_inbox"
  | "inbox_retired"
  | "unauthorized_sender"
  | "thread_unavailable"
  | "ambiguous_thread";

/**
 * The recorded command inbox for an inbound message, with whether its Resend
 * thread is already mapped. `null` for any inbox that is not the agent inbox.
 * Lets the action stop before any network work.
 */
export const getCommandInbox = internalQuery({
  args: { inboxId: v.string(), resendThreadId: v.string() },
  handler: async (ctx, args) => {
    const row = await commandInboxRow(ctx, args.inboxId);
    if (!row) return null;
    const mapped = await threadForResendThread(ctx, args.resendThreadId);
    return { ...commandInboxView(row), threadMapped: mapped !== null };
  },
});

export const resolveIdentity = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const operator = await resolveActiveOperatorEmail(ctx, email);
    return operator ? { operatorUserId: operator.userId } : null;
  },
});

/**
 * Command-channel mail from the shared agent inbox, already verified by the
 * inbox webhook and fetched by exact inbox, thread and email ids.
 *
 * `emailReadOnly` is true when the raw message could not be authenticated; the
 * run then excludes every write. The Resend thread maps to exactly one private
 * email thread owned by the same operator on every message; a thread owned by
 * anyone else is rejected, never shared. A retired command inbox only
 * continues threads it already mapped.
 */
export const acceptInboxCommand = internalMutation({
  args: {
    inbox: inboxCommandValidator,
    messageId: v.string(),
    sender: v.string(),
    subject: v.string(),
    content: v.string(),
    emailContent: v.optional(operatorEmailContentValidator),
    attachments: attachmentsValidator,
    emailReadOnly: v.boolean(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { status: "accepted" | "duplicate"; receiptId: Id<"operatorEmailReceipts"> }
    | { status: "rejected"; reason: InboxCommandRejection }
  > => {
    const row = await commandInboxRow(ctx, args.inbox.inboxId);
    if (!row) return { status: "rejected", reason: "unknown_inbox" };
    const operator = await resolveActiveOperatorEmail(ctx, args.sender);
    if (!operator) return { status: "rejected", reason: "unauthorized_sender" };
    const command: EmailCommand = { ...args, providerId: args.inbox.emailId };
    const existing = await findReceipt(
      ctx,
      operator,
      command.providerId,
      command.messageId,
    );
    if (existing) return { status: "duplicate", receiptId: existing._id };

    const mapped = await threadForResendThread(ctx, args.inbox.resendThreadId);
    if (mapped === "ambiguous") {
      return { status: "rejected", reason: "ambiguous_thread" };
    }
    let threadId: Id<"operatorAgentThreads">;
    if (mapped) {
      if (
        mapped.channel !== "email" ||
        mapped.visibility !== "private" ||
        mapped.ownerUserId !== operator.userId
      ) {
        return { status: "rejected", reason: "thread_unavailable" };
      }
      threadId = mapped._id;
    } else {
      if (commandInboxView(row).retired) {
        return { status: "rejected", reason: "inbox_retired" };
      }
      const created = await createOrGetChannelThread(ctx, {
        operatorUserId: operator.userId,
        channel: "email",
        conversationKey: `resend-thread:${args.inbox.resendThreadId}`,
        title: args.subject,
      });
      threadId = created.threadId;
      await ctx.db.patch(threadId, { resendThreadId: args.inbox.resendThreadId });
    }
    const receiptId = await enqueueEmailCommand(ctx, operator, threadId, command, {
      confirmationReply: isConfirmationReply(Boolean(mapped), args.emailContent),
      emailReadOnly: args.emailReadOnly,
      inbox: args.inbox,
    });
    return { status: "accepted", receiptId };
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
    // A command receipt replies only through its recorded agent inbox and
    // only inside the Resend thread it was mapped to.
    let inbox: ReturnType<typeof commandInboxView> | null = null;
    if (receipt.inboxId) {
      const row = await commandInboxRow(ctx, receipt.inboxId);
      if (
        !row ||
        !receipt.resendThreadId ||
        !receipt.resendInboxEmailId ||
        thread.resendThreadId !== receipt.resendThreadId
      )
        return null;
      inbox = commandInboxView(row);
    }
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
    return {
      receipt,
      run,
      response,
      confirmation,
      inbox,
      // The resolved operator's own login address: the only place a command
      // reply may go, whatever the message's From or Reply-To claimed.
      operatorEmail: normalizeOperatorEmail(operator.user.email),
    };
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
