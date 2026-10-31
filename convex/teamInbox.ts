import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireOperator } from "./lib/operatorIdentity";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { teamTargetProblem } from "./lib/teamEmailStore";
import { emailHtmlStyle } from "../lib/email-html-style";
import {
  getTeamThreadDetails,
  listSuggestedTeamThreads,
  listTeamInbox,
  teamInboxUnreadCount,
} from "./lib/teamInboxProjection";
import {
  emailCategoryValidator,
  linkTeamEmailThreadByOperator,
  requireClient,
  requireRequest,
  setTeamThreadsArchivedByOperator,
} from "./procurementRequests";

export {
  linkTeamEmailThreadByOperator,
  setTeamThreadsArchivedByOperator,
} from "./procurementRequests";
export {
  getTeamThreadDetails,
  listSuggestedTeamThreads,
  listTeamInbox,
  teamInboxUnreadCount,
} from "./lib/teamInboxProjection";

/**
 * Records that `userId` has read everything in the thread up to its newest
 * inbound message. Idempotent and monotonic: the stored time comes from the
 * thread (never the client clock), so a repeat or a stale tab changes nothing.
 */
export async function markTeamThreadRead(
  ctx: MutationCtx,
  args: { userId: Id<"users">; threadId: Id<"teamEmailThreads"> },
) {
  const thread = await ctx.db.get(args.threadId);
  if (!thread || thread.deletedAt || (await teamTargetProblem(ctx, thread))) {
    throw new Error("Conversation not found");
  }
  const readAt = thread.latestInboundAt ?? thread.latestMessageAt;
  const existing = await ctx.db
    .query("teamInboxReads")
    .withIndex("by_userId_and_threadId", (q) =>
      q.eq("userId", args.userId).eq("threadId", args.threadId),
    )
    .first();
  if (!existing) {
    await ctx.db.insert("teamInboxReads", {
      userId: args.userId,
      threadId: args.threadId,
      readAt,
    });
    return { changed: true as const, readAt };
  }
  if (existing.readAt >= readAt)
    return { changed: false as const, readAt: existing.readAt };
  await ctx.db.patch(existing._id, { readAt });
  return { changed: true as const, readAt };
}

/**
 * The shared team inbox, one bounded index-backed page at a time. At most one
 * primary scope is read from its index (request, client, owner, category,
 * unlinked, else all); further filters apply to that page and are reported by
 * `hiddenCount` / `partial`. Contradictory filters throw.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    ownerUserId: v.optional(v.id("users")),
    unlinked: v.optional(v.boolean()),
    clientOrgId: v.optional(v.id("organizations")),
    requestId: v.optional(v.id("procurementRequests")),
    category: v.optional(emailCategoryValidator),
    archived: v.optional(v.boolean()),
    mailbox: v.optional(v.union(v.literal("inbox"), v.literal("sent"))),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    if (args.requestId) await requireRequest(ctx, args.requestId);
    if (args.clientOrgId) await requireClient(ctx, args.clientOrgId);
    return await listTeamInbox(ctx, { ...args, viewerUserId: operator.userId });
  },
});

/**
 * Unlinked conversations suggested for one request (its Email tab "Suggested"
 * strip). Accept with `linkThread({threadId, requestId})`, which re-checks the
 * live target. `limited` means more suggestions exist than one bounded read returns.
 */
export const suggestedForRequest = query({
  args: { requestId: v.id("procurementRequests") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await requireRequest(ctx, args.requestId);
    return await listSuggestedTeamThreads(ctx, {
      viewerUserId: operator.userId,
      requestId: args.requestId,
    });
  },
});

/** One conversation, unlinked or linked; null when missing, deleted or outside `requestId`. */
export const getThread = query({
  args: {
    threadId: v.id("teamEmailThreads"),
    requestId: v.optional(v.id("procurementRequests")),
    /** Inside a request scope, also open archived conversations (the archive view). */
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    if (args.requestId) await requireRequest(ctx, args.requestId);
    return await getTeamThreadDetails(ctx, {
      ...args,
      viewerUserId: operator.userId,
    });
  },
});

/**
 * People on a conversation's recent messages, for completing recipients: each
 * address once, with the display name it was last seen under.
 */
export const threadContacts = query({
  args: { threadId: v.id("teamEmailThreads") },
  handler: async (ctx, { threadId }) => {
    await requireOperator(ctx);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.deletedAt || (await teamTargetProblem(ctx, thread)))
      return [];
    const messages = await ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (q) =>
        q.eq("threadId", threadId),
      )
      .order("desc")
      .take(30);
    const people = new Map<string, string | undefined>();
    const add = (raw: string, name?: string) => {
      const match = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
      const email = (match?.[2] ?? raw).trim().toLowerCase();
      if (!email.includes("@")) return;
      const label = (name ?? match?.[1])?.trim() || undefined;
      if (!people.has(email) || (label && !people.get(email)))
        people.set(email, label);
    };
    for (const message of messages) {
      add(message.fromEmail, message.fromName);
      for (const address of [...message.toAddresses, ...message.ccAddresses])
        add(address);
    }
    return [...people].map(([email, name]) => ({ email, name: name ?? null }));
  },
});

/**
 * One message's stored HTML body with its inline `cid:` parts resolved to file
 * URLs. Loaded per opened message so the thread query stays small.
 */
export const getMessageHtml = query({
  args: { messageId: v.id("teamEmailMessages") },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const message = await ctx.db.get(args.messageId);
    const thread = message ? await ctx.db.get(message.threadId) : null;
    if (
      !message?.bodyHtml ||
      !thread ||
      thread.deletedAt ||
      (await teamTargetProblem(ctx, thread))
    )
      return null;
    const inline = await Promise.all([
      ...(message.inlineFiles ?? []).map(async (file) => {
        const clientFile = await ctx.db.get(file.clientFileId);
        return clientFile && !clientFile.archivedAt && !clientFile.deletedAt
          ? {
              contentId: file.contentId,
              url: await ctx.storage.getUrl(clientFile.fileId),
            }
          : null;
      }),
      ...(message.unfiledAttachments ?? []).map(async (file) =>
        file.contentId
          ? {
              contentId: file.contentId,
              url: await ctx.storage.getUrl(file.storageId),
            }
          : null,
      ),
    ]);
    return {
      html: message.bodyHtml,
      style: emailHtmlStyle(message.bodyHtml, message.htmlStyle),
      inlineImages: inline.flatMap((file) =>
        file?.url ? [{ contentId: file.contentId, url: file.url }] : [],
      ),
    };
  },
});

/** Validate saved team Inbox links without writing on navigation. */
export const resolveThreadId = query({
  args: {
    threadId: v.string(),
    requestId: v.optional(v.id("procurementRequests")),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const id = ctx.db.normalizeId("teamEmailThreads", args.threadId);
    const thread = id ? await ctx.db.get(id) : null;
    if (
      !thread ||
      thread.deletedAt ||
      (args.requestId && thread.requestId !== args.requestId) ||
      (await teamTargetProblem(ctx, thread))
    )
      return null;
    return thread._id;
  },
});

/** Unread shared team mail for the badge. `limited` means the scan was bounded and `count` is a lower bound. */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const operator = await requireOperator(ctx);
    return await teamInboxUnreadCount(ctx, operator.userId);
  },
});

export const markRead = mutation({
  args: { threadId: v.id("teamEmailThreads") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    return await markTeamThreadRead(ctx, {
      userId: operator.userId,
      threadId: args.threadId,
    });
  },
});

/**
 * Links a conversation to a client, and optionally one of its requests, and
 * files its held attachments. Give a request (its client is derived) or a
 * client; both must agree. Audited; read-only while impersonating.
 */
export const linkThread = mutation({
  args: {
    threadId: v.id("teamEmailThreads"),
    requestId: v.optional(v.id("procurementRequests")),
    clientOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await linkTeamEmailThreadByOperator(ctx, {
      operatorUserId: operator.userId,
      ...args,
      source: "operator",
    });
  },
});

/** Archives or restores up to 100 conversations from any team inbox scope. */
export const setArchived = mutation({
  args: {
    threadIds: v.array(v.id("teamEmailThreads")),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    return await setTeamThreadsArchivedByOperator(ctx, {
      operatorUserId: operator.userId,
      emailThreadIds: args.threadIds,
      archived: args.archived,
    });
  },
});

/**
 * What the owner notification needs, or null when nothing should be sent: the
 * conversation is gone, archived, linked to a request (which notifies through
 * `mailbox_attention`), has no inbound mail, or the user is not an active
 * operator with an email.
 */
export const unlinkedMailNotificationInternal = internalQuery({
  args: { userId: v.id("users"), threadId: v.id("teamEmailThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.deletedAt || thread.archivedAt) return null;
    // Conversations linked to a request notify through `mailbox_attention`.
    if (thread.clientOrgId && thread.requestId) return null;
    if (thread.latestDirection !== "inbound") return null;
    const profile = await ctx.db
      .query("operatorProfiles")
      .withIndex("user", (q) => q.eq("userId", args.userId))
      .first();
    const user =
      profile?.status === "active" ? await ctx.db.get(args.userId) : null;
    if (!user?.email) return null;
    return {
      to: user.email,
      subject: thread.subject.slice(0, 200),
      from: (
        thread.latestFromName ??
        thread.latestFromEmail ??
        "Someone"
      ).slice(0, 120),
      preview: (thread.preview ?? "").slice(0, 160),
    };
  },
});
