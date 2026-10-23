import { v } from "convex/values";

import type { OperatorEmailDraftView } from "../lib/operator-email-draft";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import dayjs from "dayjs";

import {
  isOperatorEmailDraft,
  pendingEmailDraftFingerprint,
} from "./lib/actionConfirmationFingerprint";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { extractEmailAddress, parseReplyToAddresses } from "./lib/emailAddress";
import {
  requireOperator,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import {
  isTeamEmailError,
  operatorFromHeader,
  operatorFromName,
  operatorTeamAddressFor,
} from "./lib/teamEmail";

const MAX_MESSAGES_PER_QUERY = 50;
const MAX_DRAFTS_PER_MESSAGE = 10;
const MAX_THREAD_DRAFTS = 50;
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

function toDraftView(
  draft: Doc<"pendingEmails">,
  messageId: Id<"operatorAgentMessages">,
  organizationName: string | undefined,
): OperatorEmailDraftView {
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
    html: draft.renderedHtml,
    text: draft.renderedText || draft.emailBody,
    attachments: (draft.attachments ?? []).map(({ filename }) => ({
      filename,
    })),
    organizationName,
    teamEmailThreadId: draft.teamEmailThreadId
      ? String(draft.teamEmailThreadId)
      : undefined,
    sendBlockedReason:
      draft.sendBlockedReason ?? (legacy ? SENDER_CHANGED_REASON : undefined),
    updatedAt: draft._creationTime,
  };
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
          toDraftView(
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

export type OperatorSenderIdentity = {
  senderUserId: Id<"users">;
  name: string;
  fromHeader: string;
  teamAddress: string;
  alwaysCc: string | null;
};

/**
 * The person an operator email is sent as: full name, personal team address
 * and Always CC. Computed from the operator's profile; it provisions nothing.
 */
export async function operatorSenderIdentity(
  ctx: Ctx,
  operatorUserId: Id<"users">,
): Promise<OperatorSenderIdentity> {
  const { user, profile } = await requireOperatorForUser(ctx, operatorUserId);
  try {
    const name = operatorFromName(user.name);
    const teamAddress = operatorTeamAddressFor({
      email: user.email ?? null,
      teamEmailLocalpart: profile.teamEmailLocalpart ?? null,
    });
    const alwaysCc =
      extractEmailAddress(profile.alwaysCcEmail) &&
      extractEmailAddress(profile.alwaysCcEmail) !== teamAddress
        ? extractEmailAddress(profile.alwaysCcEmail)
        : null;
    return {
      senderUserId: operatorUserId,
      name,
      fromHeader: operatorFromHeader(name, teamAddress),
      teamAddress,
      alwaysCc,
    };
  } catch (error) {
    if (isTeamEmailError(error)) throw new Error(error.message);
    throw error;
  }
}

/**
 * Whether the sender's inbox holds the thread's Resend conversation, and if
 * so which conversation and message a reply threads under. Otherwise the reply
 * is a new "Re:" message that copies the owner.
 */
export async function teamThreadReplyPlan(
  ctx: Ctx,
  thread: Doc<"teamEmailThreads">,
  senderUserId: Id<"users">,
) {
  const [inbox, links, messages] = await Promise.all([
    ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", senderUserId).eq("status", "active"),
      )
      .order("desc")
      .first(),
    ctx.db
      .query("teamEmailThreadLinks")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .take(20),
    ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(50),
  ]);
  const ownThread = thread.ownerUserId === senderUserId;
  const link = inbox
    ? links.find((candidate) => candidate.inboxId === inbox.inboxId)
    : undefined;
  const resendThreadId = ownThread ? thread.resendThreadId : link?.resendThreadId;
  const replyToEmailId = resendThreadId
    ? messages.find(
        (message) =>
          message.resendInboxEmailId &&
          (message.resendThreadId ?? thread.resendThreadId) === resendThreadId,
      )?.resendInboxEmailId
    : undefined;
  const latestInbound = messages.find((m) => m.direction === "inbound");
  return {
    owns: ownThread || Boolean(link),
    resendThreadId,
    replyToEmailId,
    latest: messages[0],
    defaultTo:
      latestInbound?.fromEmail ?? messages[0]?.toAddresses[0] ?? undefined,
  };
}

async function teamThreadOwnerAddress(
  ctx: Ctx,
  ownerUserId: Id<"users"> | undefined,
): Promise<string | undefined> {
  if (!ownerUserId) return undefined;
  const inbox = await ctx.db
    .query("operatorOutreachInboxes")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", ownerUserId).eq("status", "active"),
    )
    .order("desc")
    .first();
  if (inbox) return inbox.emailAddress.toLowerCase();
  try {
    return (await operatorSenderIdentity(ctx, ownerUserId)).teamAddress;
  } catch {
    return undefined;
  }
}

const QUOTE_MAX_CHARS = 700;

function quotedHistory(message: Doc<"teamEmailMessages">) {
  const who = message.fromName
    ? `${message.fromName} <${message.fromEmail}>`
    : message.fromEmail;
  const header = `On ${dayjs(message.receivedAt).format("MMM D, YYYY, h:mm A")} UTC, ${who} wrote:`;
  const text = message.currentText.replace(/\r\n/g, "\n").trim();
  const clipped =
    text.length > QUOTE_MAX_CHARS
      ? `${text.slice(0, QUOTE_MAX_CHARS).trimEnd()}…`
      : text;
  const quote = clipped
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
  return { header, block: `${header}\n\n${quote}` };
}

export type TeamThreadDraftContext = {
  id: Id<"teamEmailThreads">;
  subject: string;
  ownerUserId?: Id<"users">;
  /** The sender's inbox does not hold this conversation: send a new "Re:" and copy the owner. */
  crossReply: boolean;
  ownerAddress?: string;
  defaultTo?: string;
  quoteHeader?: string;
  quote?: string;
};

/** Validates that the operator may write email as themself and resolves any link targets. */
export const resolveSenderInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
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
    const identity = await operatorSenderIdentity(ctx, args.operatorUserId);

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
    const target = draft ? linked : named;
    let orgId = target.orgId;
    let requestId = target.requestId;
    const teamThreadId = target.teamThreadId;

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
      const threadRequestId = thread.requestId ?? thread.addressedRequestId;
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
      const plan = await teamThreadReplyPlan(ctx, thread, args.operatorUserId);
      const ownerAddress = plan.owns
        ? undefined
        : await teamThreadOwnerAddress(ctx, thread.ownerUserId);
      const quote =
        !plan.owns && plan.latest ? quotedHistory(plan.latest) : undefined;
      teamThread = {
        id: thread._id,
        subject: thread.subject,
        ownerUserId: thread.ownerUserId,
        crossReply: !plan.owns,
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
  args: { pendingEmailId: v.id("pendingEmails"), inboxId: v.string() },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.pendingEmailId);
    if (!draft?.senderUserId || !draft.teamEmailThreadId) return null;
    const thread = await ctx.db.get(draft.teamEmailThreadId);
    if (!thread || thread.deletedAt !== undefined) return null;
    const plan = await teamThreadReplyPlan(ctx, thread, draft.senderUserId);
    const inbox = await ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_inboxId", (q) => q.eq("inboxId", args.inboxId))
      .first();
    // The plan was computed from the sender's active inbox row: it only applies to that inbox.
    if (!plan.resendThreadId || !plan.replyToEmailId) return null;
    if (!inbox || inbox.userId !== draft.senderUserId) return null;
    return {
      resendThreadId: plan.resendThreadId,
      replyToEmailId: plan.replyToEmailId,
    };
  },
});

/** Drafts created from one operator thread, newest first. */
export const listForThreadInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorEmailThread(ctx, args.threadId);
    return await ctx.db
      .query("pendingEmails")
      .withIndex("operator_thread", (q) =>
        q.eq("operatorThreadId", args.threadId),
      )
      .order("desc")
      .take(MAX_THREAD_DRAFTS);
  },
});

/**
 * Why an operator draft cannot be sent as it stands, or null. A draft whose
 * sender identity, Always CC or required thread-owner copy no longer matches
 * must be updated (re-signed) rather than sent with recipients nobody approved.
 */
export async function operatorDraftBlocker(
  ctx: Ctx,
  draft: Doc<"pendingEmails">,
): Promise<string | null> {
  if (!draft.transport || !draft.senderUserId) return SENDER_CHANGED_REASON;
  let identity: OperatorSenderIdentity;
  try {
    identity = await operatorSenderIdentity(ctx, draft.senderUserId);
  } catch {
    return "The signing operator is no longer available — update the draft to re-sign.";
  }
  if (draft.fromHeader !== identity.fromHeader) return SENDER_CHANGED_REASON;
  const copied = new Set(
    [draft.recipientEmail, ...(draft.ccAddresses ?? [])].map((address) =>
      address.trim().toLowerCase(),
    ),
  );
  if (identity.alwaysCc && !copied.has(identity.alwaysCc)) {
    return "Always CC changed — update draft to re-sign.";
  }
  if (draft.teamEmailThreadId) {
    const thread = await ctx.db.get(draft.teamEmailThreadId);
    if (!thread || thread.deletedAt !== undefined) {
      return "The team email thread is no longer available.";
    }
    const plan = await teamThreadReplyPlan(ctx, thread, draft.senderUserId);
    if (!plan.owns) {
      const ownerAddress = await teamThreadOwnerAddress(ctx, thread.ownerUserId);
      if (ownerAddress && !copied.has(ownerAddress)) {
        return "The thread owner changed — update the draft to copy them.";
      }
    }
  }
  return null;
}

type SendApproval =
  | { approved: true; draft: Doc<"pendingEmails"> }
  | { approved: false; reason: string };

/**
 * An operator draft may be sent only under a completed exact approval of this
 * unchanged draft, in the owning operator thread, by the operator who signed
 * it. Used by the send gate and again inside the delivery claim.
 */
export async function checkOperatorSendApproval(
  ctx: Ctx,
  args: {
    confirmationId: Id<"operatorAgentConfirmations">;
    pendingEmailId: Id<"pendingEmails">;
  },
): Promise<SendApproval> {
  const [confirmation, draft] = await Promise.all([
    ctx.db.get(args.confirmationId),
    ctx.db.get(args.pendingEmailId),
  ]);
  const denied = (reason: string): SendApproval => ({ approved: false, reason });
  if (!draft || !isOperatorEmailDraft(draft)) {
    return denied("This is not an operator draft.");
  }
  if (
    !confirmation ||
    confirmation.status !== "completed" ||
    confirmation.payload.toolName !== "send_email_draft" ||
    confirmation.threadId !== draft.operatorThreadId ||
    !confirmation.payload.sourceFingerprint
  ) {
    return denied(
      "A completed operator approval for this exact draft is required.",
    );
  }
  if (!draft.senderUserId || confirmation.operatorUserId !== draft.senderUserId) {
    return denied(
      "Only the operator who signed this draft can approve sending it. Update the draft to re-sign it as you.",
    );
  }
  try {
    await requireOperatorForUser(ctx, draft.senderUserId);
  } catch {
    return denied("The signing operator is no longer active.");
  }
  const approved = JSON.parse(confirmation.payload.input) as {
    draftId?: string;
  };
  if (
    approved.draftId !== draft._id ||
    confirmation.payload.sourceFingerprint !==
      (await pendingEmailDraftFingerprint(draft))
  ) {
    return denied("The draft changed since it was approved.");
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

/** The draft an operator is asking to send, after eligibility checks. */
export async function requireSendableOperatorEmailDraft(
  ctx: Ctx,
  args: {
    threadId: Id<"operatorAgentThreads">;
    draftId: unknown;
    /** The operator who would approve; must be the one who signed the draft. */
    operatorUserId?: Id<"users">;
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
  if (
    args.operatorUserId &&
    draft.senderUserId &&
    draft.senderUserId !== args.operatorUserId
  ) {
    throw new Error(
      "This draft is signed by another operator. Update the draft to re-sign it as you before sending.",
    );
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
  if (summary.length > OPERATOR_EMAIL_SEND_SUMMARY_LIMIT) {
    throw new Error(
      "The email is too long to approve exactly. Shorten the body with update_email_draft.",
    );
  }
  return { draft, summary };
}

/** The complete email, shown verbatim in the exact-approval prompt. */
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
    "",
    draft.emailBody,
  ]
    .filter((line) => line !== null)
    .join("\n");
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
  return { summary, fingerprint: await pendingEmailDraftFingerprint(draft) };
}
