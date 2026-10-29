import dayjs from "dayjs";
import { v, type Infer } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { composeSignedEmail } from "./clientOutreachEmail";
import { MAX_OUTREACH_FOLLOW_UPS } from "./providerOutreachSchedule";
import { normalizeProcurementEmail } from "./procurement";

/**
 * Conversation follow-ups: nudges after an operator's reply on any team
 * conversation, sent by the provider outreach sequence primitives with
 * `audience: "thread"`. They only ask for a reply; they never carry the
 * conversation forward.
 */

const CONVERSATION_MESSAGES = 8;
const MESSAGE_CHARS = 3_000;

/** The operator's schedule for a reply's follow-ups; absent lets Jev pick it. */
export const threadFollowUpRequestValidator = v.object({
  cadence: v.optional(
    v.object({ followUpCount: v.number(), intervalBusinessDays: v.number() }),
  ),
});
export type ThreadFollowUpRequest = Infer<typeof threadFollowUpRequestValidator>;

export function validateThreadFollowUpRequest(request: ThreadFollowUpRequest) {
  const cadence = request.cadence;
  if (!cadence) return;
  if (
    !Number.isInteger(cadence.followUpCount) ||
    cadence.followUpCount < 1 ||
    cadence.followUpCount > MAX_OUTREACH_FOLLOW_UPS
  )
    throw new Error(`Follow-ups must be 1 to ${MAX_OUTREACH_FOLLOW_UPS}`);
  if (
    !Number.isInteger(cadence.intervalBusinessDays) ||
    cadence.intervalBusinessDays < 1 ||
    cadence.intervalBusinessDays > 14
  )
    throw new Error("Interval must be 1 to 14 business days");
}

export type ThreadFollowUpConversation = {
  subject: string;
  /** The model route's tenant: the conversation's client, when linked. */
  orgId: Doc<"teamEmailThreads">["clientOrgId"] | null;
  /** Newest last. Message text is untrusted data. */
  messages: { direction: "inbound" | "outbound"; from: string; sentAt: string; text: string }[];
};

export async function threadFollowUpConversation(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<"teamEmailThreads">,
): Promise<ThreadFollowUpConversation> {
  const recent = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
    .order("desc")
    .take(CONVERSATION_MESSAGES);
  return {
    subject: thread.subject,
    orgId: thread.clientOrgId ?? null,
    messages: recent.reverse().map((message) => ({
      direction: message.direction,
      from: message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail,
      sentAt: dayjs(message.receivedAt).toISOString(),
      text: message.currentText.slice(0, MESSAGE_CHARS),
    })),
  };
}

/** The name the recipient signs with on this conversation, if they ever wrote in it. */
export async function threadRecipientName(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<"teamEmailThreads">,
  email: string,
) {
  const address = normalizeProcurementEmail(email);
  const recent = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", thread._id))
    .order("desc")
    .take(50);
  const theirs = recent.find(
    (message) =>
      message.direction === "inbound" &&
      normalizeProcurementEmail(message.fromEmail) === address &&
      message.fromName?.trim(),
  );
  return theirs?.fromName?.trim();
}

/** The deterministic nudge, also the fallback whenever a written one is not needed or fails. */
export function templateThreadFollowUpBody(isFinal: boolean) {
  return isFinal
    ? "Following up once more on my note below. If this is no longer a priority or someone else should take it, let me know."
    : "Following up on my note below. Could you let me know where this stands?";
}

export function composeThreadFollowUpEmail(input: {
  subject: string;
  isFinal: boolean;
  recipientName?: string;
  operator: { name: string; address: string };
  /** A written nudge; the template is used without one. */
  body?: string;
}) {
  return composeSignedEmail({
    subject: /^re:/i.test(input.subject) ? input.subject : `Re: ${input.subject}`,
    recipientName: input.recipientName,
    operator: input.operator,
    body: input.body ?? templateThreadFollowUpBody(input.isFinal),
    source: input.body ? "llm" : "template",
  });
}
