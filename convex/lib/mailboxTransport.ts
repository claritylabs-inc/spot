"use node";
/** Provider routing for operator correspondence. Legacy Resend inboxes remain readable. */
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import * as resend from "./resendInbox";
import {
  createGoogleDraft,
  readGoogleDraft,
  sendGoogleDraft,
} from "./googleMailboxTransport";
import { isGoogleMailbox } from "./sendingMailbox";
export * from "./resendInbox";
export async function createDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: resend.CreateDraftParams,
) {
  if (!isGoogleMailbox(params.inboxId))
    return resend.createDraft(ctx, actor, params);
  if ((await import("./resend")).getEmailDeliveryMode() === "capture")
    return resend.createDraft(ctx, actor, params);
  return createGoogleDraft(ctx, actor, params);
}
export async function sendDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: resend.SendDraftParams,
) {
  if (!isGoogleMailbox(params.inboxId))
    return resend.sendDraft(ctx, actor, params);
  return sendGoogleDraft(ctx, actor, params.inboxId, params.draftId);
}
export async function getDraft(
  ctx: ActionCtx,
  inboxId: string,
  draftId: string,
) {
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
  if (!isGoogleMailbox(params.inboxId))
    return resend.replyToThreadEmail(ctx, actor, params);
  const target = await getThreadEmail(
    ctx,
    params.inboxId,
    params.threadId,
    params.emailId,
  );
  if (target.status !== "ok") throw new Error("Reply target unavailable");
  const to =
    target.data.direction === "outbound" ? target.data.to : [target.data.from];
  const created = await createDraft(ctx, actor, {
    inboxId: params.inboxId,
    to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject ?? `Re: ${target.data.subject ?? ""}`,
    text: params.text,
    html: params.html,
    threadId: params.threadId,
    replyToEmailId: params.emailId,
    idempotencyKey: params.idempotencyKey + ":draft",
  });
  if (created.status !== "ok") return created;
  return sendDraft(ctx, actor, {
    inboxId: params.inboxId,
    draftId: created.data.id,
    idempotencyKey: params.idempotencyKey,
  });
}
export function addThreadLabels(
  inboxId: string,
  threadId: string,
  labelIds: string[],
): Promise<resend.ResendInboxResult<resend.ResendInboxLabel[]>> {
  return isGoogleMailbox(inboxId)
    ? Promise.resolve({ status: "ok", data: [], replayed: false })
    : resend.addThreadLabels(inboxId, threadId, labelIds);
}
