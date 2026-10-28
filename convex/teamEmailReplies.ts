import { v } from "convex/values";
import dayjs from "dayjs";

import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { requireOperator, requireOperatorForUser } from "./lib/operatorIdentity";
import {
  composeTeamReply,
  normalizeReplyMessage,
  previewTeamEmailReply,
  teamReplyError,
} from "./lib/teamEmailReply";
import { REPLY_TOOL_NAMES, agentReplyKey } from "./operatorEmailDrafts";

/**
 * Replies on the shared team inbox. Every reply is an operator draft that goes
 * through the one inbox send protocol (`operatorInboxSend`): from the caller's
 * own active inbox, signed with their name, current Always CC included, no
 * personal Reply-To. `composeTeamReply` is the single source of the preview,
 * the approval fingerprint and the draft, so what is approved is what is sent.
 *
 * Two grants authorize a send, never a flag: the browser's session-
 * authenticated `prepareSend` stores the approved fingerprint on the draft, and
 * an agent reply needs its completed exact confirmation (`prepareAgentReply`).
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
  args: { idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const draft = await ctx.db
      .query("pendingEmails")
      .withIndex("by_senderUserId_and_directReplyKey", (q) =>
        q
          .eq("senderUserId", operator.userId)
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
  args: { threadId: v.id("teamEmailThreads"), message: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const composed = await composeTeamReply(ctx, {
      operatorUserId: operator.userId,
      threadId: args.threadId,
      message: args.message,
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
  },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    if (!BROWSER_KEY.test(args.idempotencyKey)) {
      throw teamReplyError("This reply could not be started. Try again.");
    }
    const directReplyKey = `browser:${args.idempotencyKey}`;

    const composed = await composeTeamReply(ctx, {
      operatorUserId: operator.userId,
      threadId: args.threadId,
      message: args.message,
    });
    const existing = await replyDraftByKey(ctx, operator.userId, directReplyKey);
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
    });
    return { pendingEmailId };
  },
});

/**
 * Creates the reply draft for an operator-agent or MCP reply, once per
 * confirmation. The confirmation must be completed, belong to this operator
 * and one of the reply tools, name this thread and message, and carry the
 * fingerprint of the reply as it composes now.
 */
export const prepareAgentReplyInternal = internalMutation({
  args: {
    operatorUserId: v.id("users"),
    confirmationId: v.id("operatorAgentConfirmations"),
    teamEmailThreadId: v.id("teamEmailThreads"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOperatorForUser(ctx, args.operatorUserId);
    await assertNoOperatorImpersonation(ctx, args.operatorUserId);
    const confirmation = await ctx.db.get(args.confirmationId);
    if (
      !confirmation ||
      confirmation.status !== "completed" ||
      confirmation.operatorUserId !== args.operatorUserId ||
      confirmation.payload.kind !== "operator_tool_action" ||
      !REPLY_TOOL_NAMES.includes(confirmation.payload.toolName)
    ) {
      throw new Error("A completed approval for this reply is required.");
    }
    const input = JSON.parse(confirmation.payload.input) as Record<string, unknown>;
    // Both supported tool argument names must identify the exact approved thread.
    const named = [input.teamEmailThreadId, input.procurementEmailThreadId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (
      !named.length ||
      named.some((id) => id !== args.teamEmailThreadId) ||
      input.message !== args.message
    ) {
      throw new Error("The reply does not match what was approved.");
    }
    const composed = await composeTeamReply(ctx, {
      operatorUserId: args.operatorUserId,
      threadId: args.teamEmailThreadId,
      message: args.message,
    });
    if (!composed.ok) throw new Error(composed.reason);
    if (composed.preview.fingerprint !== confirmation.payload.sourceFingerprint) {
      throw new Error("The reply changed since it was approved.");
    }
    const directReplyKey = agentReplyKey(confirmation._id);
    const existing = await replyDraftByKey(ctx, args.operatorUserId, directReplyKey);
    if (existing) return { pendingEmailId: existing._id };
    const pendingEmailId = await ctx.db.insert("pendingEmails", {
      ...composed.fields,
      status: "draft",
      scheduledSendTime: 0,
      directReplyKey,
      directReplyMessage: composed.message,
      operatorThreadId: confirmation.threadId,
    });
    return { pendingEmailId };
  },
});
