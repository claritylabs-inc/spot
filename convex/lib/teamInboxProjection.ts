import type { PaginationOptions } from "convex/server";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { operatorPerson, type OperatorPerson } from "./operatorAvatar";
import { getAgentDomain } from "./resend";
import { normalizeProcurementEmail, procurementForwardingAddress, type ProcurementEmailCategory } from "./procurement";
import { MESSAGE_READ_BYTES, teamTargetProblem, type TeamThread } from "./teamEmailStore";

type Ctx = QueryCtx | MutationCtx;

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
        .paginate({ cursor: null, numItems: MAX_THREAD_MESSAGES, maximumBytesRead: MESSAGE_READ_BYTES }),
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
  const truncated = !messages.isDone;
  // Bound both row count and bytes, retaining the newest messages in display order.
  const hydrated = await Promise.all(
    messages.page.reverse().map(async ({ bodyHtml: _bodyHtml, ...message }) => ({
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
    canReply: !thread.archivedAt && messages.page.length > 0,
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
