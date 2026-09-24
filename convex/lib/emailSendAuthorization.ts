"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";

export type EmailSendAuthorizationDecision = {
  sendProbability: number;
  negatedProbability: number;
  model: string;
  decidedAt: number;
};

export type EmailSendAuthorizationSource = {
  _id: Id<"threadMessages">;
  orgId: Id<"organizations">;
  threadId: Id<"threads">;
  content: string;
  emailSendAuthorization?: EmailSendAuthorizationDecision;
};

type ExplicitEmailSendSource = {
  orgId: unknown;
  threadId: unknown;
  role: string;
  userId?: unknown;
  fromEmail?: string;
  emailSendAuthorization?: EmailSendAuthorizationDecision;
};

type PendingDraftSummary = {
  recipientEmail: string;
  subject: string;
};

export const EMAIL_SEND_AUTHORIZATION_TASK = "email_send_authorization";

/**
 * Authorization is fail-closed: a missing decision (router failure, message
 * ingested without a decision, non-user message) never authorizes a send.
 * Jev must be sure the message instructs a send and not sure it is negated.
 */
export function emailSendDecisionAuthorizesSend(
  decision: EmailSendAuthorizationDecision | undefined | null,
): boolean {
  return (
    !!decision &&
    jevProceeds(decision.sendProbability) &&
    !jevProceeds(decision.negatedProbability)
  );
}

export async function decideEmailSendAuthorization(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    message: EmailSendAuthorizationSource;
    pendingDrafts: PendingDraftSummary[];
  },
): Promise<EmailSendAuthorizationDecision | null> {
  const messageText = args.message.content.trim();
  if (!messageText) return null;
  try {
    const result = await clRouterDecide(
      {
        orgId: String(args.message.orgId),
        task: EMAIL_SEND_AUTHORIZATION_TASK,
        state: {
          messageText,
          pendingDrafts: args.pendingDrafts.map((draft) => ({
            to: draft.recipientEmail,
            subject: draft.subject,
          })),
        },
        questions: {
          send: {
            type: "noul",
            instructions:
              "Does this user message explicitly instruct Spot to send the pending or draft email now? Only the user's own unquoted words count. Asking Spot to draft, write, review, or show an email, asking whether it should be sent, and unrelated requests do not qualify.",
            criteria: {
              true: "An affirmative, current-turn instruction to send, email, forward, or deliver the message now",
              false: "A draft-only request, a question about sending, a review request, or an unrelated message",
            },
          },
          negated: {
            type: "noul",
            instructions:
              "Is any sending instruction in this message negated, conditional, deferred, or hypothetical? Examples: don't send yet, hold off, send it if they reply, what if we sent it, should I send this?",
            criteria: {
              true: "Sending is forbidden, deferred, conditional on a future event, or merely hypothetical",
              false: "No negation, condition, or deferral applies to the instruction",
            },
          },
        },
      },
      { telemetry: ctx },
    );
    const send = result.answers.send;
    const negated = result.answers.negated;
    if (send?.type !== "noul" || negated?.type !== "noul") return null;
    const decision: EmailSendAuthorizationDecision = {
      sendProbability: send.noul,
      negatedProbability: negated.noul,
      model: result.model,
      decidedAt: Date.now(),
    };
    await ctx.runMutation(internal.emailSendAuthorizations.recordDecision, {
      messageId: args.message._id,
      decision,
    });
    return decision;
  } catch (error) {
    console.warn("[emailSendAuthorization] decision failed", {
      messageId: args.message._id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Runs the ingest-time decision once per user message and stores it on the
 * message record so later send paths read the stored decision, not the text.
 */
export async function ensureEmailSendAuthorizationDecision(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    message: EmailSendAuthorizationSource;
    pendingDrafts: PendingDraftSummary[];
  },
): Promise<EmailSendAuthorizationDecision | null> {
  if (args.message.emailSendAuthorization) {
    return args.message.emailSendAuthorization;
  }
  const decision = await decideEmailSendAuthorization(ctx, args);
  if (decision) args.message.emailSendAuthorization = decision;
  return decision;
}

export function sourceExplicitlyNamesEmailAddress(
  messageText: string,
  email: string,
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const escapedEmail = normalizedEmail.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const emailCharacter = "a-z0-9.!#$%&'*+/=?^_`{|}~@-";
  return new RegExp(
    `(^|[^${emailCharacter}])${escapedEmail}(?=$|[^${emailCharacter}])`,
    "i",
  ).test(messageText);
}

/**
 * The stored Jev decision on the current user message is the only text-derived
 * send authorization. The message must also belong to the pending email's
 * thread and to the acting user.
 */
export function isActorBoundExplicitEmailSendSource(args: {
  message: ExplicitEmailSendSource | null;
  orgId: unknown;
  threadId: unknown;
  actorUserId: unknown;
  actorEmail?: string;
}): boolean {
  const { message } = args;
  if (
    !message ||
    message.role !== "user" ||
    String(message.orgId) !== String(args.orgId) ||
    String(message.threadId) !== String(args.threadId) ||
    !emailSendDecisionAuthorizesSend(message.emailSendAuthorization)
  ) {
    return false;
  }

  if (message.userId) {
    return String(message.userId) === String(args.actorUserId);
  }

  return Boolean(
    message.fromEmail &&
      args.actorEmail &&
      message.fromEmail.trim().toLowerCase() ===
        args.actorEmail.trim().toLowerCase(),
  );
}
