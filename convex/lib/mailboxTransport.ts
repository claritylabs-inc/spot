"use node";
/**
 * Resend sends team correspondence. `google:` inbox ids are an operator's
 * connected Gmail (OAuth) and go through the Gmail transport; the retired
 * `gmail:` app-password mailboxes remain readable only. `transportFor` picks
 * the implementation from the inbox id.
 */
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import * as resend from "./resendInbox";
import { readGoogleDraft } from "./googleMailboxTransport";
import { inboxKind, legacyAddressOf } from "./inboxIds";
import * as gmail from "./gmailTransport";
export * from "./resendInbox";

type ThreadEmailOperation = "getThreadEmail" | "replyToThreadEmail" | "addThreadLabels";

type MailboxTransport = {
  createDraft(
    ctx: ActionCtx,
    actor: Id<"users">,
    params: gmail.GmailCreateDraftParams,
  ): Promise<resend.ResendInboxResult<{ id: string }>>;
  sendDraft(
    ctx: ActionCtx,
    actor: Id<"users">,
    params: resend.SendDraftParams,
  ): Promise<resend.ResendInboxResult<{ emailId: string }>>;
  getDraft(
    ctx: ActionCtx,
    inboxId: string,
    draftId: string,
  ): Promise<resend.ResendInboxResult<resend.ResendInboxDraft>>;
  getThreadEmail?(
    ctx: ActionCtx,
    inboxId: string,
    threadId: string,
    emailId: string,
  ): Promise<resend.ResendInboxResult<resend.ResendThreadEmail>>;
  replyToThreadEmail?(
    ctx: ActionCtx,
    actor: Id<"users">,
    params: resend.ReplyToThreadEmailParams,
  ): Promise<resend.ResendInboxResult<{ emailId: string }>>;
  addThreadLabels?(
    inboxId: string,
    threadId: string,
    labelIds: string[],
  ): Promise<resend.ResendInboxResult<resend.ResendInboxLabel[]>>;
  /** The error for an operation this transport does not implement. */
  unsupported(operation: ThreadEmailOperation): resend.ResendInboxError;
};

const noLabels = (): Promise<resend.ResendInboxResult<resend.ResendInboxLabel[]>> =>
  Promise.resolve({ status: "ok", data: [], replayed: false });

const retiredSending = (operation: "createDraft" | "sendDraft" | "replyToThreadEmail") =>
  new resend.ResendInboxError(
    "blocked",
    operation,
    "Google sending has been retired. Review this message using your Resend team address.",
    { code: "google_sending_retired" },
  );

const resendTransport: MailboxTransport = {
  createDraft: (ctx, actor, { references: _references, ...params }) =>
    resend.createDraft(ctx, actor, params),
  sendDraft: resend.sendDraft,
  getDraft: (_ctx, inboxId, draftId) => resend.getDraft(inboxId, draftId),
  getThreadEmail: (_ctx, inboxId, threadId, emailId) =>
    resend.getThreadEmail(inboxId, threadId, emailId),
  replyToThreadEmail: resend.replyToThreadEmail,
  addThreadLabels: resend.addThreadLabels,
  unsupported: (operation) =>
    new resend.ResendInboxError("permanent", operation, "Not supported by Resend inboxes"),
};

const gmailTransport: MailboxTransport = {
  createDraft: gmail.createGmailDraft,
  sendDraft: gmail.sendGmailDraft,
  getDraft: gmail.readGmailDraft,
  addThreadLabels: noLabels,
  // Gmail messages are not stored as inbox thread emails (the team inbox holds
  // them) and Gmail replies are sent from a reviewed draft.
  unsupported: (operation) =>
    operation === "replyToThreadEmail"
      ? new resend.ResendInboxError(
          "permanent",
          operation,
          "Gmail replies are sent from a reviewed draft",
          { code: "gmail_reply_unsupported" },
        )
      : new resend.ResendInboxError(
          "permanent",
          operation,
          "Message not found in this mailbox",
          { code: "gmail_thread_email_unsupported" },
        ),
};

const legacyTransport: MailboxTransport = {
  createDraft: () => Promise.reject(retiredSending("createDraft")),
  sendDraft: () => Promise.reject(retiredSending("sendDraft")),
  getDraft: readGoogleDraft,
  getThreadEmail: async (ctx, inboxId, _threadId, emailId) => {
    const email = await ctx.runQuery(internal.operatorSendingMailboxes.message, {
      address: legacyAddressOf(inboxId),
      messageId: emailId,
    });
    if (!email)
      throw new resend.ResendInboxError(
        "permanent",
        "getThreadEmail",
        "Message not found in this mailbox",
      );
    return { status: "ok", data: email, replayed: false };
  },
  addThreadLabels: noLabels,
  unsupported: (operation) =>
    operation === "replyToThreadEmail"
      ? retiredSending(operation)
      : new resend.ResendInboxError("permanent", operation, "Not supported by Google mailboxes"),
};

const transports = {
  resend: resendTransport,
  gmail: gmailTransport,
  legacy_google: legacyTransport,
};

export function transportFor(inboxId: string): MailboxTransport {
  return transports[inboxKind(inboxId)];
}

export async function createDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: gmail.GmailCreateDraftParams,
) {
  return transportFor(params.inboxId).createDraft(ctx, actor, params);
}

export async function sendDraft(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: resend.SendDraftParams,
) {
  return transportFor(params.inboxId).sendDraft(ctx, actor, params);
}

export async function getDraft(
  ctx: ActionCtx,
  inboxId: string,
  draftId: string,
) {
  return transportFor(inboxId).getDraft(ctx, inboxId, draftId);
}

export async function getThreadEmail(
  ctx: ActionCtx,
  inboxId: string,
  threadId: string,
  emailId: string,
): Promise<resend.ResendInboxResult<resend.ResendThreadEmail>> {
  const transport = transportFor(inboxId);
  if (!transport.getThreadEmail) throw transport.unsupported("getThreadEmail");
  return transport.getThreadEmail(ctx, inboxId, threadId, emailId);
}

export async function replyToThreadEmail(
  ctx: ActionCtx,
  actor: Id<"users">,
  params: resend.ReplyToThreadEmailParams,
) {
  const transport = transportFor(params.inboxId);
  if (!transport.replyToThreadEmail) throw transport.unsupported("replyToThreadEmail");
  return transport.replyToThreadEmail(ctx, actor, params);
}

export function addThreadLabels(
  inboxId: string,
  threadId: string,
  labelIds: string[],
): Promise<resend.ResendInboxResult<resend.ResendInboxLabel[]>> {
  const transport = transportFor(inboxId);
  if (!transport.addThreadLabels) throw transport.unsupported("addThreadLabels");
  return transport.addThreadLabels(inboxId, threadId, labelIds);
}
