import { v } from "convex/values";
import dayjs from "dayjs";

import type { Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { requireOperator } from "./lib/operatorIdentity";
import {
  composeTeamReply,
  normalizeReplyMessage,
  previewTeamEmailReply,
  replyRecipientsValidator,
  teamReplyError,
} from "./lib/teamEmailReply";
import {
  threadFollowUpRequestValidator,
  validateThreadFollowUpRequest,
} from "./lib/threadFollowUps";

/**
 * Replies on the shared team inbox. Every reply is an operator draft that goes
 * through the one inbox send protocol (`operatorInboxSend`): from the sending
 * operator's own active inbox (the caller's, or any active operator's chosen
 * as `fromUserId`; the caller is recorded as the approver), signed with their
 * name, current Always CC included, no personal Reply-To. `composeTeamReply` is the single source of the preview,
 * the approval fingerprint and the draft, so what is approved is what is sent.
 *
 * The browser's session-authenticated `prepareSend` stores the approved
 * fingerprint on the draft. Agent replies are chat drafts linked to the thread
 * (`save_email_draft` with `teamEmailThreadId`) and send with `send_email_draft`.
 */

const BROWSER_KEY = /^[A-Za-z0-9-]{8,80}$/;

type StoredReply = { _id: Id<"pendingEmails"> };

async function replyDraftByKey(
  ctx: QueryCtx | MutationCtx,
  senderUserId: Id<"users">,
  directReplyKey: string,
): Promise<StoredReply | null> {
  return await ctx.db
    .query("pendingEmails")
    .withIndex("by_senderUserId_and_directReplyKey", (q) =>
      q.eq("senderUserId", senderUserId).eq("directReplyKey", directReplyKey),
    )
    .first();
}

/**
 * Where a browser reply stands, by its idempotency key and the signed-in
 * operator only. For a UI whose send response was lost: only `absent` or
 * `draft` (never claimed, or released after a known rejection) permits
 * starting over with a new key; `pending` is locked and `sent` is done.
 */
export const status = query({
  args: { idempotencyKey: v.string(), fromUserId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const draft = await ctx.db
      .query("pendingEmails")
      .withIndex("by_senderUserId_and_directReplyKey", (q) =>
        q
          .eq("senderUserId", args.fromUserId ?? operator.userId)
          .eq("directReplyKey", `browser:${args.idempotencyKey}`),
      )
      .first();
    return draft
      ? ({ state: draft.status, pendingEmailId: draft._id } as const)
      : ({ state: "absent" } as const);
  },
});

/** The exact reply that would be sent: From, To, Cc, subject, signed body and its fingerprint. */
export const preview = query({
  args: {
    threadId: v.id("teamEmailThreads"),
    message: v.string(),
    /** Send as this active operator instead of the caller. */
    fromUserId: v.optional(v.id("users")),
    recipients: v.optional(replyRecipientsValidator),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const composed = await composeTeamReply(ctx, {
      operatorUserId: args.fromUserId ?? operator.userId,
      threadId: args.threadId,
      message: args.message,
      recipients: args.recipients,
    });
    return composed.ok
      ? ({ ok: true, preview: composed.preview } as const)
      : ({ ok: false, reason: composed.reason } as const);
  },
});

/** `previewTeamEmailReply` for actions, which cannot call it directly. */
export const previewInternal = internalQuery({
  args: {
    operatorUserId: v.id("users"),
    teamEmailThreadId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => await previewTeamEmailReply(ctx, args),
});

/**
 * Creates the reply draft for the signed-in operator's explicit send, once per
 * `idempotencyKey`: a repeat returns the same draft and never makes another.
 * The approval is the fingerprint the operator saw in `preview`; a reply that
 * changed since then is refused. Writing needs a direct (not impersonating)
 * session; nothing here sends.
 */
export const prepareSend = mutation({
  args: {
    threadId: v.id("teamEmailThreads"),
    message: v.string(),
    expectedFingerprint: v.string(),
    idempotencyKey: v.string(),
    fromUserId: v.optional(v.id("users")),
    recipients: v.optional(replyRecipientsValidator),
    /** Nudge the recipient automatically until someone replies. */
    followUps: v.optional(threadFollowUpRequestValidator),
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    if (!BROWSER_KEY.test(args.idempotencyKey)) {
      throw teamReplyError("This reply could not be started. Try again.");
    }
    const directReplyKey = `browser:${args.idempotencyKey}`;
    // Any active operator may send as another; the identity check is in compose.
    const senderUserId = args.fromUserId ?? operator.userId;

    const composed = await composeTeamReply(ctx, {
      operatorUserId: senderUserId,
      threadId: args.threadId,
      message: args.message,
      recipients: args.recipients,
    });
    const existing = await replyDraftByKey(ctx, senderUserId, directReplyKey);
    if (existing) {
      const stored = await ctx.db.get(existing._id);
      // The same key is the same reply only: thread, typed message and approval alike.
      if (
        stored?.teamEmailThreadId !== args.threadId ||
        stored.directReplyMessage !== normalizeReplyMessage(args.message) ||
        stored.directApproval?.fingerprint !== args.expectedFingerprint
      ) {
        throw teamReplyError("This reply key was already used for a different reply.", "key_mismatch");
      }
      return { pendingEmailId: existing._id };
    }
    if (!composed.ok) throw teamReplyError(composed.reason);
    if (composed.preview.fingerprint !== args.expectedFingerprint) {
      throw teamReplyError("The reply changed since it was previewed. Review it again.");
    }
    if (args.followUps) {
      try {
        validateThreadFollowUpRequest(args.followUps);
      } catch (error) {
        throw teamReplyError(error instanceof Error ? error.message : "Choose a follow-up schedule.");
      }
    }
    const pendingEmailId = await ctx.db.insert("pendingEmails", {
      ...composed.fields,
      status: "draft",
      scheduledSendTime: 0,
      directReplyKey,
      directReplyMessage: composed.message,
      directApproval: {
        actorUserId: operator.userId,
        fingerprint: composed.preview.fingerprint,
        approvedAt: dayjs().valueOf(),
      },
      ...(args.followUps ? { followUps: args.followUps } : {}),
    });
    return { pendingEmailId };
  },
});
