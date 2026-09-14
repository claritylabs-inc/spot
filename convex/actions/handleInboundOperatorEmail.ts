"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  authenticateOperatorEmail,
  MAX_OPERATOR_EMAIL_RAW_BYTES,
} from "../lib/operatorEmailAuthentication";
import { readResponseBytesWithinLimit } from "../lib/websiteBrand";
import {
  assertAgentAttachmentLimits,
  normalizeAgentAttachmentFilename,
} from "../lib/agentAttachmentLimits";
import {
  formatInboundEmailForAgent,
  htmlToPlainText,
  parseInboundEmail,
  storedInboundEmailContent,
} from "../lib/inboundEmailParser";
import { getAuthSiteUrl } from "../lib/domains";
import { sendResendEmail } from "../lib/resend";
import {
  OPERATOR_EMAIL_ADDRESS,
  OPERATOR_EMAIL_DOMAIN,
  operatorEmailThreadToken,
} from "../lib/operatorEmailAddress";

export const processInbound = internalAction({
  args: { emailId: v.string() },
  handler: async (ctx, { emailId }) => {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(emailId))
      throw new Error("Invalid received email ID");
    const received = await fetch(
      `https://api.resend.com/emails/receiving/${emailId}`,
      {
        headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!received.ok) throw new Error("Could not retrieve operator email");
    const envelope = (await received.json()) as {
      raw?: { download_url?: string };
    };
    if (!envelope.raw?.download_url)
      throw new Error("Original operator email is unavailable");
    const rawResponse = await fetch(envelope.raw.download_url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!rawResponse.ok)
      throw new Error("Could not retrieve original operator email");
    const raw = Buffer.from(
      await readResponseBytesWithinLimit(
        rawResponse,
        MAX_OPERATOR_EMAIL_RAW_BYTES,
      ),
    );
    const mail = await authenticateOperatorEmail(raw);
    const sender = mail.from!.value[0].address!.toLowerCase();
    const identity = await ctx.runQuery(
      internal.operatorEmail.resolveIdentity,
      { email: sender },
    );
    if (!identity) return;
    const recipients = [mail.to, mail.cc].flatMap((value) =>
      (Array.isArray(value) ? value : value ? [value] : []).flatMap((group) =>
        group.value.map((address) => address.address?.toLowerCase() ?? ""),
      ),
    );
    const tokens = [
      ...new Set(
        recipients.flatMap((address) => {
          const token = operatorEmailThreadToken(address);
          return token ? [token] : [];
        }),
      ),
    ];
    if (tokens.length > 1)
      throw new Error("Email addresses more than one operator thread");
    const sourceText = mail.text?.trim()
      ? mail.text
      : mail.html
        ? htmlToPlainText(mail.html, mail.html.length, true)
        : "";
    const parsed = parseInboundEmail({
      subject: mail.subject,
      text: sourceText.slice(0, 18_000),
    });
    const text = formatInboundEmailForAgent(parsed);
    const subject = (mail.subject?.trim() || "Email to Spot").slice(0, 200);
    const truncated = sourceText.length > 18_000;
    const body = `${text.slice(0, 18_000).trim()}${truncated ? "\n\n[Full email attached as forwarded-email.txt]" : ""}`;
    const files = mail.attachments.map((attachment) => ({
      filename: normalizeAgentAttachmentFilename(
        attachment.filename || "attachment",
      ),
      contentType: attachment.contentType,
      size: attachment.content.length,
      bytes: attachment.content,
    }));
    if (truncated) {
      const bytes = Buffer.from(sourceText);
      files.push({
        filename: "forwarded-email.txt",
        contentType: "text/plain",
        size: bytes.length,
        bytes,
      });
    }
    assertAgentAttachmentLimits(files);
    const attachments: Array<{
      fileId: Id<"_storage">;
      filename: string;
      contentType: string;
      size: number;
    }> = [];
    try {
      for (const file of files) {
        const fileId = await ctx.storage.store(
          new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
        );
        attachments.push({
          fileId,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
        });
      }
      const result = await ctx.runMutation(internal.operatorEmail.accept, {
        providerId: emailId,
        messageId: mail.messageId!,
        sender,
        subject,
        content: `Subject: ${subject}${body ? `\n\n${body}` : ""}`,
        emailContent: {
          ...storedInboundEmailContent(parsed),
          subject,
          currentText: parsed.currentText,
          parseInputTruncated: truncated,
        },
        threadToken: tokens[0],
        attachments,
      });
      if (!result.duplicate) return;
    } catch (error) {
      await ctx.runMutation(
        internal.operatorAgent.deleteUnreferencedAttachmentsInternal,
        { fileIds: attachments.map((file) => file.fileId) },
      );
      throw error;
    }
    await ctx.runMutation(
      internal.operatorAgent.deleteUnreferencedAttachmentsInternal,
      { fileIds: attachments.map((file) => file.fileId) },
    );
  },
});

export const deliver = internalAction({
  args: { receiptId: v.id("operatorEmailReceipts") },
  handler: async (ctx, args): Promise<void> => {
    const context = await ctx.runQuery(
      internal.operatorEmail.getDeliveryContext,
      args,
    );
    if (!context) return;
    const { receipt, run, response, confirmation } = context;
    if (run.status === "queued" || run.status === "running") {
      await ctx.scheduler.runAfter(
        5_000,
        internal.actions.handleInboundOperatorEmail.deliver,
        args,
      );
      return;
    }
    const waiting = run.status === "waiting_confirmation";
    const phase = waiting
      ? `confirmation:${confirmation?._id ?? run._id}`
      : `terminal:${run.status}`;

    const threadUrl = `${getAuthSiteUrl()}/operator/threads/${receipt.threadId}`;
    const content =
      run.status === "failed" || run.status === "cancelled"
        ? `This task ${run.status}. Open the operator thread for details.`
        : response?.content || "Your operator task has an update.";
    const approval = waiting
      ? `\n\nApproval required: ${confirmation?.payload.summary ?? "Review the proposed action"}\nApprove or cancel in the operator thread: ${threadUrl}`
      : "";
    const text = `${content}${approval}\n\n${response?.attachments?.length ? "Files and " : ""}Conversation: ${threadUrl}`;
    const claim = await ctx.runMutation(internal.operatorEmail.claimDelivery, {
      receiptId: receipt._id,
      phase,
      text,
    });
    if (claim) {
      try {
        const sent = await sendResendEmail(
          {
            from: `Spot Operator <${OPERATOR_EMAIL_ADDRESS}>`,
            to: receipt.sender,
            reply_to: `operator+${receipt.threadId}@${OPERATOR_EMAIL_DOMAIN}`,
            subject: /^re:/i.test(receipt.subject)
              ? receipt.subject
              : `Re: ${receipt.subject}`,
            text: claim.text,
            headers: {
              "Message-ID": claim.messageId,
              "In-Reply-To": receipt.messageId,
              References: receipt.messageId,
            },
          },
          { retries: 2, idempotencyKey: `operator-email:${claim.id}` },
        );
        await ctx.runMutation(internal.operatorEmail.finishDelivery, {
          deliveryId: claim.id,
          attempts: claim.attempts,
          sent: sent.ok,
        });
      } catch (error) {
        await ctx.runMutation(internal.operatorEmail.finishDelivery, {
          deliveryId: claim.id,
          attempts: claim.attempts,
          sent: false,
        });
        console.error("Operator email response delivery failed", error);
      }
    }
    if (waiting && !claim)
      await ctx.scheduler.runAfter(
        60_000,
        internal.actions.handleInboundOperatorEmail.deliver,
        args,
      );
  },
});
