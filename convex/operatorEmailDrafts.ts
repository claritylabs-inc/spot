import { v } from "convex/values";
import dayjs from "dayjs";

import type { OperatorEmailDraftView } from "../lib/operator-email-draft";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  actionConfirmationFingerprint,
  isOperatorEmailDraft,
  pendingEmailDraftFingerprint,
} from "./lib/actionConfirmationFingerprint";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { extractEmailAddress, parseReplyToAddresses } from "./lib/emailAddress";
import { requireOperator, requireOperatorForUser } from "./lib/operatorIdentity";
import { NoWriteInputError } from "./lib/noWriteInputError";
import {
  threadFollowUpRequestValidator,
  validateThreadFollowUpRequest,
} from "./lib/threadFollowUps";
import { isComposeKey } from "./lib/teamEmailReply";
import { composeClientOutreachEmail } from "./lib/clientOutreachEmail";
import { OUTREACH_DEFAULT_CADENCE } from "./lib/providerOutreachSchedule";
import {
  getClientOutreachPanel,
  launchClientOutreachByOperator,
  validateClientOutreachLaunch,
} from "./clientOutreach";
import { operatorSenderIdentity, type OperatorSenderIdentity } from "./lib/outreachIdentity";
import {
  quotedHistory,
  teamThreadOwnerAddress,
  teamThreadReplyPlan,
  withoutQuotedHistory,
  type TeamThreadDraftContext,
} from "./lib/teamThreadReply";

const MAX_MESSAGES_PER_QUERY = 50;
const MAX_DRAFTS_PER_MESSAGE = 10;
const MAX_THREAD_DRAFTS = 50;
// Newest drafts examined per page when filters skip most of them.
const MAX_DRAFT_SCAN = 200;
// The exact-approval summary is bounded; a draft that cannot be shown in full
// there cannot be approved as exact. It leaves room for one quoted message.
export const OPERATOR_EMAIL_SEND_SUMMARY_LIMIT = 3_500;

type Ctx = QueryCtx | MutationCtx;

/** Every operator thread is open to all operators. */
async function requireOperatorEmailThread(
  ctx: Ctx,
  threadId: Id<"operatorAgentThreads">,
) {
  const thread = await ctx.db.get(threadId);
  if (!thread) throw new Error("Operator thread not found");
  return thread;
}

export const SENDER_CHANGED_REASON =
  "Sender changed — update draft to re-sign.";

async function toDraftView(
  draft: Doc<"pendingEmails">,
  messageId: Id<"operatorAgentMessages">,
  organizationName: string | undefined,
): Promise<OperatorEmailDraftView> {
  const legacy =
    draft.status === "draft" && (!draft.transport || !draft.senderUserId);
  return {
    id: String(draft._id),
    messageId: String(messageId),
    status: draft.status,
    subject: draft.subject,
    to: draft.recipientEmail ? [draft.recipientEmail] : [],
    cc: draft.ccAddresses ?? [],
    bcc: draft.bccAddresses ?? [],
    replyTo: parseReplyToAddresses(draft.replyTo),
    from: draft.fromHeader,
    senderUserId: draft.senderUserId ? String(draft.senderUserId) : undefined,
    html: draft.renderedHtml,
    text: draft.renderedText || draft.emailBody,
    body: withoutQuotedHistory(draft.emailBody),
    editable: draft.status === "draft" && !draft.directReplyKey,
    attachments: (draft.attachments ?? []).map(({ filename }) => ({
      filename,
    })),
    organizationName,
    teamEmailThreadId: draft.teamEmailThreadId
      ? String(draft.teamEmailThreadId)
      : undefined,
    sendBlockedReason:
      draft.sendBlockedReason ?? (legacy ? SENDER_CHANGED_REASON : undefined),
    fingerprint: await pendingEmailDraftFingerprint(draft),
    followUps: draft.followUps
      ? { cadence: draft.followUps.cadence ?? null }
      : null,
    clientRequest: Boolean(draft.clientOutreach),
    updatedAt: draft._creationTime,
  };
}

/**
 * What an agent approval of a send covers: the exact draft, plus what sending
 * starts (its follow-ups, or the client email sequence it launches).
 */
export async function operatorDraftSendFingerprint(draft: Doc<"pendingEmails">) {
  return await actionConfirmationFingerprint({
    draft: await pendingEmailDraftFingerprint(draft),
    followUps: draft.followUps
      ? { cadence: draft.followUps.cadence ?? null }
      : null,
    clientOutreach: draft.clientOutreach
      ? { informationFormId: draft.clientOutreach.informationFormId ?? null }
      : null,
  });
}

/** Drafts the operator agent created or last revised under each message. */
export const listForMessages = query({
  args: { messageIds: v.array(v.id("operatorAgentMessages")) },
  handler: async (ctx, args) => {
    if (args.messageIds.length > MAX_MESSAGES_PER_QUERY) {
      throw new Error("Too many messages requested");
    }
    await requireOperator(ctx);
    const organizationNames = new Map<string, string | undefined>();
    const result: Record<string, OperatorEmailDraftView[]> = {};
    for (const messageId of new Set(args.messageIds)) {
      const message = await ctx.db.get(messageId);
      if (!message?.pendingEmailIds?.length) continue;
      const views: OperatorEmailDraftView[] = [];
      for (const draftId of message.pendingEmailIds.slice(
        0,
        MAX_DRAFTS_PER_MESSAGE,
      )) {
        const draft = await ctx.db.get(draftId);
        if (!draft || draft.operatorThreadId !== message.threadId) continue;
        const orgId = draft.orgId;
        if (orgId && !organizationNames.has(orgId)) {
          organizationNames.set(orgId, (await ctx.db.get(orgId))?.name);
        }
        views.push(
          await toDraftView(
            draft,
            messageId,
            orgId ? organizationNames.get(orgId) : undefined,
          ),
        );
      }
      if (views.length) result[messageId] = views;
    }
    return result;
  },
});

/** The signed-in operator and owning thread for a hand edit of an operator draft. */
export const editTargetInternal = internalQuery({
  args: { draftId: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const draft = await ctx.db.get(args.draftId);
    if (!draft?.operatorThreadId) throw new Error("Draft not found");
    return {
      operatorUserId: operator.userId,
      threadId: draft.operatorThreadId,
      attachmentFileIds: (draft.attachments ?? []).map(({ fileId }) =>
        String(fileId),
      ),
    };
  },
});

/**
 * Shows a draft under the agent turn that last touched it: the draft id moves
 * from the message that previously displayed it to this one.
 */
export const attachDraftToOperatorMessageInternal = internalMutation({
  args: {
    messageId: v.id("operatorAgentMessages"),
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const [message, draft] = await Promise.all([
      ctx.db.get(args.messageId),
      ctx.db.get(args.pendingEmailId),
    ]);
    if (!message || !draft || draft.operatorThreadId !== message.threadId) {
      throw new Error("Operator draft not found");
    }
    if (draft.operatorMessageId && draft.operatorMessageId !== message._id) {
      const previous = await ctx.db.get(draft.operatorMessageId);
      if (previous?.pendingEmailIds) {
        await ctx.db.patch(previous._id, {
          pendingEmailIds: previous.pendingEmailIds.filter(
            (id) => id !== draft._id,
          ),
        });
      }
    }
    const linked = message.pendingEmailIds ?? [];
    if (!linked.includes(draft._id)) {
      await ctx.db.patch(message._id, {
        pendingEmailIds: [...linked, draft._id],
      });
    }
    if (draft.operatorMessageId !== message._id) {
      await ctx.db.patch(draft._id, { operatorMessageId: message._id });
    }
    return null;
  },
});

/**
 * Validates that the operator may write this email and resolves its sender and
 * link targets. An existing draft keeps its sender unless `senderUserId` names
 * another active operator; a new one is signed by that operator or by
 * `operatorUserId`, the acting operator.
 */
export const resolveSenderInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    senderUserId: v.optional(v.string()),
    threadId: v.id("operatorAgentThreads"),
    orgId: v.optional(v.string()),
    draftId: v.optional(v.string()),
    procurementRequestId: v.optional(v.string()),
    teamEmailThreadId: v.optional(v.string()),
    write: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOperatorEmailThread(ctx, args.threadId);
    if (args.write)
      await assertNoOperatorImpersonation(ctx, args.operatorUserId);

    let draft: Doc<"pendingEmails"> | null = null;
    if (args.draftId) {
      const draftId = ctx.db.normalizeId("pendingEmails", args.draftId);
      draft = draftId ? await ctx.db.get(draftId) : null;
      if (!draft || draft.operatorThreadId !== args.threadId) {
        throw new Error(
          "Draft not found. Use an exact draftId returned by draft_email or list_email_drafts.",
        );
      }
    }
    let senderUserId = draft?.senderUserId ?? args.operatorUserId;
    if (args.senderUserId) {
      const named = ctx.db.normalizeId("users", args.senderUserId);
      if (!named)
        throw new Error(
          "fromUserId must be an exact active operator userId from list_operators.",
        );
      await requireOperatorForUser(ctx, named);
      senderUserId = named;
    }
    if (args.write && senderUserId !== args.operatorUserId)
      await assertNoOperatorImpersonation(ctx, senderUserId);
    const identity = await operatorSenderIdentity(ctx, senderUserId);
    const named = {
      orgId: args.orgId ? ctx.db.normalizeId("organizations", args.orgId) : null,
      requestId: args.procurementRequestId
        ? ctx.db.normalizeId("procurementRequests", args.procurementRequestId)
        : null,
      teamThreadId: args.teamEmailThreadId
        ? ctx.db.normalizeId("teamEmailThreads", args.teamEmailThreadId)
        : null,
    };
    if (args.orgId && !named.orgId) {
      throw new Error(
        "orgId must be an exact client organization ID from search_organizations or get_procurement_request",
      );
    }
    if (args.procurementRequestId && !named.requestId) {
      throw new Error(
        "Procurement request not found. Use an exact procurementRequestId from get_procurement_request.",
      );
    }
    if (args.teamEmailThreadId && !named.teamThreadId) {
      throw new Error(
        "Team email thread not found. Use an exact teamEmailThreadId from list_team_inbox_threads.",
      );
    }
    // A revision keeps its draft's links; naming a different target is an error.
    const linked = {
      orgId: draft?.orgId ?? null,
      requestId: draft?.procurementRequestId ?? null,
      teamThreadId: draft?.teamEmailThreadId ?? null,
    };
    for (const key of ["orgId", "requestId", "teamThreadId"] as const) {
      if (linked[key] && named[key] && named[key] !== linked[key]) {
        throw new Error(
          "This draft is linked to a different client, request or team thread. Create a new draft for that target.",
        );
      }
    }
    // Named targets may add a link a draft does not have yet; the update persists them.
    let orgId = linked.orgId ?? named.orgId;
    let requestId = linked.requestId ?? named.requestId;
    const teamThreadId = linked.teamThreadId ?? named.teamThreadId;

    let thread: Doc<"teamEmailThreads"> | null = null;
    if (teamThreadId) {
      thread = await ctx.db.get(teamThreadId);
      if (!thread || thread.deletedAt !== undefined) {
        throw new Error("Team email thread not found.");
      }
      if (thread.clientOrgId) {
        if (orgId && orgId !== thread.clientOrgId) {
          throw new Error("That team thread belongs to a different client.");
        }
        orgId = thread.clientOrgId;
      } else if (orgId) {
        throw new Error(
          "That team thread is not linked to a client. Link it first, or omit the client.",
        );
      }
      // `requestId` is the thread's request link; `addressedRequestId` is only where mail was sent.
      const threadRequestId = thread.requestId;
      if (threadRequestId) {
        if (requestId && requestId !== threadRequestId) {
          throw new Error("That team thread belongs to a different request.");
        }
        requestId = threadRequestId;
      } else if (requestId) {
        throw new Error(
          "That team thread is not linked to that request. Link it first, or omit the request.",
        );
      }
    }
    if (requestId) {
      const request = await ctx.db.get(requestId);
      if (!request || request.deletedAt !== undefined) {
        throw new Error(
          "Procurement request not found. Use an exact procurementRequestId from get_procurement_request.",
        );
      }
      if (request.clientOrgId) {
        if (orgId && orgId !== request.clientOrgId) {
          throw new Error(
            "Procurement request not found for this client organization. Use an exact procurementRequestId from get_procurement_request.",
          );
        }
        orgId = request.clientOrgId;
      } else if (orgId) {
        throw new Error(
          "That procurement request has no client yet; omit the client.",
        );
      }
    }
    const organization = orgId ? await ctx.db.get(orgId) : null;
    if (
      orgId &&
      (!organization ||
        organization.deletedAt !== undefined ||
        organization.type !== "client")
    ) {
      throw new Error(
        "Client organization not found. Use an exact client organization ID from search_organizations or get_procurement_request.",
      );
    }

    let teamThread: TeamThreadDraftContext | undefined;
    if (thread) {
      const plan = await teamThreadReplyPlan(ctx, thread, senderUserId);
      const ownerAddress =
        plan.threaded || thread.ownerUserId === senderUserId
          ? undefined
          : await teamThreadOwnerAddress(ctx, thread.ownerUserId);
      const quote =
        !plan.threaded && plan.latest ? quotedHistory(plan.latest) : undefined;
      teamThread = {
        id: thread._id,
        subject: thread.subject,
        ownerUserId: thread.ownerUserId,
        crossReply: !plan.threaded,
        ownerAddress,
        defaultTo: plan.defaultTo,
        quoteHeader: quote?.header,
        quote: quote?.block,
      };
    }
    return {
      ...identity,
      orgId: organization?._id,
      orgName: organization?.name,
      procurementRequestId: requestId ?? undefined,
      teamThread,
      draftSenderUserId: draft?.senderUserId,
    };
  },
});

/** Send-time facts the inbox transport needs: where a team-thread reply threads. */
export const getReplyTargetInternal = internalQuery({
  args: {
    pendingEmailId: v.id("pendingEmails"),
    inboxId: v.string(),
    /** Capture mode: `inboxId` is a placeholder and cannot be compared. */
    captured: v.boolean(),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.pendingEmailId);
    if (!draft?.senderUserId || !draft.teamEmailThreadId) return null;
    // A reply was approved for one exact target: use it, never a fresh guess.
    const approved = draft.directReplyContext;
    if (approved) {
      if (approved.mode !== "thread") return null;
      if (!args.captured && approved.inboxId !== args.inboxId) {
        throw new Error("The approved reply target no longer matches your inbox.");
      }
      return approved.resendThreadId && approved.replyToEmailId
        ? {
            resendThreadId: approved.resendThreadId,
            replyToEmailId: approved.replyToEmailId,
          }
        : null;
    }
    const thread = await ctx.db.get(draft.teamEmailThreadId);
    if (!thread || thread.deletedAt !== undefined) return null;
    const plan = await teamThreadReplyPlan(ctx, thread, draft.senderUserId);
    // The mapping is for the sender's active inbox: it only applies to that inbox.
    if (
      !plan.threaded ||
      !plan.resendThreadId ||
      !plan.replyToEmailId ||
      plan.inboxId !== args.inboxId
    ) {
      return null;
    }
    return {
      resendThreadId: plan.resendThreadId,
      replyToEmailId: plan.replyToEmailId,
    };
  },
});

/** Drafts created from one operator thread, newest first, scanned in bounded pages. */
export const listForThreadInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("pending"),
        v.literal("sent"),
        v.literal("cancelled"),
      ),
    ),
    orgId: v.optional(v.string()),
    procurementRequestId: v.optional(v.string()),
    teamEmailThreadId: v.optional(v.string()),
    createdByMe: v.optional(v.boolean()),
    /** Creation time of the last draft already seen; the next page is older. */
    before: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorEmailThread(ctx, args.threadId);
    const limit = Math.max(1, Math.min(args.limit ?? 20, MAX_THREAD_DRAFTS));
    const orgId = args.orgId ? ctx.db.normalizeId("organizations", args.orgId) : undefined;
    const requestId = args.procurementRequestId
      ? ctx.db.normalizeId("procurementRequests", args.procurementRequestId)
      : undefined;
    const teamThreadId = args.teamEmailThreadId
      ? ctx.db.normalizeId("teamEmailThreads", args.teamEmailThreadId)
      : undefined;
    if (orgId === null || requestId === null || teamThreadId === null) {
      throw new Error(
        "clientOrgId, procurementRequestId and teamEmailThreadId must be exact IDs.",
      );
    }
    const before = args.before;
    const drafts: Doc<"pendingEmails">[] = [];
    let scanned = 0;
    let lastSeen = before;
    let more = false;
    for await (const draft of ctx.db
      .query("pendingEmails")
      .withIndex("operator_thread", (q) =>
        before === undefined
          ? q.eq("operatorThreadId", args.threadId)
          : q.eq("operatorThreadId", args.threadId).lt("_creationTime", before),
      )
      .order("desc")) {
      if (scanned >= MAX_DRAFT_SCAN) {
        more = true;
        break;
      }
      scanned += 1;
      const matches =
        (!args.status || draft.status === args.status) &&
        (!orgId || draft.orgId === orgId) &&
        (!requestId || draft.procurementRequestId === requestId) &&
        (!teamThreadId || draft.teamEmailThreadId === teamThreadId) &&
        (!args.createdByMe || draft.senderUserId === args.operatorUserId);
      if (matches && drafts.length === limit) {
        more = true;
        break;
      }
      if (matches) drafts.push(draft);
      lastSeen = draft._creationTime;
    }
    // The cursor resumes after the last draft consumed, so skipped
    // non-matching drafts are not re-read and no match is skipped.
    return { drafts, nextCursor: more ? (lastSeen ?? null) : null };
  },
});

/**
 * Why an operator draft cannot be sent as it stands, or null. The signing
 * identity, Always CC snapshot, link targets and any required thread-owner copy
 * must still match what was approved; otherwise the draft is updated (re-signed)
 * rather than sent with recipients or a sender nobody approved.
 */
export async function operatorDraftBlocker(
  ctx: Ctx,
  draft: Doc<"pendingEmails">,
): Promise<string | null> {
  // A reply draft cannot be updated: the person previews the reply again instead.
  const redo = (updateText: string) =>
    draft.directReplyKey
      ? "Your sender details changed — preview the email again before sending."
      : updateText;
  if (!draft.transport || !draft.senderUserId) return SENDER_CHANGED_REASON;
  let identity: OperatorSenderIdentity;
  try {
    identity = await operatorSenderIdentity(ctx, draft.senderUserId);
  } catch {
    return redo(
      "The signing operator is no longer available — update the draft to re-sign.",
    );
  }
  if (draft.fromHeader !== identity.fromHeader) return redo(SENDER_CHANGED_REASON);
  const copied = new Set(
    [draft.recipientEmail, ...(draft.ccAddresses ?? [])].map((address) =>
      address.trim().toLowerCase(),
    ),
  );
  // The snapshot must equal the current setting: clearing or changing Always CC
  // invalidates the draft, not only a missing copy.
  if (
    (draft.operatorAlwaysCcEmail ?? null) !== identity.alwaysCc ||
    (identity.alwaysCc && !copied.has(identity.alwaysCc))
  ) {
    return redo("Always CC changed — update draft to re-sign.");
  }
  if (draft.orgId) {
    const organization = await ctx.db.get(draft.orgId);
    if (
      !organization ||
      organization.deletedAt !== undefined ||
      organization.type !== "client"
    ) {
      return "The linked client is no longer available.";
    }
  }
  if (draft.procurementRequestId) {
    const request = await ctx.db.get(draft.procurementRequestId);
    if (
      !request ||
      request.deletedAt !== undefined ||
      (request.clientOrgId && request.clientOrgId !== draft.orgId)
    ) {
      return "The linked procurement request is no longer available.";
    }
  }
  if (draft.teamEmailThreadId) {
    const thread = await ctx.db.get(draft.teamEmailThreadId);
    if (!thread || thread.deletedAt !== undefined) {
      return "The team email thread is no longer available.";
    }
    if (draft.directReplyKey && thread.archivedAt) {
      return "The conversation was archived; restore it before replying.";
    }
    // The draft's links must be exactly the thread's now, an absent link included.
    if (
      thread.clientOrgId !== draft.orgId ||
      thread.requestId !== draft.procurementRequestId
    ) {
      return redo(
        "The conversation was linked to a different client or request — update the draft to re-sign.",
      );
    }
    const plan = await teamThreadReplyPlan(ctx, thread, draft.senderUserId);
    if (!plan.threaded && thread.ownerUserId !== draft.senderUserId) {
      const ownerAddress = await teamThreadOwnerAddress(ctx, thread.ownerUserId);
      if (ownerAddress && !copied.has(ownerAddress)) {
        return redo("The thread owner changed — update the draft to copy them.");
      }
    }
  }
  return null;
}

type SendApproval =
  | { approved: true; draft: Doc<"pendingEmails"> }
  | { approved: false; reason: string };

/**
 * An operator draft may be sent only under an exact approval of this unchanged
 * draft by the operator who signed it, rechecked again inside the delivery
 * claim. Two grants exist, never a boolean:
 * - an agent/MCP exact confirmation (`confirmationId`) of `send_email_draft`
 *   for this draft, covering its follow-ups too;
 * - a browser `directApproval` snapshot (no `confirmationId`), which only the
 *   session-authenticated reply, compose and chat-draft send mutations write:
 *   the signing operator approved this exact fingerprint.
 */
export async function checkOperatorSendApproval(
  ctx: Ctx,
  args: {
    confirmationId?: Id<"operatorAgentConfirmations">;
    pendingEmailId: Id<"pendingEmails">;
  },
): Promise<SendApproval> {
  const draft = await ctx.db.get(args.pendingEmailId);
  const denied = (reason: string): SendApproval => ({ approved: false, reason });
  if (!draft || !isOperatorEmailDraft(draft)) {
    return denied("This is not an operator draft.");
  }
  if (!draft.senderUserId) return denied(SENDER_CHANGED_REASON);
  const fingerprint = await pendingEmailDraftFingerprint(draft);

  if (!args.confirmationId) {
    const grant = draft.directApproval;
    // The browser grants three kinds: a reply on its conversation, a new email
    // that has no conversation until it is sent, or an agent chat draft sent
    // from its artifact.
    const browserReply =
      !draft.operatorThreadId &&
      draft.directReplyKey?.startsWith("browser:") &&
      Boolean(draft.teamEmailThreadId);
    const browserCompose =
      !draft.operatorThreadId &&
      isComposeKey(draft.directReplyKey) &&
      !draft.teamEmailThreadId;
    const browserChat = Boolean(draft.operatorThreadId) && !draft.directReplyKey;
    // Any active operator may send a reply, new email or chat draft as another.
    if (
      !grant ||
      !(browserReply || browserCompose || browserChat) ||
      grant.fingerprint !== fingerprint
    ) {
      return denied("The email was not approved, or it changed after approval.");
    }
    if (grant.actorUserId !== draft.senderUserId) {
      try {
        await requireOperatorForUser(ctx, grant.actorUserId);
      } catch {
        return denied("The operator who approved this email is no longer active.");
      }
    }
  } else {
    const confirmation = await ctx.db.get(args.confirmationId);
    if (
      !confirmation ||
      confirmation.status !== "completed" ||
      confirmation.threadId !== draft.operatorThreadId ||
      !confirmation.payload.sourceFingerprint
    ) {
      return denied(
        "A completed operator approval for this exact draft is required.",
      );
    }
    // Any active operator may approve sending a teammate's draft as them.
    if (confirmation.operatorUserId !== draft.senderUserId) {
      try {
        await requireOperatorForUser(ctx, confirmation.operatorUserId);
      } catch {
        return denied("The operator who approved this email is no longer active.");
      }
    }
    const input = JSON.parse(confirmation.payload.input) as Record<string, unknown>;
    if (
      confirmation.payload.toolName !== "send_email_draft" ||
      input.draftId !== draft._id ||
      confirmation.payload.sourceFingerprint !==
        (await operatorDraftSendFingerprint(draft))
    ) {
      return denied("The draft changed since it was approved.");
    }
  }
  try {
    await requireOperatorForUser(ctx, draft.senderUserId);
  } catch {
    return denied("The signing operator is no longer active.");
  }
  const blocker = await operatorDraftBlocker(ctx, draft);
  return blocker ? denied(blocker) : { approved: true, draft };
}

/** Send-time check that the signing operator approved this exact, unchanged draft. */
export const isSendConfirmedInternal = internalQuery({
  args: {
    confirmationId: v.id("operatorAgentConfirmations"),
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const check = await checkOperatorSendApproval(ctx, args);
    return check.approved
      ? ({ approved: true } as const)
      : ({ approved: false, reason: check.reason } as const);
  },
});

/**
 * Records the signed-in operator's Send on a chat draft's artifact as a
 * browser approval of the exact draft they saw. Only the signing operator can
 * approve, any later edit voids it, and nothing here sends.
 */
export const approveSendInternal = internalMutation({
  args: {
    draftId: v.id("pendingEmails"),
    expectedFingerprint: v.string(),
    followUps: v.optional(threadFollowUpRequestValidator),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    const existing = await ctx.db.get(args.draftId);
    if (!existing?.operatorThreadId || existing.directReplyKey) {
      throw new Error("Draft not found");
    }
    const { draft } = await requireSendableOperatorEmailDraft(ctx, {
      threadId: existing.operatorThreadId,
      draftId: args.draftId,
      browser: true,
    });
    const fingerprint = await pendingEmailDraftFingerprint(draft);
    if (fingerprint !== args.expectedFingerprint) {
      throw new Error("The draft changed since you opened it. Review it again.");
    }
    if (args.followUps) validateThreadFollowUpRequest(args.followUps);
    await ctx.db.patch(draft._id, {
      directApproval: {
        actorUserId: operator.userId,
        fingerprint,
        approvedAt: dayjs().valueOf(),
      },
      followUps: args.followUps,
    });
    return { clientRequest: Boolean(draft.clientOutreach) };
  },
});

/** The draft an operator is asking to send, after eligibility checks. */
export async function requireSendableOperatorEmailDraft(
  ctx: Ctx,
  args: {
    threadId: Id<"operatorAgentThreads">;
    draftId: unknown;
    /** A browser send shows the whole draft, so the approval-summary bound does not apply. */
    browser?: boolean;
  },
) {
  const id =
    typeof args.draftId === "string"
      ? ctx.db.normalizeId("pendingEmails", args.draftId)
      : null;
  const draft = id ? await ctx.db.get(id) : null;
  if (!draft || draft.operatorThreadId !== args.threadId) {
    throw new Error(
      "Draft not found. Use an exact draftId returned by draft_email or list_email_drafts.",
    );
  }
  if (draft.status !== "draft") {
    throw new Error(
      `Only unsent drafts can be sent; this draft is ${draft.status}.`,
    );
  }
  if (draft.sendBlockedReason) {
    throw new Error(`Draft is not ready to send: ${draft.sendBlockedReason}`);
  }
  const blocker = await operatorDraftBlocker(ctx, draft);
  if (blocker) throw new Error(blocker);
  if (
    ![
      draft.recipientEmail,
      ...(draft.ccAddresses ?? []),
      ...(draft.bccAddresses ?? []),
    ].every((address) => extractEmailAddress(address)) ||
    !draft.subject.trim() ||
    !draft.emailBody.trim()
  ) {
    throw new Error("Draft is missing a valid recipient, subject, or body.");
  }
  const [organization, request, thread] = await Promise.all([
    draft.orgId ? ctx.db.get(draft.orgId) : null,
    draft.procurementRequestId ? ctx.db.get(draft.procurementRequestId) : null,
    draft.teamEmailThreadId ? ctx.db.get(draft.teamEmailThreadId) : null,
  ]);
  if (
    draft.orgId &&
    (!organization ||
      organization.deletedAt !== undefined ||
      organization.type !== "client")
  ) {
    throw new Error("Client organization not found");
  }
  if (draft.procurementRequestId && (!request || request.deletedAt !== undefined)) {
    throw new Error("Procurement request not found");
  }
  const summary = operatorEmailSendSummary(draft, {
    organizationName: organization?.name,
    requestTitle: request?.title,
    threadSubject: thread?.subject,
  });
  if (!args.browser && summary.length > OPERATOR_EMAIL_SEND_SUMMARY_LIMIT) {
    throw new Error(
      "The email is too long to approve exactly. Shorten the body with update_email_draft.",
    );
  }
  return { draft, summary };
}

/**
 * The email as shown in the exact-approval prompt: sender, recipients, scope
 * and the complete signed body, all covered by the draft fingerprint.
 */
function operatorEmailSendSummary(
  draft: Doc<"pendingEmails">,
  scope: {
    organizationName?: string;
    requestTitle?: string;
    threadSubject?: string;
  },
) {
  const linked = [
    scope.organizationName ? `client ${scope.organizationName}` : null,
    scope.requestTitle ? `request ${scope.requestTitle}` : null,
    scope.threadSubject ? `team thread "${scope.threadSubject}"` : null,
  ].filter((part) => part !== null);
  return [
    `Send email${linked.length ? ` (${linked.join(", ")})` : " (not linked to a client)"}`,
    draft.fromHeader ? `From: ${draft.fromHeader}` : null,
    `To: ${draft.recipientEmail}`,
    draft.ccAddresses?.length ? `Cc: ${draft.ccAddresses.join(", ")}` : null,
    draft.bccAddresses?.length ? `Bcc: ${draft.bccAddresses.join(", ")}` : null,
    draft.replyTo
      ? `Reply-To: ${parseReplyToAddresses(draft.replyTo).join(", ")}`
      : null,
    `Subject: ${draft.subject}`,
    draft.attachments?.length
      ? `Attachments: ${draft.attachments.map(({ filename }) => filename).join(", ")}`
      : null,
    draft.clientOutreach
      ? `Starts a client information request${draft.clientOutreach.informationFormId ? " for its linked form" : ""}.`
      : null,
    draftFollowUpsLine(draft),
    "",
    draft.renderedText ?? draft.emailBody,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** The follow-ups a send starts, as the approval states them. */
function draftFollowUpsLine(draft: Doc<"pendingEmails">) {
  if (!draft.followUps) return draft.clientOutreach ? "Follow-ups: none" : null;
  const cadence = draft.followUps.cadence;
  return cadence
    ? `Follow-ups: ${cadence.followUpCount}, every ${cadence.intervalBusinessDays} business day${cadence.intervalBusinessDays === 1 ? "" : "s"}, until someone replies`
    : "Follow-ups: on a schedule Spot picks, until someone replies";
}

export async function operatorEmailSendConfirmation(
  ctx: Ctx,
  args: {
    threadId: Id<"operatorAgentThreads">;
    draftId: unknown;
    operatorUserId?: Id<"users">;
  },
) {
  const { draft, summary } = await requireSendableOperatorEmailDraft(ctx, args);
  return { summary, fingerprint: await operatorDraftSendFingerprint(draft) };
}

/**
 * Exact-ID checks for the draft attachment tools, run before they execute so a
 * wrong ID fails with the reason and the read to use instead of a generic
 * not-found. Returns the normalized IDs; it never writes.
 */
export const checkAttachmentInputInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    toolName: v.union(
      v.literal("attach_client_file_to_draft"),
      v.literal("attach_policy_pdf_to_draft"),
    ),
    draftId: v.string(),
    reference: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorEmailThread(ctx, args.threadId);
    const reference = args.reference.trim();
    const fail = (message: string): never => {
      throw new NoWriteInputError("invalid_identifier", message);
    };
    const draftId = ctx.db.normalizeId("pendingEmails", args.draftId.trim());
    const draft = draftId ? await ctx.db.get(draftId) : null;
    if (!draft || draft.operatorThreadId !== args.threadId)
      return fail(
        "Draft not found. Use an exact draftId returned by draft_email or list_email_drafts.",
      );
    if (draft.status !== "draft")
      return fail("Only unsent drafts can receive attachments.");
    if (!draft.orgId)
      return fail(
        "This draft is not linked to a client. Revise it with update_email_draft and the client's orgId before attaching files or policies.",
      );
    if (args.toolName === "attach_client_file_to_draft") {
      const clientFileId = ctx.db.normalizeId("clientFiles", reference);
      if (!clientFileId)
        return fail(
          ctx.db.system.normalizeId("_storage", reference)
            ? "That is a storage file ID, not a client file ID. Use the clientFileId from list_client_files or generate_coi."
            : "clientFileId must be an exact ID from list_client_files (or the clientFileId returned by generate_coi).",
        );
      const file = await ctx.db.get(clientFileId);
      if (!file) return fail("Client file not found. List the client's files again.");
      if (file.orgId !== draft.orgId)
        return fail("That file belongs to a different client than this draft.");
      if (file.archivedAt || file.deletedAt)
        return fail("That client file is archived or deleted.");
      return { reference: clientFileId };
    }
    const policyId = ctx.db.normalizeId("policies", reference);
    if (!policyId)
      return fail(
        "policyId must be an exact policy ID from list_policies or lookup_policy, not a policy number or file name.",
      );
    const policy = await ctx.db.get(policyId);
    if (!policy || policy.deletedAt) return fail("Policy not found.");
    if (policy.orgId !== draft.orgId)
      return fail("That policy belongs to a different client than this draft.");
    if (!policy.fileId)
      return fail("That policy has no original PDF available to attach.");
    return { reference: policyId };
  },
});

const draftFollowUpsValidator = v.union(threadFollowUpRequestValidator, v.null());

/** The schedule a client information request launches with: none, Spot's default, or the draft's. */
async function clientDraftCadence(ctx: MutationCtx, draft: Doc<"pendingEmails">) {
  if (draft.followUps?.cadence)
    return { ...draft.followUps.cadence, style: "brief_nudge" as const };
  const panel = draft.procurementRequestId
    ? await getClientOutreachPanel(ctx, draft.procurementRequestId)
    : null;
  const fallback = panel?.defaultCadence ?? OUTREACH_DEFAULT_CADENCE;
  return {
    followUpCount: draft.followUps ? fallback.followUpCount : 0,
    intervalBusinessDays: fallback.intervalBusinessDays,
    style: "brief_nudge" as const,
  };
}

/** Why a client information request draft cannot launch as it stands, or null. */
async function clientRequestBlocker(ctx: MutationCtx, draft: Doc<"pendingEmails">) {
  if (!draft.procurementRequestId)
    return "A client information request needs its procurementRequestId.";
  if (draft.teamEmailThreadId)
    return "A client information request starts a new conversation; it cannot reply on a team thread.";
  if (draft.attachments?.length || draft.bccAddresses?.length)
    return "A client information request cannot carry attachments or Bcc.";
  const alwaysCc = draft.operatorAlwaysCcEmail?.toLowerCase();
  if ((draft.ccAddresses ?? []).some((address) => address.toLowerCase() !== alwaysCc))
    return "A client information request copies only your Always CC.";
  try {
    await validateClientOutreachLaunch(ctx, {
      requestId: draft.procurementRequestId,
      recipientEmail: draft.recipientEmail,
      subject: draft.subject,
      text: withoutQuotedHistory(draft.emailBody),
      cadence: await clientDraftCadence(ctx, draft),
      informationFormId: draft.clientOutreach?.informationFormId,
    });
  } catch (error) {
    return error instanceof Error ? error.message : "This client email cannot be sent.";
  }
  return null;
}

/**
 * Applies a draft's send options after each save: its follow-ups, and whether
 * it is a client information request. A request is rendered exactly as its
 * sequence sends it (greeting, the message, signature) and keeps any launch
 * problem as its send blocker.
 */
export const applyDraftOptionsInternal = internalMutation({
  args: {
    threadId: v.id("operatorAgentThreads"),
    draftId: v.id("pendingEmails"),
    followUps: v.optional(draftFollowUpsValidator),
    informationFormId: v.optional(v.string()),
    clientRequest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let draft = await ctx.db.get(args.draftId);
    if (!draft || draft.operatorThreadId !== args.threadId || draft.status !== "draft")
      throw new Error("Draft not found");
    const patch: Partial<Doc<"pendingEmails">> = {};
    if (args.followUps !== undefined) {
      if (args.followUps) validateThreadFollowUpRequest(args.followUps);
      patch.followUps = args.followUps ?? undefined;
    }
    if (args.clientRequest || args.informationFormId) {
      const informationFormId = args.informationFormId
        ? ctx.db.normalizeId("procurementInformationForms", args.informationFormId)
        : draft.clientOutreach?.informationFormId;
      if (args.informationFormId && !informationFormId)
        throw new Error(
          "informationFormId must be an exact ID from create_procurement_information_form or get_procurement_information.",
        );
      patch.clientOutreach = informationFormId ? { informationFormId } : {};
    }
    if (Object.keys(patch).length) {
      await ctx.db.patch(draft._id, patch);
      draft = { ...draft, ...patch };
    }
    if (!draft.clientOutreach || !draft.senderUserId)
      return draftOptionsResult(draft);
    const identity = await operatorSenderIdentity(ctx, draft.senderUserId);
    const recipient = draft.procurementRequestId
      ? (await getClientOutreachPanel(ctx, draft.procurementRequestId))?.recipients.find(
          (option) => option.email === draft!.recipientEmail.toLowerCase(),
        )
      : undefined;
    const composed = composeClientOutreachEmail({
      kind: "initial",
      isFinal: false,
      recipientName: recipient?.name ?? undefined,
      operator: { name: identity.name, address: identity.teamAddress, prompts: identity.prompts },
      message: { subject: draft.subject, text: withoutQuotedHistory(draft.emailBody) },
    });
    const blocker = await clientRequestBlocker(ctx, draft);
    // The executor's own blockers come first; a launch problem is added once.
    const reasons = [draft.sendBlockedReason, blocker].filter(
      (reason): reason is string => Boolean(reason),
    );
    const sendBlockedReason = reasons.length ? [...new Set(reasons)].join(" ") : undefined;
    await ctx.db.patch(draft._id, {
      renderedText: composed.text,
      renderedHtml: composed.html,
      sendBlockedReason,
    });
    return draftOptionsResult({ ...draft, sendBlockedReason });
  },
});

/** The send options the agent sees after a save. */
function draftOptionsResult(draft: Doc<"pendingEmails">) {
  return {
    followUps: draft.followUps
      ? (draft.followUps.cadence ?? "auto")
      : null,
    ...(draft.clientOutreach ? { clientInformationRequest: true } : {}),
    ...(draft.sendBlockedReason ? { blockedReason: draft.sendBlockedReason } : {}),
  };
}

/**
 * Sends a client information request draft under the same approval as any
 * operator draft: the request's client email sequence launches with the
 * draft's recipient, subject, message, follow-ups and form, and the draft is
 * recorded as sent once the sequence exists.
 */
export const launchClientRequestDraftInternal = internalMutation({
  args: {
    pendingEmailId: v.id("pendingEmails"),
    confirmationId: v.optional(v.id("operatorAgentConfirmations")),
  },
  handler: async (ctx, args) => {
    const check = await checkOperatorSendApproval(ctx, args);
    if (!check.approved) throw new Error(check.reason);
    const { draft } = check;
    if (!draft.clientOutreach || draft.status !== "draft" || !draft.senderUserId)
      throw new Error("This draft is not an unsent client information request.");
    if (draft.sendBlockedReason)
      throw new Error(`Draft is not ready to send: ${draft.sendBlockedReason}`);
    const blocker = await clientRequestBlocker(ctx, draft);
    if (blocker) throw new Error(blocker);
    const launched = await launchClientOutreachByOperator(ctx, {
      operatorUserId: draft.senderUserId,
      requestId: draft.procurementRequestId!,
      informationFormId: draft.clientOutreach.informationFormId,
      recipientEmail: draft.recipientEmail,
      subject: draft.subject,
      text: withoutQuotedHistory(draft.emailBody),
      cadence: await clientDraftCadence(ctx, draft),
    });
    const now = dayjs().valueOf();
    await ctx.db.patch(draft._id, {
      status: "sent",
      sendBlockedReason: undefined,
      clientOutreach: { ...draft.clientOutreach, sequenceId: launched.sequenceId },
      ...(draft.followUps
        ? { followUps: { ...draft.followUps, startedAt: now, sequenceId: launched.sequenceId } }
        : {}),
    });
    return { recipientEmail: draft.recipientEmail, sequenceId: launched.sequenceId };
  },
});

