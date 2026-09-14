"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildEmailPayload, type EmailAttachmentMeta } from "./emailDelivery";
import { buildEmailSignature, getEmailAgentFromName } from "./emailIdentity";

export type EmailDraftArtifactContext = {
  orgId: Id<"organizations">;
  threadId?: Id<"threads">;
  chatMessageId?: Id<"threadMessages">;
  channel: "web" | "email" | "imessage" | "slack" | "mcp";
  fromHeader: string;
  agentAddress: string;
  replyTo?: string;
  senderEmail?: string;
  defaultBcc?: string[];
  inReplyTo?: string;
  references?: string;
};

export type EmailDraftArtifactParams = {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: EmailAttachmentMeta[];
  referencedPolicyIds?: Id<"policies">[];
  sendBlockedReason?: string;
};

export async function upsertEmailDraftArtifact(
  ctx: ActionCtx,
  context: EmailDraftArtifactContext,
  params: EmailDraftArtifactParams,
): Promise<Id<"pendingEmails"> | undefined> {
  if (
    !["web", "imessage", "mcp"].includes(context.channel) ||
    !context.threadId
  ) {
    return undefined;
  }

  const signature = buildEmailSignature(context.agentAddress);
  const emailPayload = buildEmailPayload({
    fromHeader: context.fromHeader,
    to: params.to,
    cc: params.cc,
    bcc: params.bcc,
    subject: params.subject,
    body: params.body,
    signature,
    inReplyTo: context.inReplyTo,
    references: context.references,
    replyTo: context.replyTo,
  });

  const existing = await ctx.runQuery(
    internal.pendingEmails.findDraftByThreadAndRecipient,
    {
      threadId: context.threadId,
      recipientEmail: params.to,
    },
  );

  if (existing) {
    await ctx.runMutation(internal.pendingEmails.updateDraftInternal, {
      id: existing._id,
      recipientEmail: params.to,
      ccAddresses: params.cc.length > 0 ? params.cc : undefined,
      bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
      subject: params.subject,
      emailBody: params.body,
      fromHeader: context.fromHeader,
      replyTo: context.replyTo,
      inReplyTo: context.inReplyTo,
      references: context.references,
      renderedText: emailPayload.text,
      renderedHtml: emailPayload.html,
      attachments:
        params.attachments.length > 0 ? params.attachments : undefined,
      referencedPolicyIds: params.referencedPolicyIds,
      sendBlockedReason: params.sendBlockedReason,
      chatMessageId: context.chatMessageId,
    });
    if (existing.threadMessageId) {
      await ctx.runMutation(internal.threads.updateEmailMessage, {
        id: existing.threadMessageId,
        content: params.body,
        toAddresses: [params.to],
        ccAddresses: params.cc,
        bccAddresses: params.bcc,
        subject: params.subject,
        attachments: params.attachments,
        pendingEmailId: existing._id,
        status: "draft_email",
      });
    }
    if (context.chatMessageId) {
      await ctx.runMutation(internal.threads.attachPendingEmailToAgentMessage, {
        id: context.chatMessageId,
        pendingEmailId: existing._id,
      });
    }
    return existing._id;
  }

  const pendingEmailId = await ctx.runMutation(internal.pendingEmails.create, {
    orgId: context.orgId,
    threadId: context.threadId,
    scheduledSendTime: 0,
    chatMessageId: context.chatMessageId,
    recipientEmail: params.to,
    ccAddresses: params.cc.length > 0 ? params.cc : undefined,
    bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
    subject: params.subject,
    emailBody: params.body,
    fromHeader: context.fromHeader,
    replyTo: context.replyTo,
    inReplyTo: context.inReplyTo,
    references: context.references,
    renderedText: emailPayload.text,
    renderedHtml: emailPayload.html,
    attachments: params.attachments.length > 0 ? params.attachments : undefined,
    referencedPolicyIds: params.referencedPolicyIds,
    sendBlockedReason: params.sendBlockedReason,
    status: "draft",
  });
  const draftMessageId = await ctx.runMutation(
    internal.threads.insertEmailMessage,
    {
      threadId: context.threadId,
      orgId: context.orgId,
      role: "agent",
      fromEmail: context.agentAddress,
      fromName: getEmailAgentFromName(),
      content: params.body,
      toAddresses: [params.to],
      ccAddresses: params.cc.length > 0 ? params.cc : undefined,
      bccAddresses: params.bcc.length > 0 ? params.bcc : undefined,
      subject: params.subject,
      attachments:
        params.attachments.length > 0 ? params.attachments : undefined,
      status: "draft_email",
      pendingEmailId,
    },
  );
  await ctx.runMutation(internal.pendingEmails.setThreadMessage, {
    id: pendingEmailId,
    threadMessageId: draftMessageId,
  });
  if (context.chatMessageId) {
    await ctx.runMutation(internal.threads.attachPendingEmailToAgentMessage, {
      id: context.chatMessageId,
      pendingEmailId,
    });
  }

  return pendingEmailId;
}

export async function queueEmailDraftArtifact(
  ctx: ActionCtx,
  context: EmailDraftArtifactContext,
  params: EmailDraftArtifactParams & {
    scheduledSendTime: number;
    explicitSendAuthorization?: {
      actorUserId: Id<"users">;
      sourceMessageId: Id<"threadMessages">;
    };
  },
): Promise<Id<"pendingEmails"> | undefined> {
  const pendingEmailId = await upsertEmailDraftArtifact(ctx, context, params);
  if (!pendingEmailId) return undefined;

  await ctx.runMutation(internal.pendingEmails.scheduleDraftInternal, {
    id: pendingEmailId,
    scheduledSendTime: params.scheduledSendTime,
    explicitSendAuthorization: params.explicitSendAuthorization,
  });
  return pendingEmailId;
}
