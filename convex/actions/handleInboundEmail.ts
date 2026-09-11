"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { stepCountIs, type ModelMessage } from "ai";
import {
  AGENT_MAX_OUTPUT_TOKENS,
  runAgentTurn,
} from "../lib/channelAgentRunner";
import {
  extractPolicyAttachment,
  createImessageGroupChat,
  searchConnectedEmail,
  readConnectedEmail,
  readConnectedEmailAttachment,
  importConnectedEmailPolicyAttachments,
  importConnectedEmailRequirementAttachments,
  sendConnectedVendorInvite,
  coordinateMailboxTask,
  webResearch,
} from "../lib/chatTools";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import { Webhook } from "svix";
import {
  formatPolicyFocusHints,
  selectPolicyFocusIds,
  validatePolicyFocusIds,
} from "../lib/agentPolicyFocus";
import type { Doc, Id } from "../_generated/dataModel";
import {
  sendResendEmail,
  getAgentDomain,
  getAgentDomains,
  getAgentRecipientAddresses,
  isSpotOutboundAddress,
} from "../lib/resend";
import {
  buildSystemPromptForContext,
  buildChannelInstructions,
  buildPolicyToolInstructions,
  stripMarkdown,
} from "../lib/aiUtils";
import {
  buildAgentAttachmentParts,
  MAX_AGENT_ATTACHMENT_TEXT_CHARS,
} from "../lib/agentAttachmentContext";
import {
  classifyPromptInjection,
  collectAllowedRecipients,
  enforceInputLimits,
} from "../lib/security";
import { getClientPortalUrl } from "../lib/domains";
import {
  buildEmailExpertTool,
  buildAgentEmailHtmlBody,
  buildEmailSignature,
  getEmailAgentFromName,
  toResendAttachments,
  type EmailAttachmentMeta,
  type EmailSubagentResult,
} from "../lib/emailSubagent";
import { FATAL_ACTION_FAILED_MESSAGE } from "../lib/actionFailures";
import {
  buildRecentAgentConversationContext,
  buildTextModelHistory,
  buildThreadContinuityPrompt,
  buildThreadHistoryToolInstructions,
} from "../lib/agentMessageHistory";
import { cleanAgentMarkdownForTransport } from "../lib/transportRenderers";
import {
  loadBoundedAgentHistory,
  scheduleThreadHistoryCompaction,
} from "../lib/agentHistoryLoader";
import { runWebRetrieval, type WebRetrievalInput } from "../lib/webRetrieval";
import { buildEmailDraftTextSummary } from "../lib/emailDraftSummary";
import { runInboundEmailDeterministicControls } from "../lib/inboundEmailDeterministicControls";
import {
  buildRequirementImportConfirmation,
  confirmedRequirementImportMessage,
  decideRequirementAttachmentImport,
  importConfirmedRequirementSources,
  requiredRequirementImportStep,
} from "../lib/requirementAttachmentIntent";
import {
  formatInboundEmailForAgent,
  extractPendingEmailIdsFromHeaders,
  hasEmailParticipantEvidence,
  parseInboundEmail,
  resolveForwardReplyAddress,
  storedInboundEmailContent,
} from "../lib/inboundEmailParser";
import { decideForwardReplyDirection } from "../lib/forwardReplyDirection";
import { executeEmailCommand } from "../lib/emailCommandExecutor";
import { isContextualConfirmation } from "../lib/textChannelControls";
import {
  isPendingEmailCancelConfirmation,
  isPendingEmailCancelIntent,
} from "../lib/emailCancelIntent";
import {
  buildPendingEmailConfirmation,
  pendingEmailDraftFingerprint,
} from "../lib/actionConfirmationFingerprint";
import { extractEmailAddress } from "../lib/emailAddress";
import {
  procurementInboxTokenFromAddresses,
  uniqueProcurementEmails,
} from "../lib/procurement";

const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "mail.com",
  "ymail.com",
  "gmx.com",
  "gmx.net",
]);

function getCompanyDomains(
  org: { website?: string },
  memberEmails: string[],
): string[] {
  const domains: string[] = [];
  if (org.website) {
    try {
      const hostname = new URL(org.website).hostname.replace(/^www\./, "");
      if (!CONSUMER_DOMAINS.has(hostname)) domains.push(hostname);
    } catch {
      /* ignore invalid URLs */
    }
  }
  for (const email of memberEmails) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain && !CONSUMER_DOMAINS.has(domain) && !domains.includes(domain)) {
      domains.push(domain);
    }
  }
  return domains;
}

interface WebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    message_id?: string;
    attachments?: unknown[];
  };
}

interface ReceivedEmailContent {
  html?: string;
  text?: string;
  headers?: unknown;
}

function extractName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : undefined;
}

function parseAddressList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((address) => extractEmailAddress(address) ?? []);
  }
  return raw
    .split(",")
    .flatMap((address) => extractEmailAddress(address) ?? []);
}

function findAgentHandle(
  addresses: string[],
): { handle: string; threadSuffix?: string } | null {
  for (const addr of addresses) {
    const domain = addr.split("@").pop()?.toLowerCase();
    if (domain && getAgentDomains().includes(domain)) {
      const localPart = addr.split("@")[0];
      // Parse handle+threadSuffix format (e.g. "company+abc12345@agent.domain")
      const plusIdx = localPart.indexOf("+");
      if (plusIdx !== -1) {
        return {
          handle: localPart.slice(0, plusIdx),
          threadSuffix: localPart.slice(plusIdx + 1),
        };
      }
      return { handle: localPart };
    }
  }
  return null;
}

interface AttachmentMeta {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  download_url: string;
}

interface DownloadedAttachment {
  filename: string;
  content_type: string;
  size: number;
  buffer: Buffer;
}

type PendingEmailConfirmationPrompt = {
  content: string;
  dedupeKey: string;
  pendingEmailId?: Id<"pendingEmails">;
  payload: Doc<"threadActionConfirmations">["payload"];
};

type EmailThreadMode = "direct" | "cc" | "forward" | "unknown";

type InboundThreadResolution = {
  existingThreadId?: Id<"threads">;
  threadRootMode?: EmailThreadMode;
  matchedParentEmailMessage: Doc<"threadMessages"> | null;
  correlatedPendingEmailId?: Id<"pendingEmails">;
};

const SUPPORTED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

async function fetchAttachments(
  emailId: string,
): Promise<DownloadedAttachment[]> {
  const downloaded: DownloadedAttachment[] = [];

  try {
    const res = await fetch(
      `https://api.resend.com/emails/receiving/${emailId}/attachments`,
      {
        headers: {
          Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
        },
      },
    );
    if (!res.ok) {
      console.warn(`Failed to fetch attachments (${res.status})`);
      return [];
    }

    const body = await res.json();
    const attachments: AttachmentMeta[] = body.data ?? body ?? [];

    for (const att of attachments) {
      if (att.size > MAX_ATTACHMENT_SIZE) continue;

      try {
        const dlRes = await fetch(att.download_url);
        if (!dlRes.ok) continue;

        const buffer = Buffer.from(await dlRes.arrayBuffer());
        downloaded.push({
          filename: att.filename,
          content_type: att.content_type,
          size: att.size,
          buffer,
        });
      } catch (err) {
        console.warn(`Failed to download attachment ${att.filename}:`, err);
      }
    }
  } catch (err) {
    console.warn("Failed to fetch attachment list:", err);
  }

  return downloaded;
}

async function fetchEmailContent(
  emailId: string,
): Promise<ReceivedEmailContent> {
  const res = await fetch(
    `https://api.resend.com/emails/receiving/${emailId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
      },
    },
  );
  if (!res.ok) {
    console.warn(
      `Failed to fetch from receiving API (${res.status}), trying sent emails API...`,
    );
    const fallback = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: {
        Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
      },
    });
    if (!fallback.ok) {
      const errorText = await fallback.text();
      console.error("Both APIs failed. Proceeding without body.", errorText);
      return {};
    }
    return fallback.json();
  }
  return res.json();
}

async function hasPriorParticipantEvidence(
  ctx: ActionCtx,
  threadId: Id<"threads">,
  fromEmail: string,
): Promise<boolean> {
  const messages = await ctx.runQuery(internal.threads.getEmailHistory, {
    threadId,
  });
  return hasEmailParticipantEvidence(messages, fromEmail);
}

async function getPendingEmailFromCapturedId(
  ctx: ActionCtx,
  capturedId: string,
): Promise<Doc<"pendingEmails"> | null> {
  try {
    // The internal query's v.id("pendingEmails") argument validator verifies
    // both the Convex ID encoding and table before its handler can run.
    return (await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: capturedId as Id<"pendingEmails">,
    })) as Doc<"pendingEmails"> | null;
  } catch {
    return null;
  }
}

async function resolveInboundThread(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    fromEmail: string;
    subject: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    threadSuffix?: string;
    agentAddressWithSuffix?: string | null;
  },
): Promise<InboundThreadResolution> {
  let existingThreadId: Id<"threads"> | undefined;
  let threadRootMode: EmailThreadMode | undefined;
  let matchedParentEmailMessage: Doc<"threadMessages"> | null = null;
  let correlatedPendingEmailId: Id<"pendingEmails"> | undefined;

  const replyMessageIdCandidates = [
    args.inReplyTo,
    ...(args.references ? args.references.trim().split(/\s+/).reverse() : []),
  ].filter((value): value is string => Boolean(value?.trim()));

  const deterministicPendingEmailIds = extractPendingEmailIdsFromHeaders([
    args.messageId,
    args.inReplyTo,
    args.references,
  ]);
  for (const pendingEmailId of deterministicPendingEmailIds) {
    const pending = await getPendingEmailFromCapturedId(ctx, pendingEmailId);
    if (!pending || pending.orgId !== args.orgId) continue;
    correlatedPendingEmailId = pending._id;
    if (pending.threadMessageId) {
      matchedParentEmailMessage = await ctx
        .runQuery(internal.threads.getMessageInternal, {
          id: pending.threadMessageId,
        })
        .catch(() => null);
    }
    if (pending.threadId) {
      existingThreadId = pending.threadId;
      const parentThread = await ctx.runQuery(internal.threads.getInternal, {
        id: pending.threadId,
      });
      threadRootMode = parentThread?.emailMode;
    }
    break;
  }

  for (const candidate of [...new Set(replyMessageIdCandidates)]) {
    if (matchedParentEmailMessage) break;
    const matched = await ctx.runQuery(
      internal.threads.findEmailMessageByMessageId,
      { orgId: args.orgId, messageId: candidate },
    );
    if (!matched) continue;
    matchedParentEmailMessage = matched;
    existingThreadId = matched.threadId;
    correlatedPendingEmailId = matched.pendingEmailId;
    const parentThread = await ctx.runQuery(internal.threads.getInternal, {
      id: matched.threadId,
    });
    threadRootMode = parentThread?.emailMode;
    break;
  }

  if (!existingThreadId && args.threadSuffix && args.agentAddressWithSuffix) {
    const unifiedThread = await ctx.runQuery(internal.threads.findByEmail, {
      threadEmail: args.agentAddressWithSuffix,
    });
    if (unifiedThread) {
      existingThreadId = unifiedThread._id;
      threadRootMode = unifiedThread.emailMode;
    }
  }

  if (!existingThreadId && args.inReplyTo) {
    const parent = await ctx.runQuery(
      internal.threads.findThreadByEmailMessageId,
      { orgId: args.orgId, messageId: args.inReplyTo },
    );
    if (parent) {
      existingThreadId = parent._id;
      threadRootMode = parent.emailMode;
    }
  }

  if (!existingThreadId) {
    const subjectMatch = await ctx.runQuery(
      internal.threads.findEmailThreadBySubject,
      { orgId: args.orgId, subject: args.subject, fromEmail: args.fromEmail },
    );
    const hasReferenceEvidence = replyMessageIdCandidates.length > 0;
    const hasParticipantEvidence = subjectMatch
      ? await hasPriorParticipantEvidence(ctx, subjectMatch._id, args.fromEmail)
      : false;
    if (subjectMatch && (hasReferenceEvidence || hasParticipantEvidence)) {
      existingThreadId = subjectMatch._id;
      threadRootMode = subjectMatch.emailMode;
    }
  }

  return {
    existingThreadId,
    threadRootMode,
    matchedParentEmailMessage,
    correlatedPendingEmailId,
  };
}

export const processInbound = internalAction({
  args: {
    payload: v.string(),
    svixId: v.string(),
    svixTimestamp: v.string(),
    svixSignature: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify webhook signature
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (webhookSecret) {
      const wh = new Webhook(webhookSecret);
      try {
        wh.verify(args.payload, {
          "svix-id": args.svixId,
          "svix-timestamp": args.svixTimestamp,
          "svix-signature": args.svixSignature,
        });
      } catch (err) {
        console.error("Webhook signature verification failed:", err);
        throw new Error("Invalid webhook signature");
      }
    } else {
      console.warn(
        "RESEND_WEBHOOK_SECRET not set — skipping signature verification",
      );
    }

    const webhook: WebhookPayload = JSON.parse(args.payload);
    const data = webhook.data ?? webhook;

    // Dedup
    const resendEmailId = data.email_id;
    if (resendEmailId || data.message_id) {
      const isDuplicate = await ctx.runQuery(
        internal.threads.checkDuplicateEmail,
        {
          resendEmailId: resendEmailId || undefined,
          messageId: data.message_id || undefined,
        },
      );
      if (isDuplicate) {
        console.log(
          "Duplicate webhook - already processed email:",
          resendEmailId ?? data.message_id,
        );
        return;
      }
    }

    const fromEmail = extractEmailAddress(data.from) ?? "";
    const fromName = extractName(data.from);
    const toAddresses = parseAddressList(data.to);
    const ccAddresses = parseAddressList(data.cc);
    const bccAddresses = parseAddressList(data.bcc);
    const allAddresses = [...toAddresses, ...ccAddresses, ...bccAddresses];

    if (!fromEmail) {
      console.error("No from address found in payload");
      return;
    }

    // Loop prevention
    if (isSpotOutboundAddress(fromEmail)) {
      console.log(
        "Loop prevention: ignoring email from agent domain",
        fromEmail,
      );
      return;
    }

    const procurementInboxToken = procurementInboxTokenFromAddresses(
      allAddresses,
      getAgentDomains(),
    );
    if (procurementInboxToken) {
      const resolvedProcurementInbox = await ctx.runQuery(
        internal.procurementRequests.resolveInboxInternal,
        { inboxToken: procurementInboxToken },
      );
      if (!resolvedProcurementInbox) {
        console.warn("Unknown procurement forwarding address");
        return;
      }

      const emailContent = data.email_id
        ? await fetchEmailContent(data.email_id)
        : {};
      const parsedInboundEmail = parseInboundEmail({
        subject: data.subject,
        text: emailContent.text,
        html: emailContent.html,
      });
      const rawHeaders = emailContent.headers;
      const header = (name: string) => {
        const lower = name.toLowerCase();
        if (Array.isArray(rawHeaders)) {
          return (rawHeaders as Array<{ name?: string; value?: string }>).find(
            (item) => item.name?.toLowerCase() === lower,
          )?.value;
        }
        if (rawHeaders && typeof rawHeaders === "object") {
          return (
            (rawHeaders as Record<string, string>)[lower] ??
            (rawHeaders as Record<string, string>)[name]
          );
        }
        return undefined;
      };
      const inReplyTo = header("In-Reply-To");
      const references =
        header("References")?.trim().split(/\s+/).filter(Boolean) ?? [];
      const forwardedParticipants = parsedInboundEmail.forwarded
        ? [
            parsedInboundEmail.forwarded.email.from?.address,
            ...parsedInboundEmail.forwarded.email.to.map(
              (mailbox) => mailbox.address,
            ),
            ...parsedInboundEmail.forwarded.email.cc.map(
              (mailbox) => mailbox.address,
            ),
          ].filter((address): address is string => Boolean(address))
        : [];
      const participantEmails = uniqueProcurementEmails(
        forwardedParticipants.length > 0
          ? forwardedParticipants
          : [fromEmail, ...toAddresses, ...ccAddresses, ...bccAddresses],
      ).filter(
        (address) =>
          !address
            .slice(0, address.lastIndexOf("@"))
            .startsWith("procurement+"),
      );
      const downloaded = data.email_id
        ? await fetchAttachments(data.email_id)
        : [];
      const storedAttachments = [];
      for (const attachment of downloaded) {
        const bytes = new Uint8Array(attachment.buffer);
        const fileId = await ctx.storage.store(
          new Blob([bytes], { type: attachment.content_type }),
        );
        storedAttachments.push({
          fileId,
          filename: attachment.filename,
          contentType: attachment.content_type,
          size: attachment.size,
        });
      }
      const receivedAt = dayjs(webhook.created_at).isValid()
        ? dayjs(webhook.created_at).valueOf()
        : dayjs().valueOf();
      await ctx.runMutation(internal.procurementRequests.ingestEmailInternal, {
        addressedRequestId: resolvedProcurementInbox.request._id,
        resendEmailId: resendEmailId || undefined,
        messageId: data.message_id,
        inReplyTo,
        references,
        subject: data.subject ?? "(no subject)",
        fromName,
        fromEmail,
        toAddresses,
        ccAddresses,
        bccAddresses,
        currentText: parsedInboundEmail.currentText,
        bodyHtml: parsedInboundEmail.rawHtml,
        forwarded: parsedInboundEmail.forwarded,
        participantEmails,
        attachments: storedAttachments,
        receivedAt,
      });
      return;
    }

    // Find agent handle (may include +threadSuffix for thread-specific routing)
    const handleResult = findAgentHandle(allAddresses);
    if (!handleResult) {
      console.log("No agent handle found in recipients:", allAddresses);
      return;
    }
    const { handle, threadSuffix } = handleResult;

    // Resolve the broker org that owns this handle, then figure out which of
    // their clients the sender is acting for.
    const resolved = await ctx.runQuery(internal.orgs.resolveClientBySender, {
      handle,
      senderEmail: fromEmail,
    });
    if (!resolved) {
      console.log("No organization found for handle:", handle);
      if (handle !== "agent") return;
      const emailContent = data.email_id
        ? await fetchEmailContent(data.email_id)
        : {};
      const parsedInboundEmail = parseInboundEmail({
        subject: data.subject,
        text: emailContent.text,
        html: emailContent.html,
      });
      const bodyForAgent = formatInboundEmailForAgent(parsedInboundEmail);
      const guardedInput = enforceInputLimits(
        [data.subject ?? "", bodyForAgent].join("\n\n"),
      );
      const injectionCheck = await classifyPromptInjection(ctx, guardedInput);
      if (!injectionCheck.safe) {
        console.warn(
          "[security] Prompt injection blocked in public demo email",
          {
            audit: injectionCheck.audit,
          },
        );
        return;
      }

      const agentAddress = `${handle}@${getAgentDomain()}`;
      const demo = await ctx.runAction(
        internal.actions.publicDemoAgent.respond,
        {
          channel: "email",
          senderContact: fromEmail,
          messageText: bodyForAgent || data.subject || "Tell me about Spot.",
          subject: data.subject,
          fromName,
          fromEmail,
          agentAddress,
          sourceMessageId: data.message_id,
          resendEmailId: resendEmailId || undefined,
        },
      );
      const subject = data.subject
        ? /^re:/i.test(data.subject)
          ? data.subject
          : `Re: ${data.subject}`
        : "Re: Spot product demo";
      const headers: Record<string, string> = {};
      if (data.message_id) {
        headers["In-Reply-To"] = data.message_id;
        headers["References"] = data.message_id;
      }
      const result = await sendResendEmail({
        from: `Spot <${agentAddress}>`,
        to: fromEmail,
        subject,
        html: demo.html,
        text: demo.text,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      await ctx.runMutation(internal.publicDemo.patchChatLogDelivery, {
        id: demo.outboundLogId,
        deliveryStatus: result.ok ? "sent" : "failed",
        deliveryId: result.ok ? result.id : result.error,
      });
      if (!result.ok) {
        console.warn("Failed to send public demo email:", result.error);
      }
      return;
    }
    const { org } = resolved;
    const orgId = org._id;

    const orgMembers = await ctx.runQuery(internal.orgs.getMembersInternal, {
      orgId,
    });
    const memberEmails = orgMembers.flatMap((membership) =>
      membership.user?.email ? [membership.user.email] : [],
    );
    const firstAdmin = orgMembers.find(
      (membership) => membership.role === "admin",
    );

    const senderMember = orgMembers.find(
      (membership) =>
        membership.user?.email?.toLowerCase() === fromEmail.toLowerCase(),
    );
    const primaryUserId =
      senderMember?.userId ??
      org.primaryInsuranceContactId ??
      firstAdmin?.userId;

    if (!primaryUserId) {
      console.log("No primary user found for org:", orgId);
      return;
    }

    // Fetch full email content and attachments from Resend API
    const emailContent = await fetchEmailContent(data.email_id);
    const parsedInboundEmail = parseInboundEmail({
      subject: data.subject,
      text: emailContent.text,
      html: emailContent.html,
    });
    const body = parsedInboundEmail.currentText;
    const bodyForAgent = formatInboundEmailForAgent(parsedInboundEmail);
    const bodyHtml = parsedInboundEmail.rawHtml;
    const attachments = await fetchAttachments(data.email_id);

    const guardedInput = enforceInputLimits(
      [data.subject ?? "", bodyForAgent].join("\n\n"),
    );
    const injectionCheck = await classifyPromptInjection(
      ctx,
      guardedInput,
      orgId,
    );
    if (!injectionCheck.safe) {
      console.warn("[security] Prompt injection blocked in inbound email", {
        audit: injectionCheck.audit,
      });
      return;
    }

    // Detect mode
    // agentAddress is the canonical address (without +suffix) — used for outbound from and reply-to
    const agentAddress = `${handle}@${getAgentDomain()}`;
    const acceptedAgentAddresses = new Set(
      getAgentRecipientAddresses(handle, threadSuffix),
    );
    const isAgentAddr = (addr: string) => acceptedAgentAddresses.has(addr);
    const agentAddressWithSuffix = threadSuffix
      ? (allAddresses.find(
          (addr) => addr.includes(`+${threadSuffix}@`) && isAgentAddr(addr),
        ) ?? `${handle}+${threadSuffix}@${getAgentDomain()}`)
      : null;

    const fromHeader = `${getEmailAgentFromName()} <${agentAddress}>`;
    const agentInTo = toAddresses.some(isAgentAddr);
    const agentInCc = ccAddresses.some(isAgentAddr);
    const otherToRecipients = toAddresses.filter((a) => !isAgentAddr(a));

    const senderDomain = fromEmail.split("@")[1]?.toLowerCase();
    const companyDomains = getCompanyDomains(org, memberEmails);
    const isInternal = !!(
      senderDomain && companyDomains.includes(senderDomain)
    );

    const isForwarded = Boolean(parsedInboundEmail.forwarded);

    const mode: EmailThreadMode =
      isInternal && isForwarded
        ? "forward"
        : agentInCc
          ? "cc"
          : isInternal && agentInTo && otherToRecipients.length > 0
            ? "cc"
            : agentInTo && otherToRecipients.length === 0
              ? "direct"
              : "unknown";

    // Threading
    const messageId = data.message_id;
    const rawHeaders = emailContent.headers;

    function getHeader(name: string): string | undefined {
      const lower = name.toLowerCase();
      if (Array.isArray(rawHeaders)) {
        return (rawHeaders as Array<{ name?: string; value?: string }>).find(
          (h) => h.name?.toLowerCase() === lower,
        )?.value;
      } else if (rawHeaders && typeof rawHeaders === "object") {
        return (
          (rawHeaders as Record<string, string>)[lower] ??
          (rawHeaders as Record<string, string>)[name]
        );
      }
      return undefined;
    }

    const inReplyTo = getHeader("In-Reply-To");
    const references = getHeader("References");
    const subject = data.subject ?? "(no subject)";

    const {
      existingThreadId,
      threadRootMode,
      matchedParentEmailMessage,
      correlatedPendingEmailId,
    } = await resolveInboundThread(ctx, {
      orgId,
      fromEmail,
      subject,
      messageId,
      inReplyTo,
      references,
      threadSuffix,
      agentAddressWithSuffix,
    });

    let effectiveMode = threadRootMode ?? mode;
    if (matchedParentEmailMessage) {
      effectiveMode = "direct";
    } else if (effectiveMode === "direct" && !isInternal) {
      effectiveMode = "unknown";
    }
    // When an internal user replies to an unknown-mode thread, treat as direct.
    // This lets the agent process their instruction instead of re-sending a notification.
    if (effectiveMode === "unknown" && isInternal && existingThreadId) {
      effectiveMode = "direct";
    }

    // Store attachments in Convex file storage
    const attachmentRecords: {
      filename: string;
      contentType: string;
      size: number;
      fileId?: Id<"_storage">;
      kind: "uploaded_file";
    }[] = [];

    for (const att of attachments) {
      try {
        const blob = new Blob([new Uint8Array(att.buffer)], {
          type: att.content_type,
        });
        const fileId = await ctx.storage.store(blob);
        attachmentRecords.push({
          filename: att.filename,
          contentType: att.content_type,
          size: att.size,
          fileId,
          kind: "uploaded_file",
        });
      } catch (err) {
        console.warn(`Failed to store attachment ${att.filename}:`, err);
        // Still record metadata even if storage fails
        attachmentRecords.push({
          filename: att.filename,
          contentType: att.content_type,
          size: att.size,
          kind: "uploaded_file",
        });
      }
    }

    const unifiedThreadId: Id<"threads"> = await ctx.runMutation(
      internal.threads.findOrCreateForEmail,
      {
        orgId,
        userId: primaryUserId,
        subject,
        existingThreadId,
        mode: effectiveMode,
        agentDomain: getAgentDomain(),
      },
    );

    const inboundMessageId: Id<"threadMessages"> = await ctx.runMutation(
      internal.threads.insertEmailMessage,
      {
        threadId: unifiedThreadId,
        orgId,
        role: "user",
        fromEmail,
        fromName,
        toAddresses,
        ccAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
        subject,
        content: body,
        contentHtml: bodyHtml,
        emailContent: storedInboundEmailContent(parsedInboundEmail),
        messageId,
        resendEmailId: resendEmailId || undefined,
        attachments:
          attachmentRecords.length > 0 ? attachmentRecords : undefined,
        pendingEmailId:
          matchedParentEmailMessage?.pendingEmailId ?? correlatedPendingEmailId,
      },
    );

    // Unknown mode: notify the primary insurance contact (or first admin)
    if (effectiveMode === "unknown") {
      try {
        const notifyUserId =
          org.primaryInsuranceContactId ?? firstAdmin?.userId;
        let notifyEmail: string | undefined;
        if (notifyUserId) {
          const notifyUser = await ctx.runQuery(internal.users.getInternal, {
            id: notifyUserId,
          });
          notifyEmail = notifyUser?.email;
        }
        if (!notifyEmail) {
          throw new Error("No user email found for notification");
        }

        const notificationBody = [
          `Your Spot agent received an email it couldn't confidently classify, so it's forwarding it to you for review.`,
          ``,
          `**From:** ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}`,
          `**Subject:** ${subject}`,
          ``,
          `---`,
          ``,
          bodyForAgent || "(no body)",
          ``,
          `---`,
          ``,
          `Please reply to the original sender directly if a response is needed. The agent has not sent any reply.`,
        ].join("\n");

        const signature = buildEmailSignature(agentAddress);
        const fullText = notificationBody + signature.text;

        const fullHtml = buildAgentEmailHtmlBody(notificationBody, signature);

        const notifSubject = `[Spot] Help needed: ${subject}`;

        const emailPayload: Record<string, unknown> = {
          from: fromHeader,
          to: notifyEmail,
          subject: notifSubject,
          text: fullText,
          html: fullHtml,
        };

        const sendResult = await sendResendEmail(
          emailPayload as Parameters<typeof sendResendEmail>[0],
        );
        if (!sendResult.ok) {
          throw new Error(`Failed to send notification: ${sendResult.error}`);
        }
        const sentMessageId = sendResult.id;

        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId: unifiedThreadId,
          orgId,
          role: "agent",
          content: notificationBody,
          toAddresses: [notifyEmail],
          subject: notifSubject,
          responseMessageId: sentMessageId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Agent unknown-mode notification error:", message);
        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId: unifiedThreadId,
          orgId,
          role: "agent",
          content: message,
          status: "error",
          error: message,
        });
      }
      return;
    }

    try {
      const scope = await ctx.runQuery(
        internal.lib.agentScope.resolveForAction,
        {
          orgId,
          userId: primaryUserId,
          surface: "email",
        },
      );

      const siteUrl = getClientPortalUrl();

      // Get primary user profile for name reference
      const primaryUser = await ctx.runQuery(internal.users.getInternal, {
        id: primaryUserId,
      });
      const userName = primaryUser?.name?.split(/\s+/)[0];

      const systemPrompt = buildSystemPromptForContext({
        org: {
          name: org.name,
          context: org.context,
        },
        mode:
          effectiveMode === "direct"
            ? "direct"
            : effectiveMode === "cc"
              ? "cc"
              : "forward",
        userName,
        siteUrl,
      });
      // Build messages — include thread history for context
      const messages: ModelMessage[] = [];
      let threadMessagesForGuards: Array<{
        role: "user" | "agent" | "system";
        content?: string;
        fromEmail?: string;
        toAddresses?: string[];
        ccAddresses?: string[];
        status?: string;
        referencedPolicyIds?: Id<"policies">[];
        toolArtifacts?: Array<{ type: string; data: unknown }>;
      }> = [];

      const boundedHistory = await loadBoundedAgentHistory(ctx, {
        threadId: unifiedThreadId,
        currentMessageId: inboundMessageId,
        surface: "email",
      });
      threadMessagesForGuards = boundedHistory.messages.filter(
        (message) => message._id !== inboundMessageId,
      );
      messages.push(
        ...buildTextModelHistory(boundedHistory.messages, {
          excludeMessageId: String(inboundMessageId),
          formatUser: (message) =>
            `Subject: ${message.subject ?? subject}\n\nFrom: ${
              message.fromName
                ? `${message.fromName} <${message.fromEmail ?? "unknown"}>`
                : (message.fromEmail ?? "unknown")
            }\n\n${message.content}`,
        }),
      );

      const policyFocusIds = await validatePolicyFocusIds(
        ctx,
        scope,
        selectPolicyFocusIds(threadMessagesForGuards),
      );
      const policyFocusBlock = formatPolicyFocusHints(policyFocusIds);
      const referencedPolicySourceIds = new Set<string>();
      const emailReferencedPolicyIds: Id<"policies">[] = [];

      // Build the current message — include attachments if present
      const emailText = `Subject: ${subject}\n\nFrom: ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}\n\n${bodyForAgent}`;

      // Only include supported text/PDF attachments in model context.
      const claudeAttachments = attachments.filter((a) =>
        SUPPORTED_ATTACHMENT_TYPES.has(a.content_type),
      );
      const storedModelAttachments = attachmentRecords.filter((attachment) =>
        SUPPORTED_ATTACHMENT_TYPES.has(attachment.contentType),
      );
      const attachmentContext = await buildAgentAttachmentParts(
        ctx,
        storedModelAttachments,
        {
          includeRichParts: true,
          remainingTextChars: { value: MAX_AGENT_ATTACHMENT_TEXT_CHARS },
        },
      );

      if (attachmentContext.parts.length > 0) {
        messages.push({
          role: "user",
          content: [
            ...attachmentContext.parts,
            { type: "text", text: emailText },
          ],
        });
      } else {
        messages.push({ role: "user", content: emailText });
      }

      // Build system context with optional attachment and bounded focus hints.
      let systemContext =
        systemPrompt +
        buildChannelInstructions({
          platform: "email",
          effectiveMode,
        }) +
        buildPolicyToolInstructions(10) +
        (policyFocusBlock ? `\n\n${policyFocusBlock}` : "") +
        buildThreadHistoryToolInstructions() +
        buildThreadContinuityPrompt(boundedHistory.summary);
      if (attachmentContext.names.length > 0) {
        const filenames = attachmentContext.names.join(", ");
        systemContext += `\n\nATTACHMENTS: The user's email includes ${attachmentContext.names.length} attachment(s): ${filenames}. The content has been provided to you. Reference relevant information from attachments in your response when applicable.`;
      }
      const attachmentIndex: Record<
        string,
        { fileId: string; contentType: string }
      > = {};
      for (const rec of attachmentRecords) {
        if (rec.fileId) {
          attachmentIndex[rec.filename] = {
            fileId: rec.fileId,
            contentType: rec.contentType,
          };
        }
      }

      const emailToolState: { result: EmailSubagentResult | null } = {
        result: null,
      };
      const generatedCoiAttachments: EmailAttachmentMeta[] = [];
      const emailToolArtifacts: Array<{ type: string; data: unknown }> = [];
      const availableEmailAttachments = attachmentRecords
        .filter(
          (rec): rec is typeof rec & { fileId: Id<"_storage"> } => !!rec.fileId,
        )
        .map((rec) => ({
          filename: rec.filename,
          contentType: rec.contentType,
          size: rec.size,
          fileId: rec.fileId,
          kind: rec.kind,
        }));
      const availableFileIds = new Set(
        availableEmailAttachments.map((attachment) =>
          String(attachment.fileId),
        ),
      );
      const requirementImportText = [subject ?? "", bodyForAgent].join("\n\n");
      const requirementImportResolution =
        await decideRequirementAttachmentImport(ctx, {
          orgId,
          messageText: requirementImportText,
          attachments: availableEmailAttachments,
        });
      const requirementImportAttachments =
        requirementImportResolution.authorization === "auto"
          ? requirementImportResolution.attachments
          : [];
      const requirementImportDefaultScope =
        requirementImportResolution.authorization === "none"
          ? undefined
          : requirementImportResolution.scope;

      const emailTools = {
        ...buildAgentToolExecutors(ctx, {
          surface: "email",
          orgId,
          userId: primaryUserId,
          scope,
          threadId: unifiedThreadId,
          availableFileIds,
          requirementImportAttachments,
          requirementImportDefaultScope,
          onPolicyReferenced: (policyId) => {
            referencedPolicySourceIds.add(String(policyId));
            if (!emailReferencedPolicyIds.some((id) => id === policyId)) {
              emailReferencedPolicyIds.push(policyId);
            }
          },
          onResponseAttachment: (attachment) => {
            if (!attachment.fileId) return;
            generatedCoiAttachments.push({
              filename: attachment.filename,
              contentType: attachment.contentType,
              size: attachment.size,
              fileId: attachment.fileId,
              kind: attachment.kind,
            });
          },
          onToolArtifact: (artifact) => {
            emailToolArtifacts.push(artifact);
          },
        }),
        ...(isInternal && effectiveMode === "direct"
          ? {
              email_expert: buildEmailExpertTool(ctx, {
                orgId,
                userId: primaryUserId,
                threadId: unifiedThreadId,
                sourceUserMessageId: inboundMessageId,
                routingParentId: String(inboundMessageId),
                channel: "email",
                fromHeader,
                agentAddress,
                senderEmail: fromEmail,
                defaultTo: fromEmail,
                defaultRecipientName: fromName,
                defaultBcc:
                  org.bccRequesterOnAgentEmails !== false
                    ? [fromEmail]
                    : undefined,
                subjectHint: subject,
                inReplyTo: messageId,
                references: messageId,
                allowedRecipients: [
                  ...new Set(
                    [
                      ...collectAllowedRecipients(
                        [
                          ...threadMessagesForGuards.map((m) => ({
                            ...m,
                            channel: "email",
                          })),
                          {
                            channel: "email",
                            fromEmail,
                            toAddresses,
                            ccAddresses,
                          },
                        ],
                        memberEmails,
                      ),
                      ...memberEmails,
                    ]
                      .filter(Boolean)
                      .map((email) => String(email).toLowerCase()),
                  ),
                ],
                availableAttachments: availableEmailAttachments,
                referencedPolicyIds: emailReferencedPolicyIds,
                emailSendDelay: org.emailSendDelay,
                conversationContext: [
                  `Inbound email from ${fromName ? `${fromName} <${fromEmail}>` : fromEmail}`,
                  `Subject: ${subject}`,
                  bodyForAgent,
                ].join("\n\n"),
                onResult: (result: EmailSubagentResult) => {
                  emailToolState.result = result;
                },
              }),
            }
          : {}),
        ...(isInternal && effectiveMode === "direct"
          ? {
              create_imessage_group_chat: {
                ...createImessageGroupChat,
                execute: async (params: {
                  recipients: string[];
                  openingMessage: string;
                  title?: string;
                  confirmed: boolean;
                }) => {
                  if (!params.confirmed) {
                    return "Ask the user to confirm before creating a new iMessage group chat.";
                  }
                  return await ctx.runAction(
                    internal.actions.createOutboundImessageGroup
                      .createOutboundImessageGroupInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      recipients: params.recipients,
                      openingMessage: params.openingMessage,
                      title: params.title,
                    },
                  );
                },
              },
              search_connected_email: {
                ...searchConnectedEmail,
                execute: async (params: {
                  query?: string;
                  mailbox?: string;
                  sinceDays?: number;
                  dateFrom?: string;
                  dateTo?: string;
                  limit?: number;
                }) =>
                  await ctx.runAction(
                    internal.actions.connectedEmail.searchInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      query: params.query,
                      mailbox: params.mailbox,
                      sinceDays: params.sinceDays,
                      dateFrom: params.dateFrom,
                      dateTo: params.dateTo,
                      limit: params.limit,
                    },
                  ),
              },
              read_connected_email: {
                ...readConnectedEmail,
                execute: async (params: { emailRef: string }) =>
                  await ctx.runAction(
                    internal.actions.connectedEmail.readInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      emailRef: params.emailRef,
                    },
                  ),
              },
              read_connected_email_attachment: {
                ...readConnectedEmailAttachment,
                execute: async (params: {
                  emailRef: string;
                  filename: string;
                }) =>
                  await ctx.runAction(
                    internal.actions.connectedEmail.readAttachmentInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      emailRef: params.emailRef,
                      filename: params.filename,
                    },
                  ),
              },
              import_connected_email_policy_attachments: {
                ...importConnectedEmailPolicyAttachments,
                execute: async (params: {
                  emailRef: string;
                  filenames?: string[];
                }) =>
                  await ctx.runAction(
                    internal.actions.connectedEmail
                      .importPolicyAttachmentsInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      emailRef: params.emailRef,
                      filenames: params.filenames,
                    },
                  ),
              },
              import_connected_email_requirement_attachments: {
                ...importConnectedEmailRequirementAttachments,
                execute: async (params: {
                  emailRef: string;
                  filenames?: string[];
                  sourceType?:
                    | "lease_agreement"
                    | "client_contract"
                    | "vendor_requirements"
                    | "other";
                  scope?: "vendors" | "own_org";
                }) =>
                  await ctx.runAction(
                    internal.actions.connectedEmail
                      .importRequirementAttachmentsInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      emailRef: params.emailRef,
                      filenames: params.filenames,
                      sourceType: params.sourceType,
                      scope: params.scope,
                    },
                  ),
              },
              send_connected_vendor_invite: {
                ...sendConnectedVendorInvite,
                execute: async (params: {
                  vendorEmail: string;
                  relationshipLabel?: string;
                  note?: string;
                }) =>
                  await ctx.runAction(
                    internal.connectedOrgs.requestVendorAccessByEmailInternal,
                    {
                      clientOrgId: orgId,
                      requestedByUserId: primaryUserId,
                      vendorEmail: params.vendorEmail,
                      relationshipLabel: params.relationshipLabel,
                      note: params.note,
                    },
                  ),
              },
              coordinate_mailbox_task: {
                ...coordinateMailboxTask,
                execute: async (params: { task: string }) =>
                  await ctx.runAction(
                    internal.actions.mailboxCoordinator.runInternal,
                    {
                      orgId,
                      userId: primaryUserId,
                      task: params.task,
                      routingParentId: String(inboundMessageId),
                    },
                  ),
              },
              web_research: {
                ...webResearch,
                execute: async (params: WebRetrievalInput) => {
                  const result = await runWebRetrieval(ctx, orgId, params);
                  if (!result.text) {
                    return {
                      status: "unavailable",
                      attempts: result.attempts,
                      warnings: result.warnings,
                    };
                  }
                  return {
                    status: "ok",
                    provider: result.provider,
                    text: result.text,
                    sources: result.sources,
                    warnings: result.warnings,
                  };
                },
              },
            }
          : {}),
        extract_policy_attachment: {
          ...extractPolicyAttachment,
          execute: async (params: {
            files: Array<{ storageId: string; fileName: string }>;
          }) => {
            if (!params.files || params.files.length === 0) {
              return "No files provided.";
            }
            // Validate every storageId belongs to one of this email's attachments
            for (const f of params.files) {
              const matched = Object.entries(attachmentIndex).find(
                ([, v]) => v.fileId === f.storageId,
              );
              if (!matched) {
                return `Storage ID ${f.storageId} does not match any attachment on this email.`;
              }
            }
            try {
              const result = await ctx.runAction(
                internal.actions.extractFromUpload.extractFromUploadInternal,
                {
                  files: params.files.map((f) => ({
                    fileId: f.storageId as Id<"_storage">,
                    fileName: f.fileName,
                  })),
                  orgId,
                  userId: primaryUserId,
                },
              );
              if ("error" in result)
                return `Extraction failed: ${result.error}`;
              const names = params.files.map((f) => f.fileName).join(", ");
              return `Extraction started for ${params.files.length} file(s) [${names}] as a single policy. Policy ID: ${result.policyId}. It will appear in the policy library once processing completes.`;
            } catch (err) {
              return `Failed to start extraction: ${err instanceof Error ? err.message : String(err)}`;
            }
          },
        },
      };

      // Tell the agent about available attachments and their storage IDs.
      let attachmentToolHint = "";
      if (claudeAttachments.length > 0) {
        const pdfAttachments = claudeAttachments
          .filter((a) => a.content_type === "application/pdf")
          .map((a) => {
            const rec = attachmentRecords.find(
              (r) => r.filename === a.filename,
            );
            return rec?.fileId
              ? `- "${a.filename}" (storageId: ${rec.fileId})`
              : null;
          })
          .filter(Boolean);
        if (pdfAttachments.length > 0) {
          attachmentToolHint = `\n\nATTACHMENT TOOLS:
If any attached PDF appears to be a bound policy, declarations page, binder, endorsement, COI, or other post-binding insurance document that should be added to the organization's policy library, call the extract_policy_attachment tool. PDFs are also provided inline so you may read them to answer questions.

PDF ATTACHMENT MANIFEST (storageId -> fileName):
${pdfAttachments.join("\n")}

IMPORTANT GROUPING RULE: A real-world policy commonly arrives as multiple PDFs in the SAME email (for example: COI + declarations + full policy wording). If multiple PDFs in this email describe the SAME policy, call extract_policy_attachment ONCE with ALL of them in the files array — they will be combined into a single policy record. Only make separate extract_policy_attachment calls when the attachments clearly belong to DIFFERENT policies.`;
        }
      }

      systemContext += attachmentToolHint;
      const currentDraftEmails = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId: unifiedThreadId, orgId },
      );
      if (currentDraftEmails.length > 0) {
        systemContext += `\n\nCURRENT EMAIL DRAFTS:\n${buildEmailDraftTextSummary(
          currentDraftEmails,
          {
            sampleSize: Math.min(3, currentDraftEmails.length),
            includeIds: false,
            commands: "chat",
          },
        )}\n\nFor email replies about multiple drafts, show a short sample first and ask whether the user wants more detail instead of dumping every draft.`;
      }
      systemContext += `\n\nYou have tools to look up policies, search policy source evidence and document outlines, compare coverages, check compliance requirements, look up connected vendors, inspect vendor policies, inspect requirement-by-requirement vendor compliance, save notes, generate COIs, and extract uploaded policy attachments. Use them as needed before answering. Decide yourself whether the email requires answering a question, generating a COI, and/or extracting an attached policy — you may do more than one.`;

      let responseBody: string;
      let handledConfirmation = false;
      let confirmationControlResponse: string | null = null;
      const normalizedEmailActor = fromEmail.trim().toLowerCase();
      const latestConfirmation = await ctx.runQuery(
        internal.threadActionConfirmations.latestPendingInternal,
        { threadId: unifiedThreadId },
      );
      if (
        latestConfirmation?.orgId === orgId &&
        latestConfirmation.actor.kind === "email" &&
        latestConfirmation.actor.address === normalizedEmailActor
      ) {
        const confirmationRequested =
          latestConfirmation.payload.kind === "email_cancel"
            ? isPendingEmailCancelConfirmation(parsedInboundEmail.currentText)
            : isContextualConfirmation(parsedInboundEmail.currentText);
        if (confirmationRequested) {
          handledConfirmation = true;
          const confirmationResult = await ctx.runMutation(
            internal.threadActionConfirmations.consumeInternal,
            {
              id: latestConfirmation._id,
              actor: { kind: "email", address: normalizedEmailActor },
              currentMessageId: inboundMessageId,
              requireAdjacentPrompt: true,
            },
          );
          if (confirmationResult !== "completed") {
            confirmationControlResponse =
              confirmationResult === "expired"
                ? "That confirmation expired. Ask me to show the current draft or import again before confirming."
                : "That item changed or is no longer the latest confirmation. Ask me to show it again before confirming.";
          } else if (
            latestConfirmation.payload.kind === "email_send" ||
            latestConfirmation.payload.kind === "coi_batch_delivery"
          ) {
            const emailIds =
              latestConfirmation.payload.kind === "email_send"
                ? latestConfirmation.payload.pendingEmailIds
                : [latestConfirmation.payload.pendingEmailId];
            const result = await executeEmailCommand(
              ctx,
              { kind: "send_draft_emails", emailIds },
              {
                draftEmails: currentDraftEmails,
                sendConfirmationId: latestConfirmation._id,
              },
            );
            confirmationControlResponse = result.responseBody;
          } else if (latestConfirmation.payload.kind === "requirement_import") {
            const imported = await importConfirmedRequirementSources(ctx, {
              orgId,
              userId: primaryUserId,
              payload: latestConfirmation.payload,
            });
            emailToolArtifacts.push({
              type: "workflow_outcome",
              data: imported.workflowOutcome,
            });
            confirmationControlResponse =
              confirmedRequirementImportMessage(imported);
          } else if (latestConfirmation.payload.kind === "email_cancel") {
            const result = await executeEmailCommand(
              ctx,
              {
                kind: "cancel_draft_emails",
                emailIds: latestConfirmation.payload.pendingEmailIds,
              },
              { draftEmails: currentDraftEmails },
            );
            confirmationControlResponse = result.responseBody;
          }
        }
      }

      const deterministicControlResult = handledConfirmation
        ? null
        : await runInboundEmailDeterministicControls(ctx, {
            messageText: parsedInboundEmail.currentText,
            draftEmails: currentDraftEmails,
          });
      const cancelRequestTargets =
        !handledConfirmation &&
        currentDraftEmails.length > 0 &&
        isPendingEmailCancelIntent(parsedInboundEmail.currentText)
          ? currentDraftEmails
          : [];
      if (confirmationControlResponse) {
        responseBody = confirmationControlResponse;
      } else if (cancelRequestTargets.length > 0) {
        responseBody = `I found ${cancelRequestTargets.length} current draft email${cancelRequestTargets.length === 1 ? "" : "s"}.`;
      } else if (deterministicControlResult) {
        responseBody = deterministicControlResult.responseBody;
      } else {
        const turn = await runAgentTurn(ctx, {
          orgId,
          task: "email_reply",
          messageText: `Subject: ${subject}\n\n${bodyForAgent}`,
          currentAttachmentNames: claudeAttachments.map(
            (attachment) => attachment.filename,
          ),
          recentConversationContext: buildRecentAgentConversationContext(
            boundedHistory.messages,
            String(inboundMessageId),
          ),
          options: {
            maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
            system: systemContext,
            messages,
            tools: emailTools,
            stopWhen: stepCountIs(10),
            prepareStep: ({ stepNumber }) =>
              requiredRequirementImportStep(
                stepNumber,
                requirementImportAttachments.length > 0,
              ),
          },
          run: {
            taskKind: "inbound_email_reply",
            sessionKey: String(unifiedThreadId),
            trace: {
              traceId: String(inboundMessageId),
              parentRequestId: messageId ?? resendEmailId ?? args.svixId,
              label: "convex.handleInboundEmail",
              phase: "inbound_email_reply",
              channel: "email",
            },
          },
        });
        for (const workflowOutcome of turn.audit.workflowOutcomes) {
          emailToolArtifacts.push({
            type: "workflow_outcome",
            data: workflowOutcome,
          });
        }
        responseBody = turn.text;
      }

      responseBody = cleanAgentMarkdownForTransport(responseBody);
      if (!responseBody) {
        responseBody =
          "I couldn't format that response. Please try again in a moment.";
      }

      const resolvedEmailResult = emailToolState.result;
      if (
        resolvedEmailResult?.status === "sent" ||
        resolvedEmailResult?.status === "pending"
      ) {
        await scheduleThreadHistoryCompaction(ctx, unifiedThreadId);
        return;
      }

      let pendingConfirmationPrompt: PendingEmailConfirmationPrompt | null =
        null;
      if (
        resolvedEmailResult?.pendingEmailId &&
        (resolvedEmailResult.status === "draft" ||
          resolvedEmailResult.status === "needs_confirmation")
      ) {
        const draft = await ctx.runQuery(internal.pendingEmails.getInternal, {
          id: resolvedEmailResult.pendingEmailId,
        });
        if (draft?.status === "draft") {
          const confirmation = await buildPendingEmailConfirmation(draft);
          pendingConfirmationPrompt =
            confirmation.payload.kind === "coi_batch_delivery"
              ? {
                  content: `Reply “yes” to authorize and send this exact COI batch to ${draft.recipientEmail}: ${(draft.attachments ?? []).map((attachment) => attachment.filename).join(", ")}.`,
                  dedupeKey: `email-coi-batch-confirmation:${String(draft._id)}:${confirmation.fingerprint}`,
                  pendingEmailId: draft._id,
                  payload: confirmation.payload,
                }
              : {
                  content: `Reply “yes” to send this exact draft to ${draft.recipientEmail} with subject “${draft.subject}”.`,
                  dedupeKey: `email-send-confirmation:${String(draft._id)}:${confirmation.fingerprint}`,
                  pendingEmailId: draft._id,
                  payload: confirmation.payload,
                };
        }
      } else if (!handledConfirmation && cancelRequestTargets.length > 0) {
        pendingConfirmationPrompt = {
          content: `Confirm cancellation of ${cancelRequestTargets.length === 1 ? "the draft email" : `${cancelRequestTargets.length} draft emails`} by replying “yes cancel”.`,
          dedupeKey: `email-cancel-confirmation:${String(inboundMessageId)}`,
          payload: {
            kind: "email_cancel",
            pendingEmailIds: cancelRequestTargets.map((draft) => draft._id),
            draftFingerprints: await Promise.all(
              cancelRequestTargets.map((draft) =>
                pendingEmailDraftFingerprint(draft),
              ),
            ),
          },
        };
      } else if (!resolvedEmailResult && !handledConfirmation) {
        const confirmation = buildRequirementImportConfirmation(
          requirementImportResolution,
        );
        if (confirmation) {
          pendingConfirmationPrompt = {
            content: `Reply “yes”. ${confirmation.message}`,
            dedupeKey: `email-requirement-import-confirmation:${String(inboundMessageId)}`,
            payload: confirmation.payload,
          };
        }
      }

      let pendingEmailReviewLinkId: Id<"emailDraftReviewLinks"> | undefined;
      let pendingEmailReviewUrl: string | undefined;
      if (
        effectiveMode === "direct" &&
        pendingConfirmationPrompt?.pendingEmailId
      ) {
        try {
          const reviewLink = await ctx.runMutation(
            internal.emailDraftReviewLinks.createInternal,
            {
              pendingEmailId: pendingConfirmationPrompt.pendingEmailId,
              channel: "email",
              actor: { kind: "email", address: normalizedEmailActor },
              sourceThreadMessageId: inboundMessageId,
            },
          );
          pendingEmailReviewLinkId = reviewLink.id;
          pendingEmailReviewUrl = reviewLink.url;
        } catch (error) {
          console.warn("Could not create email draft review link:", error);
        }
      }

      // Domain guard: strip internal URLs from customer-facing replies
      if (effectiveMode === "cc" || effectiveMode === "forward") {
        const escapedSiteUrl = siteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        responseBody = responseBody.replace(
          new RegExp(`\\[([^\\]]+)\\]\\(${escapedSiteUrl}[^)]*\\)`, "g"),
          "$1",
        );
        responseBody = responseBody.replace(
          new RegExp(`${escapedSiteUrl}[^\\s)]*`, "g"),
          "[internal link removed]",
        );
      }

      const deliveryResponseBody = [
        responseBody.trim(),
        pendingConfirmationPrompt?.content,
        pendingEmailReviewUrl
          ? `Review and send this draft: ${pendingEmailReviewUrl}`
          : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join("\n\n");
      const plainTextBody = stripMarkdown(deliveryResponseBody);
      const signature = buildEmailSignature(agentAddress);
      const fullReplyText = plainTextBody + signature.text;
      const fullReplyHtml = buildAgentEmailHtmlBody(
        deliveryResponseBody,
        signature,
      );

      // Determine reply recipients
      const primaryUserEmail = primaryUser?.email;
      let replyTo: string;
      let replyCc: string[] = [];

      if (effectiveMode === "forward") {
        const forwardReplyDirection = await decideForwardReplyDirection(ctx, {
          orgId,
          currentText: parsedInboundEmail.currentText,
          forwarderEmail: fromEmail,
          parsedOriginalSender:
            parsedInboundEmail.forwarded?.email.from?.address,
        });
        replyTo = resolveForwardReplyAddress({
          parsed: parsedInboundEmail,
          forwarderEmail: fromEmail,
          forwardReplyDirection,
        });
      } else if (effectiveMode === "cc") {
        replyTo = fromEmail;
        replyCc = [...toAddresses, ...ccAddresses].filter(
          (a) => !isAgentAddr(a) && a !== fromEmail,
        );
      } else {
        replyTo = fromEmail;
      }

      // Ensure user is CC'd on cc/forward replies
      if (
        (effectiveMode === "cc" || effectiveMode === "forward") &&
        primaryUserEmail
      ) {
        if (
          replyTo !== primaryUserEmail &&
          !replyCc.includes(primaryUserEmail)
        ) {
          replyCc.push(primaryUserEmail);
        }
      }

      // Send reply via Resend
      const cleanSubject =
        effectiveMode === "forward"
          ? subject.replace(/^Fwd?:\s*/i, "")
          : subject;
      const replySubject = cleanSubject.startsWith("Re:")
        ? cleanSubject
        : `Re: ${cleanSubject}`;

      const emailPayload: Record<string, unknown> = {
        from: fromHeader,
        to: replyTo,
        subject: replySubject,
        text: fullReplyText,
        html: fullReplyHtml,
      };
      if (generatedCoiAttachments.length > 0) {
        emailPayload.attachments = await toResendAttachments(
          ctx,
          generatedCoiAttachments,
        );
      }

      if (replyCc.length > 0) {
        emailPayload.cc = replyCc;
      }

      // Threading headers
      const replyHeaders: Record<string, string> = {};
      if (messageId) {
        replyHeaders["In-Reply-To"] = messageId;
        replyHeaders["References"] = messageId;
      }
      if (Object.keys(replyHeaders).length > 0) {
        emailPayload.headers = replyHeaders;
      }

      const sendResult = await sendResendEmail(
        emailPayload as Parameters<typeof sendResendEmail>[0],
      );
      if (!sendResult.ok) {
        throw new Error(`Failed to send reply: ${sendResult.error}`);
      }
      const sentMessageId = sendResult.id;

      const agentResponseMessageId = await ctx.runMutation(
        internal.threads.insertEmailMessage,
        {
          threadId: unifiedThreadId,
          orgId,
          role: "agent",
          content: responseBody,
          toAddresses: [replyTo],
          ccAddresses: replyCc.length > 0 ? replyCc : undefined,
          responseMessageId: sentMessageId,
          attachments:
            generatedCoiAttachments.length > 0
              ? generatedCoiAttachments
              : undefined,
          toolArtifacts:
            emailToolArtifacts.length > 0 ? emailToolArtifacts : undefined,
        },
      );
      if (pendingConfirmationPrompt) {
        const statusMessageId = await ctx.runMutation(
          internal.threads.insertWorkflowStatusMessage,
          {
            threadId: unifiedThreadId,
            orgId,
            channel: "email",
            content: pendingConfirmationPrompt.content,
            pendingEmailId: pendingConfirmationPrompt.pendingEmailId,
            sourceThreadMessageId: agentResponseMessageId,
            dedupeKey: pendingConfirmationPrompt.dedupeKey,
          },
        );
        const confirmationId = await ctx.runMutation(
          internal.threadActionConfirmations.createInternal,
          {
            orgId,
            threadId: unifiedThreadId,
            actor: { kind: "email", address: normalizedEmailActor },
            promptMessageId: statusMessageId,
            payload: pendingConfirmationPrompt.payload,
          },
        );
        if (pendingEmailReviewLinkId) {
          try {
            await ctx.runMutation(
              internal.emailDraftReviewLinks.bindConfirmationInternal,
              {
                id: pendingEmailReviewLinkId,
                confirmationId,
              },
            );
          } catch (error) {
            console.warn("Could not bind email draft review link:", error);
          }
        }
      }
      await scheduleThreadHistoryCompaction(ctx, unifiedThreadId);

      // Audit: log agent references to policies
      for (const pId of referencedPolicySourceIds) {
        await ctx.runMutation(internal.policyAuditLog.append, {
          policyId: pId as Id<"policies">,
          userId: primaryUserId,
          orgId,
          action: "agent_referenced",
          detail: subject,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Agent processing error:", message);
      try {
        const failureSubject = subject.startsWith("Re:")
          ? subject
          : `Re: ${subject}`;
        const failureHtml = buildAgentEmailHtmlBody(
          FATAL_ACTION_FAILED_MESSAGE,
          buildEmailSignature(agentAddress),
        );
        const failurePayload: Record<string, unknown> = {
          from: fromHeader,
          to: fromEmail,
          subject: failureSubject,
          text: FATAL_ACTION_FAILED_MESSAGE,
          html: failureHtml,
        };
        if (messageId) {
          failurePayload.headers = {
            "In-Reply-To": messageId,
            References: messageId,
          };
        }
        const sendResult = await sendResendEmail(
          failurePayload as Parameters<typeof sendResendEmail>[0],
        );
        const sentMessageId = sendResult.ok ? sendResult.id : undefined;
        if (!sendResult.ok) {
          console.warn("Failed to send agent failure email:", sendResult.error);
        }
        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId: unifiedThreadId,
          orgId,
          role: "agent",
          content: FATAL_ACTION_FAILED_MESSAGE,
          toAddresses: [fromEmail],
          subject: failureSubject,
          responseMessageId: sentMessageId,
        });
      } catch (notifyError) {
        console.warn(
          "Failed to record/send agent failure response:",
          notifyError,
        );
      }
    }
  },
});
