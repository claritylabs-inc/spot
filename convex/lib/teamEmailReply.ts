import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  operatorSenderIdentity,
  resolveSendFrom,
  senderFromHeader,
  type SendFrom,
  type SendFromOptions,
} from "./outreachIdentity";
import { quotedHistory, teamThreadOwnerAddress, teamThreadReplyPlan } from "./teamThreadReply";
import { pendingEmailDraftFingerprint } from "./actionConfirmationFingerprint";
import { canonicalAddress, extractEmailAddress } from "./emailAddress";
import { escapeHtml } from "./emailTemplate";
import { forwardedCorrespondents } from "./teamEmailForwards";
import { operatorEmailAliases, requireOperatorForUser } from "./operatorIdentity";
import { isSpotOutboundAddress } from "./resend";
import { buildOperatorSignature, teamOwnedDomains } from "./teamEmail";
import { teamTargetProblem } from "./teamEmailStore";

type Ctx = QueryCtx | MutationCtx;

/**
 * Errors whose message is written for the person using the reply UI. Anything
 * else thrown on the way (provider bodies, internals) is never shown.
 */
export const TEAM_REPLY_ERROR = "team_reply";
class TeamReplyError extends ConvexError<{ code: "team_reply"; message: string; reason?: "key_mismatch" }> {
  constructor(message: string, reason?: "key_mismatch") {
    super({ code: TEAM_REPLY_ERROR, message, ...(reason ? { reason } : {}) });
    // Read as plain text where only `message` is shown (agent tool results).
    this.message = message;
    this.name = "TeamReplyError";
  }
}
export const teamReplyError = (message: string, reason?: "key_mismatch") => new TeamReplyError(message, reason);
export function isReplyKeyMismatch(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data = error.data as { code?: unknown; reason?: unknown } | null;
  return data?.code === TEAM_REPLY_ERROR && data.reason === "key_mismatch";
}
export function teamReplyErrorMessage(error: unknown): string | null {
  if (!(error instanceof ConvexError)) return null;
  const data = error.data as { code?: unknown; message?: unknown } | null;
  return data?.code === TEAM_REPLY_ERROR && typeof data.message === "string"
    ? data.message
    : null;
}

/** The typed reply as every composition, fingerprint and comparison reads it. */
export const normalizeReplyMessage = (message: string) =>
  message.replace(/\r\n/g, "\n").trim();

export const MAX_TEAM_REPLY_CHARS = 20_000;

/** Browser-composed new emails are keyed apart from replies (`browser:`) and agent replies. */
export const COMPOSE_KEY_PREFIX = "compose:";
export const isComposeKey = (key: string | undefined) =>
  Boolean(key?.startsWith(COMPOSE_KEY_PREFIX));

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
  directReplyContext: TeamReplyContext;
  /** Gmail replies only: the answered message and the References chain (space-separated). */
  inReplyTo?: string;
  references?: string;
};

/**
 * The target a reply was approved for, bound by the fingerprint. "thread"
 * names the sender's inbox and the exact Resend thread and message answered;
 * "standalone" is a new quoted "Re:" and records only the message quoted.
 * Standalone leaves the inbox out on purpose: a first send creates it. A Gmail
 * reply names its `google:` inbox and the answered Message-ID.
 */
export type TeamReplyContext = {
  latestMessageId: Id<"teamEmailMessages">;
  mode: "thread" | "standalone";
  inboxId?: string;
  resendThreadId?: string;
  replyToEmailId?: string;
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
  /** The account this reply goes out from; From, Cc and the fingerprint follow it. */
  sendFrom: SendFrom;
  sendFromOptions: SendFromOptions;
  fingerprint: string;
};

export type TeamReplyComposition =
  | {
      ok: true;
      fields: TeamReplyDraftFields;
      preview: TeamReplyPreview;
      thread: Doc<"teamEmailThreads">;
      /** The typed reply, trimmed: everything else is derived from it and current state. */
      message: string;
    }
  | { ok: false; reason: string };

export function paragraphsHtml(text: string) {
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

/** Mail addresses Spot runs for clients and notifications; never a correspondent to copy. */
export function isMachineAddress(address: string) {
  const domain = address.split("@")[1] ?? "";
  return isSpotOutboundAddress(address) && !teamOwnedDomains().includes(domain);
}

/**
 * Who a reply goes to: the sender of the latest message and everyone else on
 * it (reply-all), minus the sender's own addresses, duplicates, Bcc and Spot's
 * own machine addresses. A forward the owner sent in answers its original
 * sender and recipients, read from the forwarded header block (unauthenticated
 * text, which is why the preview is the approval); a forward whose original
 * sender cannot be read is refused rather than answered to the forwarder alone.
 */
async function replyCorrespondents(
  ctx: Ctx,
  thread: Doc<"teamEmailThreads">,
  latest: Doc<"teamEmailMessages">,
  ownAddresses: string[],
): Promise<{ ok: true; to: string[]; cc: string[] } | { ok: false; reason: string }> {
  let to: string[];
  let cc: string[];
  let forwarder: string[] = [];
  const owner = thread.ownerUserId ? await ctx.db.get(thread.ownerUserId) : null;
  const ownerAddresses = owner?.email
    ? [owner.email.toLowerCase(), ...operatorEmailAliases(owner.email)]
    : [];
  const fromOwner =
    thread.source === "forward" &&
    latest.direction === "inbound" &&
    ownerAddresses.includes(canonicalAddress(latest.fromEmail));
  if (fromOwner) {
    const original = forwardedCorrespondents(latest.forwarded);
    if (!original?.from) {
      return {
        ok: false,
        reason:
          "This forwarded email has no readable original sender. Reply from your own mailbox, or ask for it to be forwarded again.",
      };
    }
    to = [original.from];
    cc = [...original.to, ...original.cc];
    forwarder = [...ownerAddresses, canonicalAddress(latest.fromEmail)];
  } else if (latest.direction === "inbound") {
    to = [latest.fromEmail];
    cc = [...latest.toAddresses, ...latest.ccAddresses];
  } else {
    to = latest.toAddresses;
    cc = latest.ccAddresses;
  }
  const keep = (addresses: string[]) =>
    addresses
      .map(canonicalAddress)
      .filter(
        (address) =>
          extractEmailAddress(address) &&
          !ownAddresses.includes(address) &&
          !forwarder.includes(address) &&
          !isMachineAddress(address),
      );
  const all = [...new Set([...keep(to), ...keep(cc)])];
  if (!all.length) return { ok: false, reason: "This conversation has no one to reply to." };
  const primary = keep(to)[0] ?? all[0];
  return { ok: true, to: [primary], cc: all.filter((address) => address !== primary) };
}

/**
 * The reply `operatorUserId` would send on a team thread, from their own
 * inbox (or their connected Gmail, with their team address visibly on Cc) and
 * signed as them. Pure over current state: the preview, the approval
 * fingerprint and the draft the send creates all come from this one function,
 * so what is approved is what is sent.
 */
export async function composeTeamReply(
  ctx: Ctx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"teamEmailThreads">;
    message: string;
    sendFrom?: SendFrom;
  },
): Promise<TeamReplyComposition> {
  const message = normalizeReplyMessage(args.message);
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
  // The client and request must be live; `requestId` alone is the request link.
  const requestId = thread.requestId;
  const targetProblem = await teamTargetProblem(ctx, {
    clientOrgId: thread.clientOrgId,
    requestId,
  });
  if (targetProblem) {
    return { ok: false, reason: `This conversation's ${targetProblem}.` };
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
  const choice = await resolveSendFrom(ctx, identity, args.sendFrom, thread.gmailAddress);
  if (!choice.ok) return choice;
  const { gmailAddress } = choice;
  const plan = await teamThreadReplyPlan(ctx, thread, args.operatorUserId, gmailAddress);
  const latest = plan.latest;
  if (!latest) return { ok: false, reason: "There is no message to reply to yet." };

  const teamAddress = identity.teamAddress.toLowerCase();
  const ownAddress = (gmailAddress ?? teamAddress).toLowerCase();
  const correspondents = await replyCorrespondents(ctx, thread, latest, [
    teamAddress,
    ...(choice.connectedAddress ? [choice.connectedAddress] : []),
  ]);
  if (!correspondents.ok) return correspondents;
  const [recipientEmail] = correspondents.to;
  // Only a reply that is not threaded in the sender's own inbox copies the owner.
  const ownerAddress =
    plan.threaded || thread.ownerUserId === args.operatorUserId
      ? undefined
      : await teamThreadOwnerAddress(ctx, thread.ownerUserId);
  const cc = [
    ...new Set(
      // From Gmail the team address is a visible Cc, so recipients' reply-all comes back to Spot.
      [...correspondents.cc, identity.alwaysCc, ownerAddress, gmailAddress ? teamAddress : undefined]
        .filter((address): address is string => Boolean(address))
        .map((address) => address.toLowerCase())
        .filter((address) => address !== recipientEmail && address !== ownAddress),
    ),
  ];

  // Threaded only when the sender's inbox maps this conversation and holds a message to answer.
  const threaded = plan.threaded;
  const quote = threaded ? undefined : quotedHistory(latest);
  const signature = buildOperatorSignature({ name: identity.name });
  const renderedText = `${message}\n\n${signature.text}${quote ? `\n\n${quote.block}` : ""}`;
  const renderedHtml = `${paragraphsHtml(message)}${signature.html}${quote ? quoteHtml(quote.header, quote.block) : ""}`;
  const directReplyContext: TeamReplyContext =
    threaded && plan.inboxId && plan.resendThreadId && plan.replyToEmailId
      ? {
          latestMessageId: latest._id,
          mode: "thread",
          inboxId: plan.inboxId,
          resendThreadId: plan.resendThreadId,
          replyToEmailId: plan.replyToEmailId,
        }
      : { latestMessageId: latest._id, mode: "standalone" };
  const fields: TeamReplyDraftFields = {
    recipientEmail,
    ...(cc.length ? { ccAddresses: cc } : {}),
    subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
    emailBody: quote ? `${message}\n\n${quote.block}` : message,
    fromHeader: senderFromHeader(identity, gmailAddress),
    renderedText,
    renderedHtml,
    senderUserId: args.operatorUserId,
    ...(identity.alwaysCc ? { operatorAlwaysCcEmail: identity.alwaysCc } : {}),
    transport: "operator_inbox",
    ...(thread.clientOrgId ? { orgId: thread.clientOrgId } : {}),
    ...(requestId ? { procurementRequestId: requestId } : {}),
    teamEmailThreadId: thread._id,
    directReplyContext,
    ...(gmailAddress && directReplyContext.mode === "thread" && plan.replyToEmailId
      ? { inReplyTo: plan.replyToEmailId, references: plan.references.join(" ") }
      : {}),
  };
  const fingerprint = await pendingEmailDraftFingerprint(fields);
  return {
    ok: true,
    fields,
    thread,
    message,
    preview: {
      from: fields.fromHeader,
      to: [recipientEmail],
      cc,
      bcc: [],
      subject: fields.subject,
      text: renderedText,
      html: renderedHtml,
      mode: directReplyContext.mode,
      ...(ownerAddress ? { copiesOwner: ownerAddress } : {}),
      stopsFollowUps: thread.source === "outreach",
      sendFrom: choice.sendFrom,
      sendFromOptions: choice.options,
      fingerprint,
    },
  };
}

export type TeamReplyPreviewResult =
  | { ok: true; preview: TeamReplyPreview; teamEmailThreadId: Id<"teamEmailThreads"> }
  | { ok: false; reason: string };

/**
 * The preview for an operator-agent reply, usable from any query or mutation
 * (the confirmation preflight runs in one). It requires an active operator and
 * a live, unarchived target with live client/request, and only reads.
 * The validated team thread id is returned so callers bind approval to that target.
 */
export async function previewTeamEmailReply(
  ctx: Ctx,
  args: { operatorUserId: Id<"users">; teamEmailThreadId: string; message: string },
): Promise<TeamReplyPreviewResult> {
  // Agent and MCP replies always send from the Spot team address.
  await requireOperatorForUser(ctx, args.operatorUserId);
  const threadId = ctx.db.normalizeId("teamEmailThreads", args.teamEmailThreadId);
  if (!threadId) {
    return { ok: false, reason: "Conversation not found." };
  }
  const composed = await composeTeamReply(ctx, {
    operatorUserId: args.operatorUserId,
    threadId,
    message: args.message,
    sendFrom: "spot",
  });
  return composed.ok
    ? { ok: true, preview: composed.preview, teamEmailThreadId: threadId }
    : { ok: false, reason: composed.reason };
}

/**
 * Why a reply draft can no longer be sent exactly as approved, or null. The
 * reply is recomposed from its typed message and current state; any change in
 * recipients, quoted history, threading mode, links or identity changes the
 * fingerprint, and the approval does not carry over. The typed message is the
 * browser draft's `directReplyMessage`, or for an agent reply the message in
 * its confirmation.
 */
export async function replyContextProblem(
  ctx: Ctx,
  draft: Doc<"pendingEmails">,
  confirmationId?: Id<"operatorAgentConfirmations">,
): Promise<string | null> {
  // A new email has no conversation to recompose against; its sender identity,
  // Always CC and client link are rechecked by `operatorDraftBlocker`.
  if (!draft.directReplyKey || isComposeKey(draft.directReplyKey)) return null;
  if (!draft.teamEmailThreadId || !draft.senderUserId) {
    return "The reply is missing its conversation — preview it again.";
  }
  let message = draft.directReplyMessage;
  if (message === undefined && confirmationId) {
    const confirmation = await ctx.db.get(confirmationId);
    const input =
      confirmation?.payload.kind === "operator_tool_action"
        ? (JSON.parse(confirmation.payload.input) as { message?: unknown })
        : undefined;
    if (typeof input?.message === "string") message = input.message;
  }
  if (message === undefined) return "The reply can no longer be verified — preview it again.";
  // The draft's From says which account it was approved for.
  let sendFrom: SendFrom = "spot";
  try {
    const { teamAddress } = await operatorSenderIdentity(ctx, draft.senderUserId);
    if (extractEmailAddress(draft.fromHeader ?? "") !== teamAddress.toLowerCase()) sendFrom = "gmail";
  } catch (error) {
    return error instanceof Error ? error.message : "You cannot send email yet.";
  }
  const composed = await composeTeamReply(ctx, {
    operatorUserId: draft.senderUserId,
    threadId: draft.teamEmailThreadId,
    message,
    sendFrom,
  });
  if (!composed.ok) return composed.reason;
  return composed.preview.fingerprint === (await pendingEmailDraftFingerprint(draft))
    ? null
    : "The conversation changed since this reply was previewed — preview it again.";
}
