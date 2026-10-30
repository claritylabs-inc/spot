import dayjs from "dayjs";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { inboxKind } from "./inboxIds";
import { operatorSenderIdentity } from "./outreachIdentity";

type Ctx = QueryCtx | MutationCtx;

/** The operator's active inbox row; a row with no `status` is a pre-cutover active inbox. */
async function activeSenderInbox(ctx: Ctx, userId: Id<"users">) {
  const [explicit, legacy] = await Promise.all([
    ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", "active"),
      )
      .order("desc")
      .first(),
    ctx.db
      .query("operatorOutreachInboxes")
      .withIndex("by_userId_and_status", (q) =>
        q.eq("userId", userId).eq("status", undefined),
      )
      .order("desc")
      .first(),
  ]);
  return (
    [explicit, legacy]
      .filter((row) => row !== null && row.kind !== "agent" && inboxKind(row.inboxId) !== "legacy_google")
      .sort((a, b) => (b?._creationTime ?? 0) - (a?._creationTime ?? 0))[0] ??
    null
  );
}

/**
 * Whether the sender's active inbox holds a Resend conversation of this team
 * thread, and if so which one and which message a reply threads under. The
 * only evidence is a `teamEmailThreadLinks` row for that exact inbox: thread
 * ownership says nothing about it, because an owner's inbox can rotate. With no
 * mapping the reply is a new quoted "Re:" (copying the owner).
 */
export async function teamThreadReplyPlan(
  ctx: Ctx,
  thread: Doc<"teamEmailThreads">,
  senderUserId: Id<"users">,
) {
  const [inbox, links, messages] = await Promise.all([
    activeSenderInbox(ctx, senderUserId),
    ctx.db
      .query("teamEmailThreadLinks")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .take(50),
    ctx.db
      .query("teamEmailMessages")
      .withIndex("by_threadId_and_receivedAt", (q) =>
        q.eq("threadId", thread._id),
      )
      .order("desc")
      .take(50),
  ]);
  const link = inbox
    ? links.find((candidate) => candidate.inboxId === inbox.inboxId)
    : undefined;
  const resendThreadId = link?.resendThreadId;
  const replyMessage = resendThreadId
    ? messages.find(
        (message) =>
          message.resendInboxEmailId &&
          message.resendThreadId === resendThreadId,
      )
    : undefined;
  const replyToEmailId = inbox && inboxKind(inbox.inboxId) === "legacy_google"
    ? replyMessage?.messageId
    : replyMessage?.resendInboxEmailId;
  const latestInbound = messages.find((m) => m.direction === "inbound");
  return {
    threaded: Boolean(
      link &&
      replyToEmailId &&
      inbox &&
      messages[0]?.resendThreadId === resendThreadId,
    ),
    inboxId: inbox?.inboxId,
    resendThreadId,
    replyToEmailId,
    latest: messages[0],
    defaultTo:
      latestInbound?.fromEmail ?? messages[0]?.toAddresses[0] ?? undefined,
  };
}

export async function teamThreadOwnerAddress(
  ctx: Ctx,
  ownerUserId: Id<"users"> | undefined,
): Promise<string | undefined> {
  if (!ownerUserId) return undefined;
  const inbox = await activeSenderInbox(ctx, ownerUserId);
  if (inbox) return inbox.emailAddress.toLowerCase();
  try {
    return (await operatorSenderIdentity(ctx, ownerUserId)).teamAddress;
  } catch {
    return undefined;
  }
}

const QUOTE_MAX_CHARS = 700;

/** A trailing "On <date> UTC, <sender> wrote:" block of "> " lines, as written by `quotedHistory`. */
const QUOTED_HISTORY_PATTERN =
  /\n*On [^\n]+ UTC, [^\n]+ wrote:\n\n(?:>[^\n]*(?:\n|$))*$/;

/** A draft body without the team-thread quote appended to it. */
export function withoutQuotedHistory(body: string) {
  return body.replace(QUOTED_HISTORY_PATTERN, "").trimEnd();
}

export function quotedHistory(message: Doc<"teamEmailMessages">) {
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
  /** Everyone else on the latest message, copied on a reply-all. */
  defaultCc?: string[];
  quoteHeader?: string;
  quote?: string;
};
