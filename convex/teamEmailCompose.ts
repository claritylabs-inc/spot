import { v } from "convex/values";
import dayjs from "dayjs";

import { mutation, query } from "./_generated/server";
import { assertNoOperatorImpersonation } from "./lib/clientFiles";
import { requireOperator } from "./lib/operatorIdentity";
import { sendFromValidator } from "./lib/outreachIdentity";
import { COMPOSE_KEY_PREFIX, composeTeamEmail } from "./lib/teamEmailCompose";
import { teamReplyError } from "./lib/teamEmailReply";

/**
 * New emails from the team inbox. Like replies, each is an operator draft sent
 * through the one inbox send protocol (`operatorInboxSend`) from the caller's
 * own inbox, signed as them with their Always CC. `composeTeamEmail` is the
 * single source of the preview, the approval fingerprint and the draft; the
 * session-authenticated `prepareSend` stores the approved fingerprint on the
 * draft, which is the only grant the send accepts.
 */

const BROWSER_KEY = /^[A-Za-z0-9-]{8,80}$/;

const composeArgs = {
  to: v.string(),
  cc: v.array(v.string()),
  bcc: v.array(v.string()),
  subject: v.string(),
  message: v.string(),
  clientOrgId: v.optional(v.id("organizations")),
  requestId: v.optional(v.id("procurementRequests")),
  /** Defaults to the Spot team address. */
  sendFrom: v.optional(sendFromValidator),
};

/** The exact email that would be sent: From, To, Cc, Bcc, subject, signed body and its fingerprint. */
export const preview = query({
  args: composeArgs,
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const composed = await composeTeamEmail(ctx, { ...args, operatorUserId: operator.userId });
    return composed.ok
      ? ({ ok: true, preview: composed.preview } as const)
      : ({ ok: false, reason: composed.reason } as const);
  },
});

/**
 * Where a new email stands, by its idempotency key and the signed-in operator
 * only. Only `absent` or `draft` permits starting over with a new key;
 * `pending` is locked and `sent` is done (with its conversation).
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
          .eq("directReplyKey", `${COMPOSE_KEY_PREFIX}${args.idempotencyKey}`),
      )
      .first();
    return draft
      ? ({
          state: draft.status,
          pendingEmailId: draft._id,
          teamEmailThreadId: draft.teamEmailThreadId ?? null,
        } as const)
      : ({ state: "absent" } as const);
  },
});

/**
 * Creates the draft for the signed-in operator's explicit send, once per
 * `idempotencyKey`: a repeat with the same email returns the same draft and
 * never makes another. The approval is the fingerprint the operator saw in
 * `preview`; an email that changed since then is refused. Writing needs a
 * direct (not impersonating) session; nothing here sends.
 */
export const prepareSend = mutation({
  args: { ...composeArgs, expectedFingerprint: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    await assertNoOperatorImpersonation(ctx, operator.userId);
    if (!BROWSER_KEY.test(args.idempotencyKey)) {
      throw teamReplyError("This email could not be started. Try again.");
    }
    const directReplyKey = `${COMPOSE_KEY_PREFIX}${args.idempotencyKey}`;
    const existing = await ctx.db
      .query("pendingEmails")
      .withIndex("by_senderUserId_and_directReplyKey", (q) =>
        q.eq("senderUserId", operator.userId).eq("directReplyKey", directReplyKey),
      )
      .first();
    if (existing) {
      // The same key is the same email only: the approval pins every field.
      if (existing.directApproval?.fingerprint !== args.expectedFingerprint) {
        throw teamReplyError("This email key was already used for a different email.", "key_mismatch");
      }
      return { pendingEmailId: existing._id };
    }
    const { expectedFingerprint, idempotencyKey: _key, ...input } = args;
    const composed = await composeTeamEmail(ctx, { ...input, operatorUserId: operator.userId });
    if (!composed.ok) throw teamReplyError(composed.reason);
    if (composed.preview.fingerprint !== expectedFingerprint) {
      throw teamReplyError("The email changed since it was previewed. Review it again.");
    }
    const pendingEmailId = await ctx.db.insert("pendingEmails", {
      ...composed.fields,
      status: "draft",
      scheduledSendTime: 0,
      directReplyKey,
      directApproval: {
        actorUserId: operator.userId,
        fingerprint: composed.preview.fingerprint,
        approvedAt: dayjs().valueOf(),
      },
    });
    return { pendingEmailId };
  },
});
