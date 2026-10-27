"use node";
/**
 * Resend sends team correspondence. `google:` inbox ids are an operator's
 * connected Gmail (OAuth) and go through the Gmail transport; the retired
 * `gmail:` app-password mailboxes remain readable only.
 */
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import * as resend from "./resendInbox";
import { readGoogleDraft } from "./googleMailboxTransport";
import { isGoogleMailbox } from "./sendingMailbox";
import { isOperatorGmailInbox } from "./operatorGmail";
import * as gmail from "./gmailTransport";
export * from "./resendInbox";
function assertResendSender(
  inboxId: string,
  operation: "createDraft" | "sendDraft" | "replyToThreadEmail",
) {
  if (isGoogleMailbox(inboxId)) {
    throw new resend.ResendInboxError(
      "blocked",
      operation,
      "Google sending has been retired. Review this message using your Resend team address.",
      { code: "google_sending_retired" },
    );
  }
}
export async function createDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: gmail.GmailCreateDraftParams,
) {
  if (isOperatorGmailInbox(params.inboxId)) {
    return gmail.createGmailDraft(ctx, actor, params);
  }
  assertResendSender(params.inboxId, "createDraft");
  const { references: _references, ...resendParams } = params;
  return resend.createDraft(ctx, actor, resendParams);
}
export async function sendDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: resend.SendDraftParams,
) {
  if (isOperatorGmailInbox(params.inboxId)) {
    return gmail.sendGmailDraft(ctx, actor, params);
  }
  assertResendSender(params.inboxId, "sendDraft");
  return resend.sendDraft(ctx, actor, params);
}
export async function getDraft(
  ctx: ActionCtx,
  inboxId: string,
  draftId: string,
) {
  if (isOperatorGmailInbox(inboxId)) return gmail.readGmailDraft(ctx, inboxId, draftId);
  return isGoogleMailbox(inboxId)
    ? readGoogleDraft(ctx, inboxId, draftId)
    : resend.getDraft(inboxId, draftId);
}
export async function getThreadEmail(
  ctx: ActionCtx,
  inboxId: string,
  threadId: string,
  emailId: string,
): Promise<resend.ResendInboxResult<resend.ResendThreadEmail>> {
  if (isOperatorGmailInbox(inboxId)) return gmail.getGmailThreadEmail();
  if (!isGoogleMailbox(inboxId))
    return resend.getThreadEmail(inboxId, threadId, emailId);
  const email = await ctx.runQuery(internal.operatorSendingMailboxes.message, {
    address: inboxId.slice(6),
    messageId: emailId,
  });
  if (!email)
    throw new resend.ResendInboxError(
      "permanent",
      "getThreadEmail",
      "Message not found in this mailbox",
    );
  return { status: "ok", data: email, replayed: false };
}
export async function replyToThreadEmail(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: resend.ReplyToThreadEmailParams,
) {
  if (isOperatorGmailInbox(params.inboxId)) return gmail.replyToGmailThreadEmail();
  assertResendSender(params.inboxId, "replyToThreadEmail");
  return resend.replyToThreadEmail(ctx, actor, params);
}
export function addThreadLabels(
  inboxId: string,
  threadId: string,
  labelIds: string[],
): Promise<resend.ResendInboxResult<resend.ResendInboxLabel[]>> {
  return isGoogleMailbox(inboxId) || isOperatorGmailInbox(inboxId)
    ? Promise.resolve({ status: "ok", data: [], replayed: false })
    : resend.addThreadLabels(inboxId, threadId, labelIds);
}
