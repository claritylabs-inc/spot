import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  requireOperator,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import {
  MAILBOX_PREFIX,
  SENDING_ADDRESSES,
  mailboxConnectionsAllowed,
} from "./lib/sendingMailbox";
import { emitOperatorNotification } from "./lib/operatorNotify";
import { mirrorTeamEmail } from "./lib/teamEmailStore";
import {
  inboxAttachmentValidator,
  inboxEmailValidator,
} from "./lib/providerOutreachValidators";

dayjs.extend(utc);
dayjs.extend(timezone);
const today = () => dayjs().tz("America/Toronto").format("YYYY-MM-DD");

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    const boxes = await ctx.db.query("operatorSendingMailboxes").take(6);
    const mailboxes = await Promise.all(
      SENDING_ADDRESSES.map(async (address) => {
        const box = boxes.find((row) => row.address === address);
        if (!box)
          return {
            address,
            id: null,
            owner: null,
            isDefault: false,
            canManage: true,
            enabled: false,
            verifiedAt: null,
            dailyLimit: 20,
            gapMinutes: 10,
            acceptedToday: 0,
            nextSendAt: null,
            lastAcceptedAt: null,
            lastSyncAt: null,
            error: null,
          };
        const health = await ctx.db
          .query("operatorMailboxHealth")
          .withIndex("by_mailboxId", (q) => q.eq("mailboxId", box._id))
          .unique();
        const owner = await ctx.db.get(box.ownerUserId);
        return {
          address,
          id: box._id,
          owner: owner?.name ?? owner?.email ?? "Operator",
          isDefault:
            box.isDefault ??
            boxes.filter((row) => row.ownerUserId === box.ownerUserId)
              .length === 1,
          canManage: box.ownerUserId === operator.user._id,
          enabled: box.enabled,
          verifiedAt: box.verifiedAt,
          dailyLimit: box.dailyLimit,
          gapMinutes: box.gapMinutes,
          acceptedToday: health?.day === today() ? health.acceptedToday : 0,
          nextSendAt: health?.nextSendAt ?? null,
          lastAcceptedAt: health?.lastAcceptedAt ?? null,
          lastSyncAt: health?.lastSyncAt ?? null,
          error:
            health?.sendError ?? health?.syncError ?? health?.lastError ?? null,
        };
      }),
    );
    const placementChecks = await ctx.db
      .query("operatorEmailPlacementChecks")
      .order("desc")
      .take(100);
    const attempts = await ctx.db
      .query("emailDeliveryAttempts")
      .order("desc")
      .take(100);
    return {
      placementChecks,
      mailboxes,
      capture: process.env.EMAIL_DELIVERY_MODE === "capture",
      restricted: process.env.EMAIL_DELIVERY_MODE === "restricted",
      connectionsEnabled: mailboxConnectionsAllowed(),
      encryptionReady: !!process.env.EMAIL_CONNECTIONS_ENCRYPTION_KEY,
      attempts: attempts.map((row) => ({
        id: row._id,
        provider: row.provider,
        status: row.status,
        stage: row.operatorStage ?? null,
        to: row.recipientEmail ?? null,
        subject: row.subject ?? null,
        at: row.startedAt,
        error: row.error ?? null,
      })),
      attemptsLimited: attempts.length === 100,
    };
  },
});
export const authorize = internalQuery({
  args: {},
  handler: async (ctx) => {
    const op = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, op.user._id);
    return op.user._id;
  },
});
export const connection = internalQuery({
  args: { address: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("operatorSendingMailboxes")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .unique(),
});
export const getDraft = internalQuery({
  args: { id: v.id("operatorMailboxDrafts") },
  handler: async (ctx, args) => await ctx.db.get(args.id),
});
export const draftByKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("operatorMailboxDrafts")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique(),
});
export const finishDraft = internalMutation({
  args: {
    id: v.id("operatorMailboxDrafts"),
    status: v.union(
      v.literal("sent"),
      v.literal("unknown"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.id);
    if (!draft) return;
    if (draft.status === "sent") return;
    await ctx.db.patch(draft._id, {
      status: args.status,
      error: args.error,
      ...(args.status === "sent" ? { sentAt: dayjs().valueOf() } : {}),
    });
    const health = await ctx.db
      .query("operatorMailboxHealth")
      .withIndex("by_mailboxId", (q) => q.eq("mailboxId", draft.mailboxId))
      .unique();
    if (health)
      await ctx.db.patch(health._id, {
        sendError: args.error,
        ...(args.status === "sent"
          ? { lastAcceptedAt: dayjs().valueOf() }
          : {}),
      });
  },
});
export const syncState = internalQuery({
  args: { mailboxId: v.id("operatorSendingMailboxes") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("operatorMailboxHealth")
      .withIndex("by_mailboxId", (q) => q.eq("mailboxId", args.mailboxId))
      .unique(),
});
export const saveSync = internalMutation({
  args: {
    mailboxId: v.id("operatorSendingMailboxes"),
    uid: v.optional(v.number()),
    uidValidity: v.optional(v.string()),
    folder: v.optional(v.union(v.literal("inbox"), v.literal("spam"))),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("operatorMailboxHealth")
      .withIndex("by_mailboxId", (q) => q.eq("mailboxId", args.mailboxId))
      .unique();
    const patch = {
      ...(!args.error ? { lastSyncAt: dayjs().valueOf() } : {}),
      syncError: args.error,
      ...(args.uid !== undefined
        ? args.folder === "spam"
          ? { spamUid: args.uid }
          : { inboxUid: args.uid }
        : {}),
      ...(args.uidValidity
        ? args.folder === "spam"
          ? { spamUidValidity: args.uidValidity }
          : { inboxUidValidity: args.uidValidity }
        : {}),
    };
    if (row) await ctx.db.patch(row._id, patch);
    else
      await ctx.db.insert("operatorMailboxHealth", {
        mailboxId: args.mailboxId,
        day: today(),
        acceptedToday: 0,
        nextSendAt: 0,
        ...patch,
      });
  },
});
export const ingest = internalMutation({
  args: {
    mailboxId: v.id("operatorSendingMailboxes"),
    email: inboxEmailValidator,
    attachments: v.array(inboxAttachmentValidator),
  },
  handler: async (ctx, args) => {
    const box = await ctx.db.get(args.mailboxId);
    if (!box) {
      await Promise.all(
        args.attachments.map((file) => ctx.storage.delete(file.fileId)),
      );
      return;
    }
    await requireOperatorForUser(ctx, box.ownerUserId);
    // Only replies to Spot-originated conversations are imported; warmup and unrelated mail stay outside Spot.
    let thread = null;
    for (const reference of [
      ...args.email.references,
      args.email.inReplyTo ?? "",
    ]
      .filter(Boolean)
      .slice(-30)) {
      const message = await ctx.db
        .query("teamEmailMessages")
        .withIndex("by_messageId", (q) => q.eq("messageId", reference))
        .first();
      const candidate = message ? await ctx.db.get(message.threadId) : null;
      if (candidate?.ownerUserId === box.ownerUserId) {
        thread = candidate;
        break;
      }
    }
    if (!thread) {
      await Promise.all(
        args.attachments.map((file) => ctx.storage.delete(file.fileId)),
      );
      return;
    }
    const result = await mirrorTeamEmail(ctx, {
      target: { thread },
      email: args.email,
      direction: "inbound",
      attachments: args.attachments,
      inboxId: MAILBOX_PREFIX + box.address,
      resendThreadId: thread.resendThreadId,
      now: dayjs().valueOf(),
    });
    if (!("rejected" in result) && !result.duplicate) {
      await emitOperatorNotification(ctx, {
        eventKey: `inbox:team_mail:${result.messageId}`,
        category: "inbox",
        target: { kind: "inbox", threadId: thread._id },
      });
      await ctx.scheduler.runAfter(
        0,
        internal.providerOutreach.recordGoogleMailboxReplyInternal,
        { teamEmailThreadId: thread._id },
      );
    }
  },
});
export const message = internalQuery({
  args: { address: v.string(), messageId: v.string() },
  handler: async (ctx, args) => {
    const box = await ctx.db
      .query("operatorSendingMailboxes")
      .withIndex("by_address", (q) => q.eq("address", args.address))
      .unique();
    if (!box) return null;
    const row = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
    const thread = row ? await ctx.db.get(row.threadId) : null;
    if (!row || thread?.ownerUserId !== box.ownerUserId) return null;
    return {
      id: row.messageId!,
      direction: row.direction,
      from: row.fromEmail,
      to: row.toAddresses,
      cc: row.ccAddresses,
      bcc: row.bccAddresses,
      replyTo: [],
      subject: row.subject,
      messageId: row.messageId ?? null,
      html: row.bodyHtml ?? null,
      text: row.currentText,
      attachments: [],
      read: true,
      receivedAt: dayjs(row.receivedAt).toISOString(),
    };
  },
});

/** Manually observed seed results; never inferred from SMTP acceptance. */
export const recordPlacement = mutation({
  args: {
    sender: v.string(),
    destination: v.union(
      v.literal("Gmail"),
      v.literal("Microsoft"),
      v.literal("Other"),
    ),
    placement: v.union(
      v.literal("Inbox"),
      v.literal("Spam"),
      v.literal("Missing"),
    ),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const op = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, op.user._id);
    if (!SENDING_ADDRESSES.includes(args.sender) || args.note.length > 500)
      throw new Error(
        "Choose a reserved mailbox; keep notes under 500 characters.",
      );
    await ctx.db.insert("operatorEmailPlacementChecks", {
      ...args,
      note: args.note.trim(),
      checkedAt: dayjs().valueOf(),
      recordedBy: op.user._id,
    });
  },
});
