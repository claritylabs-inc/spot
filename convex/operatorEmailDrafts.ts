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
import { pendingEmailDraftFingerprint } from "./lib/actionConfirmationFingerprint";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { extractEmailAddress, parseReplyToAddresses } from "./lib/emailAddress";
import {
  requireOperator,
  requireOperatorForUser,
} from "./lib/operatorIdentity";
import { requestForwardingAddress } from "./procurementRequests";

const MAX_MESSAGES_PER_QUERY = 50;
const MAX_DRAFTS_PER_MESSAGE = 10;
const MAX_THREAD_DRAFTS = 50;
// The exact-approval summary is bounded; a draft that cannot be shown in full
// there cannot be approved as exact.
export const OPERATOR_EMAIL_SEND_SUMMARY_LIMIT = 2_500;

type Ctx = QueryCtx | MutationCtx;

async function requireOperatorEmailThread(
  ctx: Ctx,
  threadId: Id<"operatorAgentThreads">,
  operatorUserId: Id<"users">,
) {
  const thread = await ctx.db.get(threadId);
  if (
    !thread ||
    (thread.ownerUserId !== operatorUserId && thread.visibility !== "shared")
  ) {
    throw new Error("Operator thread not found");
  }
  return thread;
}

function toDraftView(
  draft: Doc<"pendingEmails">,
  messageId: Id<"operatorAgentMessages">,
  organizationName: string | undefined,
): OperatorEmailDraftView {
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
    sendBlockedReason: draft.sendBlockedReason,
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
    const operator = await requireOperator(ctx);
    const threadAccess = new Map<string, boolean>();
    const organizationNames = new Map<string, string | undefined>();
    const result: Record<string, OperatorEmailDraftView[]> = {};
    for (const messageId of new Set(args.messageIds)) {
      const message = await ctx.db.get(messageId);
      if (!message?.pendingEmailIds?.length) continue;
      let allowed = threadAccess.get(message.threadId);
      if (allowed === undefined) {
        allowed = await requireOperatorEmailThread(
          ctx,
          message.threadId,
          operator.userId,
        ).then(
          () => true,
          () => false,
        );
        threadAccess.set(message.threadId, allowed);
      }
      if (!allowed) continue;
      const views: OperatorEmailDraftView[] = [];
      for (const draftId of message.pendingEmailIds.slice(
        0,
        MAX_DRAFTS_PER_MESSAGE,
      )) {
        const draft = await ctx.db.get(draftId);
        if (!draft || draft.operatorThreadId !== message.threadId) continue;
        if (!organizationNames.has(draft.orgId)) {
          organizationNames.set(
            draft.orgId,
            (await ctx.db.get(draft.orgId))?.name,
          );
        }
        views.push(
          toDraftView(draft, messageId, organizationNames.get(draft.orgId)),
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

/**
 * Validates that the operator may write email for the target client
 * organization (named directly, or through one of this thread's drafts) and
 * returns the sender identity inputs.
 */
export const resolveSenderInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    threadId: v.id("operatorAgentThreads"),
    orgId: v.optional(v.string()),
    draftId: v.optional(v.string()),
    procurementRequestId: v.optional(v.string()),
    write: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperatorForUser(ctx, args.operatorUserId);
    await requireOperatorEmailThread(ctx, args.threadId, args.operatorUserId);
    if (args.write)
      await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    let orgId = args.orgId
      ? ctx.db.normalizeId("organizations", args.orgId)
      : null;
    if (args.orgId && !orgId) {
      throw new Error(
        "orgId must be an exact client organization ID from search_organizations or get_procurement_request",
      );
    }
    let existingReplyTo: string[] = [];
    if (args.draftId) {
      const draftId = ctx.db.normalizeId("pendingEmails", args.draftId);
      const draft = draftId ? await ctx.db.get(draftId) : null;
      if (!draft || draft.operatorThreadId !== args.threadId) {
        throw new Error(
          "Draft not found. Use an exact draftId returned by draft_email or list_email_drafts.",
        );
      }
      orgId = draft.orgId;
      existingReplyTo = parseReplyToAddresses(draft.replyTo);
    }
    const organization = orgId ? await ctx.db.get(orgId) : null;
    if (
      !organization ||
      organization.deletedAt !== undefined ||
      organization.type !== "client"
    ) {
      throw new Error(
        "Client organization not found. Use an exact client organization ID from search_organizations or get_procurement_request.",
      );
    }
    const user = await ctx.db.get(operator.userId);
    const operatorEmail = extractEmailAddress(user?.email) ?? undefined;
    // Replies go to the operator and, for a procurement request, its
    // forwarding address, which imports the reply without invoking the client
    // agent. A revision that names no request keeps the draft's Reply-To.
    let replyTo = existingReplyTo.length
      ? existingReplyTo
      : operatorEmail
        ? [operatorEmail]
        : [];
    if (args.procurementRequestId) {
      const requestId = ctx.db.normalizeId(
        "procurementRequests",
        args.procurementRequestId,
      );
      const request = requestId ? await ctx.db.get(requestId) : null;
      if (
        !request ||
        request.deletedAt !== undefined ||
        request.clientOrgId !== organization._id
      ) {
        throw new Error(
          "Procurement request not found for this client organization. Use an exact procurementRequestId from get_procurement_request.",
        );
      }
      replyTo = [
        ...(operatorEmail ? [operatorEmail] : []),
        requestForwardingAddress(request),
      ];
    }
    return {
      orgId: organization._id,
      orgName: organization.name,
      agentHandle: organization.agentHandle,
      operatorName: user?.name?.trim() || undefined,
      replyTo,
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
    await requireOperatorEmailThread(ctx, args.threadId, args.operatorUserId);
    return await ctx.db
      .query("pendingEmails")
      .withIndex("operator_thread", (q) =>
        q.eq("operatorThreadId", args.threadId),
      )
      .order("desc")
      .take(MAX_THREAD_DRAFTS);
  },
});

/** Send-time check that the operator approved this exact, unchanged draft. */
export const isSendConfirmedInternal = internalQuery({
  args: {
    confirmationId: v.id("operatorAgentConfirmations"),
    pendingEmailId: v.id("pendingEmails"),
  },
  handler: async (ctx, args) => {
    const [confirmation, draft] = await Promise.all([
      ctx.db.get(args.confirmationId),
      ctx.db.get(args.pendingEmailId),
    ]);
    if (
      !confirmation ||
      !draft ||
      confirmation.status !== "completed" ||
      confirmation.payload.toolName !== "send_email_draft" ||
      confirmation.threadId !== draft.operatorThreadId ||
      !confirmation.payload.sourceFingerprint
    ) {
      return false;
    }
    const approved = JSON.parse(confirmation.payload.input) as {
      draftId?: string;
    };
    return (
      approved.draftId === draft._id &&
      confirmation.payload.sourceFingerprint ===
        (await pendingEmailDraftFingerprint(draft))
    );
  },
});

/** The draft an operator is asking to send, after eligibility checks. */
export async function requireSendableOperatorEmailDraft(
  ctx: Ctx,
  args: { threadId: Id<"operatorAgentThreads">; draftId: unknown },
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
  const organization = await ctx.db.get(draft.orgId);
  if (
    !organization ||
    organization.deletedAt !== undefined ||
    organization.type !== "client"
  ) {
    throw new Error("Client organization not found");
  }
  const summary = operatorEmailSendSummary(draft, organization.name);
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
  organizationName: string,
) {
  return [
    `Send email for ${organizationName}`,
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
  args: { threadId: Id<"operatorAgentThreads">; draftId: unknown },
) {
  const { draft, summary } = await requireSendableOperatorEmailDraft(ctx, args);
  return { summary, fingerprint: await pendingEmailDraftFingerprint(draft) };
}
