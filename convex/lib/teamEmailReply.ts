import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  operatorSenderIdentity,
  quotedHistory,
  teamThreadOwnerAddress,
  teamThreadReplyPlan,
} from "../operatorEmailDrafts";
import { pendingEmailDraftFingerprint } from "./actionConfirmationFingerprint";
import { extractEmailAddress } from "./emailAddress";
import { escapeHtml } from "./emailTemplate";
import { buildOperatorSignature } from "./teamEmail";

type Ctx = QueryCtx | MutationCtx;

export const MAX_TEAM_REPLY_CHARS = 20_000;

/** Every field of the pending draft a reply becomes; the fingerprint is computed over these. */
export type TeamReplyDraftFields = {
  recipientEmail: string;
  ccAddresses?: string[];
  subject: string;
  emailBody: string;
  fromHeader: string;
  renderedText: string;
  renderedHtml: string;
  senderUserId: Id<"users">;
  operatorAlwaysCcEmail?: string;
  transport: "operator_inbox";
  orgId?: Id<"organizations">;
  procurementRequestId?: Id<"procurementRequests">;
  teamEmailThreadId: Id<"teamEmailThreads">;
};

/** Exactly what the operator approves: shown by the UI and bound by the fingerprint. */
export type TeamReplyPreview = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** The signed message as the recipient reads it, quoted history included. */
  text: string;
  html: string;
  /** "thread": answered inside the sender's own inbox thread; "standalone": a new quoted "Re:". */
  mode: "thread" | "standalone";
  /** The thread owner copied on a standalone reply. */
  copiesOwner?: string;
  /** An outreach conversation: sending stops its automated follow-ups. */
  stopsFollowUps: boolean;
  fingerprint: string;
};

export type TeamReplyComposition =
  | {
      ok: true;
      fields: TeamReplyDraftFields;
      preview: TeamReplyPreview;
      thread: Doc<"teamEmailThreads">;
    }
  | { ok: false; reason: string };

function paragraphsHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function quoteHtml(header: string, block: string) {
  const lines = block
    .slice(header.length)
    .split("\n")
    .map((line) => line.replace(/^>\s?/, ""))
    .filter((line, index, all) => !(line === "" && (index === 0 || index === all.length - 1)));
  return `<p>${escapeHtml(header)}</p><blockquote style="margin:0 0 0 4px;padding:0 0 0 12px;border-left:2px solid #d4d4d4;color:#6b6b6b">${paragraphsHtml(lines.join("\n"))}</blockquote>`;
}

const normalized = (address: string) =>
  (extractEmailAddress(address) ?? address.trim().toLowerCase()).toLowerCase();

/**
 * The reply `operatorUserId` would send on a team thread, from their own
 * inbox and signed as them. Pure over current state: the preview, the approval
 * fingerprint and the draft the send creates all come from this one function,
 * so what is approved is what is sent.
 */
export async function composeTeamReply(
  ctx: Ctx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"teamEmailThreads">;
    message: string;
  },
): Promise<TeamReplyComposition> {
  const message = args.message.replace(/\r\n/g, "\n").trim();
  if (!message) return { ok: false, reason: "Write a reply first." };
  if (message.length > MAX_TEAM_REPLY_CHARS) {
    return { ok: false, reason: "The reply is too long." };
  }
  const thread = await ctx.db.get(args.threadId);
  if (!thread || thread.deletedAt !== undefined) {
    return { ok: false, reason: "Conversation not found." };
  }
  if (thread.archivedAt) {
    return {
      ok: false,
      reason: "This conversation is archived; restore it before replying.",
    };
  }
  let identity: Awaited<ReturnType<typeof operatorSenderIdentity>>;
  try {
    identity = await operatorSenderIdentity(ctx, args.operatorUserId);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "You cannot send email yet.",
    };
  }
  const plan = await teamThreadReplyPlan(ctx, thread, args.operatorUserId);
  const latest = plan.latest;
  if (!latest) return { ok: false, reason: "There is no message to reply to yet." };

  const ownAddress = identity.teamAddress.toLowerCase();
  const addressees = [
    ...new Set(
      (latest.direction === "inbound" ? [latest.fromEmail] : latest.toAddresses)
        .map(normalized)
        .filter((address) => address.includes("@") && address !== ownAddress),
    ),
  ];
  const [recipientEmail, ...otherAddressees] = addressees;
  if (!recipientEmail) {
    return { ok: false, reason: "This conversation has no one to reply to." };
  }
  // Only a reply that is not threaded in the sender's own inbox copies the owner.
  const ownerAddress =
    plan.owns || thread.ownerUserId === args.operatorUserId
      ? undefined
      : await teamThreadOwnerAddress(ctx, thread.ownerUserId);
  const cc = [
    ...new Set(
      [...otherAddressees, identity.alwaysCc, ownerAddress]
        .filter((address): address is string => Boolean(address))
        .map((address) => address.toLowerCase())
        .filter((address) => address !== recipientEmail && address !== ownAddress),
    ),
  ];

  // Threaded only when the sender's inbox maps this conversation and holds a message to answer.
  const threaded = plan.owns && Boolean(plan.replyToEmailId);
  const quote = threaded ? undefined : quotedHistory(latest);
  const signature = buildOperatorSignature({ name: identity.name });
  const renderedText = `${message}\n\n${signature.text}${quote ? `\n\n${quote.block}` : ""}`;
  const renderedHtml = `${paragraphsHtml(message)}${signature.html}${quote ? quoteHtml(quote.header, quote.block) : ""}`;
  const requestId = thread.requestId ?? thread.addressedRequestId;
  const fields: TeamReplyDraftFields = {
    recipientEmail,
    ...(cc.length ? { ccAddresses: cc } : {}),
    subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
    emailBody: quote ? `${message}\n\n${quote.block}` : message,
    fromHeader: identity.fromHeader,
    renderedText,
    renderedHtml,
    senderUserId: args.operatorUserId,
    ...(identity.alwaysCc ? { operatorAlwaysCcEmail: identity.alwaysCc } : {}),
    transport: "operator_inbox",
    ...(thread.clientOrgId ? { orgId: thread.clientOrgId } : {}),
    ...(requestId ? { procurementRequestId: requestId } : {}),
    teamEmailThreadId: thread._id,
  };
  const fingerprint = await pendingEmailDraftFingerprint(fields);
  return {
    ok: true,
    fields,
    thread,
    preview: {
      from: fields.fromHeader,
      to: [recipientEmail],
      cc,
      bcc: [],
      subject: fields.subject,
      text: renderedText,
      html: renderedHtml,
      mode: threaded ? "thread" : "standalone",
      ...(ownerAddress ? { copiesOwner: ownerAddress } : {}),
      stopsFollowUps: thread.source === "outreach",
      fingerprint,
    },
  };
}
