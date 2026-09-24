"use node";

import { stepCountIs, tool } from "ai";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import dayjs from "dayjs";
import { generateAgentTextForOrg } from "./models";
import { buildAgentToolExecutors } from "./agentToolExecutors";
import type { AgentScope } from "./agentScope";
import { extractEmailAddress, normalizeEmailAddress } from "./emailAddress";
import {
  isActorBoundExplicitEmailSendSource,
  sourceExplicitlyNamesEmailAddress,
} from "./emailSendIntent";
import { cleanAgentMarkdownForTransport } from "./transportRenderers";
import {
  queueEmailDraftArtifact,
  upsertEmailDraftArtifact,
} from "./emailDraftArtifacts";
import {
  buildEmailPayload,
  sendTrackedResendEmail,
  toResendAttachments,
  type EmailAttachmentMeta,
} from "./emailDelivery";
import { buildEmailSignature } from "./emailIdentity";
import {
  COI_DISCLAIMER,
  NO_OPEN_ENDED_OFFERS,
  NO_SIGN_OFF,
} from "./channelStyle";
import {
  MULTIPLE_COI_SINGLE_RECIPIENT_WARNING,
  normalizeAttachmentText,
  resolveRequestedCoiAttachmentsForRecipient,
  type RequestedEmailAttachment,
} from "./coiAttachmentGuards";
import { lobLabel, policyLobCodes } from "./linesOfBusiness";
import type { WorkflowOutcome } from "./workflows/types";

export {
  buildAgentEmailHtmlBody,
  buildEmailPayload,
  toResendAttachments,
  type EmailAttachmentMeta,
} from "./emailDelivery";
export {
  buildEmailSignature,
  getEmailAgentFromName,
  resolveEmailAgentIdentity,
} from "./emailIdentity";
export {
  queueEmailDraftArtifact,
  upsertEmailDraftArtifact,
} from "./emailDraftArtifacts";

export type EmailSubagentResult = {
  status: "draft" | "needs_confirmation" | "pending" | "sent" | "error";
  responseBody: string;
  confirmationReason?: string;
  responseTo?: string;
  responseCc?: string[];
  responseBcc?: string[];
  subject?: string;
  emailBody?: string;
  responseMessageId?: string;
  pendingEmailId?: Id<"pendingEmails">;
  attachments?: EmailAttachmentMeta[];
  workflowOutcome?: WorkflowOutcome<"email_delivery">;
};

const EMAIL_WORKFLOW_STATE = {
  sent: {
    status: "completed",
    nextAction: "email_delivered",
    sideEffectKind: "email_sent",
  },
  pending: {
    status: "running",
    nextAction: "await_email_delivery",
    sideEffectKind: "draft_created",
  },
  draft: {
    status: "needs_input",
    nextAction: "confirm_exact_draft",
    sideEffectKind: "draft_created",
  },
  needs_confirmation: {
    status: "needs_input",
    nextAction: "confirm_exact_draft",
    sideEffectKind: "draft_created",
  },
  error: {
    status: "failed_recoverably",
    nextAction: "review_email_failure",
    sideEffectKind: undefined,
  },
} as const satisfies Record<EmailSubagentResult["status"], object>;

function withEmailWorkflowOutcome(
  result: EmailSubagentResult,
): EmailSubagentResult {
  const needsConfirmation =
    result.status === "draft" || result.status === "needs_confirmation";
  const target = result.responseMessageId
    ? { type: "emailMessage", id: result.responseMessageId }
    : result.pendingEmailId
      ? { type: "pendingEmail", id: String(result.pendingEmailId) }
      : undefined;
  const outcomeState = EMAIL_WORKFLOW_STATE[result.status];
  const workflowOutcome: WorkflowOutcome<"email_delivery"> = {
    workflowKind: "email_delivery",
    status: outcomeState.status,
    nextAction: outcomeState.nextAction,
    requiredSlots: needsConfirmation
      ? [
          {
            key: "sendConfirmation",
            label: "Send confirmation",
            prompt: result.confirmationReason ?? "Confirm this exact draft.",
            required: true,
          },
        ]
      : [],
    forbiddenQuestions: [],
    forbiddenClaims: ["email_sent_without_email_sent_side_effect"],
    sideEffects:
      target && outcomeState.sideEffectKind
        ? [
            {
              kind: outcomeState.sideEffectKind,
              targetType: target.type,
              targetId: target.id,
            },
          ]
        : [],
    artifacts: [
      ...(result.pendingEmailId
        ? [
            {
              type: "pending_email",
              id: String(result.pendingEmailId),
            },
          ]
        : []),
      ...(result.responseMessageId
        ? [
            {
              type: "email_message",
              id: result.responseMessageId,
            },
          ]
        : []),
    ],
    comms: { headline: result.responseBody },
    audit: [
      {
        step: "email_delivery",
        decision: result.status,
        detail: target?.id,
      },
    ],
  };
  return { ...result, workflowOutcome };
}

type EmailExpertContext = {
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  threadId?: Id<"threads">;
  sourceUserMessageId?: Id<"threadMessages">;
  chatMessageId?: Id<"threadMessages">;
  routingParentId: string;
  channel: "web" | "email" | "imessage" | "slack" | "mcp";
  fromHeader: string;
  agentAddress: string;
  replyTo?: string;
  senderEmail?: string;
  defaultTo?: string;
  defaultRecipientName?: string;
  defaultCc?: string[];
  defaultBcc?: string[];
  blockedCopyEmails?: string[];
  subjectHint?: string;
  inReplyTo?: string;
  references?: string;
  allowedRecipients?: string[];
  requireKnownRecipient?: boolean;
  availableAttachments?: EmailAttachmentMeta[];
  referencedPolicyIds?: Id<"policies">[];
  emailSendDelay?: number;
  conversationContext?: string;
  onResult?: (result: EmailSubagentResult) => void;
};

function formatDraft(params: {
  to?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  attachments?: EmailAttachmentMeta[];
  reason?: string;
}): string {
  const attachmentLine = params.attachments?.length
    ? `\nAttachments: ${params.attachments.map((a) => a.filename).join(", ")}`
    : "";
  const reasonLine = params.reason ? `${params.reason}\n\n` : "";
  return [
    `${reasonLine}Draft email${params.to ? ` to ${params.to}` : ""}:`,
    "",
    `To: ${params.to ?? "[confirm recipient]"}`,
    params.cc?.length ? `Cc: ${params.cc.join(", ")}` : null,
    params.bcc?.length ? `Bcc: ${params.bcc.join(", ")}` : null,
    `Subject: ${params.subject ?? "[confirm subject]"}`,
    attachmentLine.trim() ? attachmentLine.trim() : null,
    "",
    params.body ?? "[confirm body]",
    "",
    "Ready to send?",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function uniqueAttachments(
  attachments: EmailAttachmentMeta[],
): EmailAttachmentMeta[] {
  const seen = new Set<string>();
  const result: EmailAttachmentMeta[] = [];
  for (const att of attachments) {
    const key = `${att.fileId}:${att.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(att);
  }
  return result;
}

export function buildEmailExpertTool(
  ctx: ActionCtx,
  params: EmailExpertContext,
) {
  return tool({
    description:
      "Delegate email drafting, formatting, attachment selection, and validated sending to the Spot email expert. Use this whenever the user asks to draft, send, forward, or attach documents to an email.",
    inputSchema: z.object({
      request: z
        .string()
        .describe("The user's full email request and any relevant context."),
      to: z.string().optional().describe("Recipient email address if known."),
      recipientName: z.string().optional().describe("Recipient name if known."),
      subject: z
        .string()
        .optional()
        .describe("Subject line if the user supplied or approved one."),
      body: z
        .string()
        .optional()
        .describe("Email body if already drafted or approved."),
      deliveryIntent: z
        .enum(["draft", "send"])
        .describe(
          "Use send only when the current user message affirmatively asks Spot to send, email, forward, or deliver now. Use draft for draft-only requests, questions about sending, negated sends, and uncertain intent.",
        ),
      cc: z.array(z.string()).optional().describe("CC email addresses."),
      bcc: z.array(z.string()).optional().describe("BCC email addresses."),
      recipientDirection: z
        .enum(["requester", "explicit"])
        .optional()
        .describe("Structured recipient direction from the current request."),
      attachments: z
        .array(
          z.object({
            kind: z.enum(["original_policy", "coi", "uploaded_file"]),
            policyId: z.string().optional(),
            fileId: z.string().optional(),
            filename: z.string().optional(),
            certificateHolder: z.string().optional(),
            holderContactName: z.string().optional(),
            holderEmail: z.string().optional(),
            holderPhone: z.string().optional(),
            addressLine1: z.string().optional(),
            addressLine2: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            postalCode: z.string().optional(),
            country: z.string().optional(),
            requestText: z.string().optional(),
            requestedEndorsements: z.array(z.string()).optional(),
            requirementSourceDocumentId: z.string().optional(),
            requirementId: z.string().optional(),
            explicitArtifactRequest: z
              .literal("original_policy_document")
              .optional(),
            intentEvidence: z.string().optional(),
          }),
        )
        .optional()
        .describe(
          "Documents the user explicitly asked to attach. Use uploaded_file for a PDF already generated or attached in this conversation, including follow-ups like 'send that'. Use coi only when a new certificate must be generated. Do not include original_policy unless the user separately asked for the original/full policy PDF.",
        ),
    }),
    execute: async (input): Promise<EmailSubagentResult> => {
      const result = withEmailWorkflowOutcome(
        await runEmailSubagent(ctx, params, input),
      );
      params.onResult?.(result);
      return result;
    },
  });
}

async function runEmailSubagent(
  ctx: ActionCtx,
  context: EmailExpertContext,
  input: {
    request: string;
    to?: string;
    recipientName?: string;
    subject?: string;
    body?: string;
    deliveryIntent: "draft" | "send";
    cc?: string[];
    bcc?: string[];
    recipientDirection?: "requester" | "explicit";
    attachments?: RequestedEmailAttachment[];
  },
): Promise<EmailSubagentResult> {
  const sourceUserMessage = context.sourceUserMessageId
    ? await ctx.runQuery(internal.threads.getMessageInternal, {
        id: context.sourceUserMessageId,
      })
    : null;
  const explicitSendAuthorization =
    input.deliveryIntent === "send" &&
    context.userId &&
    context.threadId &&
    context.sourceUserMessageId &&
    isActorBoundExplicitEmailSendSource({
      message: sourceUserMessage,
      orgId: context.orgId,
      threadId: context.threadId,
      actorUserId: context.userId,
      actorEmail: context.senderEmail,
    })
      ? {
          actorUserId: context.userId,
          sourceMessageId: context.sourceUserMessageId,
        }
      : undefined;
  const explicitSendRequested = explicitSendAuthorization !== undefined;
  const preparedAttachments: EmailAttachmentMeta[] = [];
  const directedDefaultTo = context.defaultTo;
  const directedRecipientName = context.defaultRecipientName;
  const safeRequestedAttachments = resolveRequestedCoiAttachmentsForRecipient({
    to: input.to,
    defaultTo: directedDefaultTo,
    attachments: input.attachments,
  });
  const hasStructuredCoiRequest = safeRequestedAttachments.attachments.some(
    (attachment) => attachment.kind === "coi",
  );
  const allowedOriginalPolicyIds = new Set(
    safeRequestedAttachments.attachments.flatMap((attachment) =>
      attachment.kind === "original_policy" && attachment.policyId
        ? [attachment.policyId]
        : [],
    ),
  );
  const sourcePolicyIds = new Set<Id<"policies">>(
    context.referencedPolicyIds ?? [],
  );
  const savedThreadAttachments = context.threadId
    ? await ctx.runQuery(internal.threads.listThreadAttachmentsInternal, {
        threadId: context.threadId,
        orgId: context.orgId,
        excludeEmailArtifacts: true,
        excludeAgentCoiAttachments: hasStructuredCoiRequest,
      })
    : [];
  const availableAttachments = uniqueAttachments([
    ...(context.availableAttachments ?? []),
    ...savedThreadAttachments,
  ]);
  const attachedOriginalPolicyIds = new Set<string>();
  const attachedUploadedFileIds = new Set<string>();
  const attachedCoiKeys = new Set<string>();
  const singleOrgScope: AgentScope = {
    mode: "client",
    surface: context.channel,
    primaryOrgId: context.orgId,
    readOrgIds: [context.orgId],
    writableOrgIds: [context.orgId],
    orgs: [],
    brokerInternal: false,
  };

  const attachOriginalPolicy = async (policyId: string): Promise<string> => {
    if (!context.userId) {
      return "Cannot attach a policy document without an authenticated user context.";
    }
    if (!allowedOriginalPolicyIds.has(policyId)) {
      return "The original policy was not attached because the request did not explicitly identify that artifact and policy.";
    }
    const requestPolicyKey = normalizeAttachmentText(policyId);
    if (attachedOriginalPolicyIds.has(requestPolicyKey)) {
      return "Original policy is already attached.";
    }
    let resolvedPolicyId: Id<"policies"> | undefined;
    let policyAttachment: EmailAttachmentMeta | undefined;
    const executors = buildAgentToolExecutors(ctx, {
      surface: context.channel,
      orgId: context.orgId,
      userId: context.userId,
      scope: singleOrgScope,
      onPolicyReferenced: (referencedPolicyId) => {
        resolvedPolicyId = referencedPolicyId;
        sourcePolicyIds.add(referencedPolicyId);
      },
      onResponseAttachment: (attachment) => {
        if (!attachment.fileId) return;
        policyAttachment = {
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          fileId: attachment.fileId,
        };
      },
    });
    const result = await executors.attach_policy_document.execute({ policyId });
    if (!policyAttachment) {
      return typeof result === "string"
        ? result
        : "That policy does not have an original file available.";
    }
    attachedOriginalPolicyIds.add(requestPolicyKey);
    if (resolvedPolicyId)
      attachedOriginalPolicyIds.add(String(resolvedPolicyId));
    preparedAttachments.push({
      ...policyAttachment,
      kind: "original_policy",
    });
    return `Attached original policy document: ${policyAttachment.filename}`;
  };

  const attachUploadedFile = (fileId: string, filename?: string): string => {
    if (attachedUploadedFileIds.has(fileId)) {
      return "Uploaded file is already attached.";
    }
    const found = availableAttachments.find(
      (att) => String(att.fileId) === fileId,
    );
    if (!found) {
      return "That uploaded file is not available in this conversation.";
    }
    if (hasStructuredCoiRequest && found.kind !== "coi") {
      return "Skipped uploaded file because COI delivery requests should attach only the generated COI.";
    }
    attachedUploadedFileIds.add(fileId);
    preparedAttachments.push({
      ...found,
      filename: filename ?? found.filename,
      kind: "uploaded_file",
    });
    return `Attached uploaded file: ${filename ?? found.filename}`;
  };

  const generateCoiAttachment = async (
    policyId?: string,
    certificateHolder?: string,
    holderContactName?: string,
    holderEmail?: string,
    holderPhone?: string,
    addressLine1?: string,
    addressLine2?: string,
    city?: string,
    state?: string,
    postalCode?: string,
    country?: string,
    requestText?: string,
    requestedEndorsements?: string[],
    additionalInsuredName?: string,
    requirementSourceDocumentId?: string,
    requirementId?: string,
  ): Promise<string> => {
    if (!context.userId) {
      return "Cannot generate a COI without an authenticated user context.";
    }
    const holderKey = normalizeAttachmentText(certificateHolder);
    const requestReference =
      policyId ?? requirementSourceDocumentId ?? requirementId;
    const requestCoiKey = `${normalizeAttachmentText(requestReference)}:${holderKey}`;
    if (attachedCoiKeys.has(requestCoiKey)) {
      return "Generated COI is already attached.";
    }
    let resolvedPolicyId: Id<"policies"> | undefined;
    const generatedAttachments: EmailAttachmentMeta[] = [];
    const executors = buildAgentToolExecutors(ctx, {
      surface: context.channel,
      orgId: context.orgId,
      userId: context.userId,
      scope: singleOrgScope,
      onPolicyReferenced: (referencedPolicyId) => {
        resolvedPolicyId = referencedPolicyId;
        sourcePolicyIds.add(referencedPolicyId);
      },
      onResponseAttachment: (attachment) => {
        if (!attachment.fileId) return;
        generatedAttachments.push({
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          fileId: attachment.fileId,
        });
      },
    });
    const result = await executors.generate_coi.execute({
      policyId,
      requirementSourceDocumentId,
      requirementId,
      certificateHolder,
      holderContactName,
      holderEmail,
      holderPhone,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      requestText,
      requestedEndorsements,
      additionalInsuredName,
    });

    if (generatedAttachments.length > 0) {
      const resolvedCoiKey = `${resolvedPolicyId ?? policyId}:${holderKey}`;
      attachedCoiKeys.add(requestCoiKey);
      attachedCoiKeys.add(resolvedCoiKey);
      for (const generatedAttachment of generatedAttachments) {
        preparedAttachments.push({ ...generatedAttachment, kind: "coi" });
      }
      return `Attached ${generatedAttachments.length} COI${generatedAttachments.length === 1 ? "" : "s"}.`;
    }

    if (typeof result === "string") return result;
    if (result && typeof result === "object") {
      const output = result as {
        message?: string;
        attachment?: EmailAttachmentMeta;
      };
      if (output.attachment?.fileId) {
        const resolvedCoiKey = `${resolvedPolicyId ?? policyId}:${holderKey}`;
        attachedCoiKeys.add(requestCoiKey);
        attachedCoiKeys.add(resolvedCoiKey);
        preparedAttachments.push({ ...output.attachment, kind: "coi" });
        return "Attached COI.";
      }
      if (output.message) return output.message;
    }
    return "COI request completed.";
  };

  for (const requested of safeRequestedAttachments.attachments) {
    if (requested.kind === "original_policy" && requested.policyId) {
      await attachOriginalPolicy(requested.policyId);
    } else if (
      requested.kind === "coi" &&
      (requested.policyId ||
        requested.requirementSourceDocumentId ||
        requested.requirementId)
    ) {
      await generateCoiAttachment(
        requested.policyId,
        requested.certificateHolder,
        requested.holderContactName,
        requested.holderEmail,
        requested.holderPhone,
        requested.addressLine1,
        requested.addressLine2,
        requested.city,
        requested.state,
        requested.postalCode,
        requested.country,
        requested.requestText,
        requested.requestedEndorsements,
        undefined,
        requested.requirementSourceDocumentId,
        requested.requirementId,
      );
    } else if (requested.kind === "uploaded_file" && requested.fileId) {
      attachUploadedFile(requested.fileId, requested.filename);
    }
  }

  let finalResult: EmailSubagentResult | null = null;
  const policies = await ctx.runQuery(internal.policies.listAllInternal, {
    orgId: context.orgId,
  });
  const availablePolicies = policies.slice(0, 25).map((policy) => ({
    id: policy._id,
    insured: policy.insuredName,
    carrier: policy.security ?? policy.carrier,
    type: policyLobCodes(policy)
      .filter((code) => code !== "UN")
      .map(lobLabel)
      .join(", "),
    number: policy.policyNumber,
    fileName: policy.fileName,
    hasOriginalFile: !!policy.fileId,
  }));

  const allowedRecipients = (context.allowedRecipients ?? [])
    .map(normalizeEmailAddress)
    .filter(Boolean);
  const blockedCopyEmails = new Set(
    (context.blockedCopyEmails ?? [])
      .map(normalizeEmailAddress)
      .filter(Boolean),
  );
  const defaultCc = [
    ...new Set(
      [...(context.defaultCc ?? []), ...(input.cc ?? [])].filter(Boolean),
    ),
  ];
  const defaultBcc = [
    ...new Set(
      [...(context.defaultBcc ?? []), ...(input.bcc ?? [])].filter(Boolean),
    ),
  ];

  const sendOrDraftEmail = async (params: {
    to?: string;
    recipientName?: string;
    subject?: string;
    body?: string;
    cc?: string[];
    bcc?: string[];
  }): Promise<EmailSubagentResult> => {
    const to =
      extractEmailAddress(params.to) ??
      extractEmailAddress(input.to) ??
      extractEmailAddress(directedDefaultTo);
    const subject = (
      params.subject ??
      input.subject ??
      context.subjectHint ??
      ""
    ).trim();
    const body = cleanAgentMarkdownForTransport(
      params.body ?? input.body ?? "",
    );
    const cc = [
      ...new Set(
        [...(params.cc ?? []), ...defaultCc]
          .map(normalizeEmailAddress)
          .filter(
            (email) => email && email !== to && !blockedCopyEmails.has(email),
          ),
      ),
    ];
    const bcc = [
      ...new Set(
        [...(params.bcc ?? []), ...defaultBcc]
          .map(normalizeEmailAddress)
          .filter(
            (email) =>
              email &&
              email !== to &&
              !cc.includes(email) &&
              !blockedCopyEmails.has(email),
          ),
      ),
    ];
    const attachments = uniqueAttachments(preparedAttachments);
    const referencedPolicyIds =
      sourcePolicyIds.size > 0 ? [...sourcePolicyIds] : undefined;

    const uncertainty: string[] = [];
    if (safeRequestedAttachments.requiresCoiBatchConfirmation) {
      uncertainty.push(MULTIPLE_COI_SINGLE_RECIPIENT_WARNING);
    }
    if (!to) {
      uncertainty.push("Confirm the recipient email address.");
    }
    if (!subject) uncertainty.push("Confirm the subject line.");
    if (!body) uncertainty.push("Confirm the email body.");
    const unknownRecipients = [to, ...cc, ...bcc]
      .filter((email): email is string => !!email)
      .filter(
        (email) =>
          allowedRecipients.length > 0 &&
          !allowedRecipients.includes(email) &&
          !(
            explicitSendRequested &&
            sourceUserMessage &&
            sourceExplicitlyNamesEmailAddress(sourceUserMessage.content, email)
          ),
      );
    if (context.requireKnownRecipient && unknownRecipients.length > 0) {
      const message =
        "I cannot use that recipient because it is not a known contact in Spot. Add the contact in settings or provide the correct recipient explicitly.";
      finalResult = {
        status: "needs_confirmation",
        responseBody: message,
        confirmationReason: message,
      };
      return finalResult;
    }
    if (unknownRecipients.length > 0) {
      uncertainty.push(
        `Confirm that ${unknownRecipients.join(", ")} ${unknownRecipients.length === 1 ? "is" : "are"} the intended recipient${unknownRecipients.length === 1 ? "" : "s"}.`,
      );
    }

    if (uncertainty.length > 0 || !explicitSendAuthorization) {
      const status = uncertainty.length > 0 ? "needs_confirmation" : "draft";
      const sendBlockedReason =
        uncertainty.length > 0 ? uncertainty.join(" ") : undefined;
      const draftPendingEmailId =
        to && subject && body
          ? await upsertEmailDraftArtifact(ctx, context, {
              to,
              cc,
              bcc,
              subject,
              body,
              attachments,
              referencedPolicyIds,
              sendBlockedReason,
            })
          : undefined;
      finalResult = {
        status,
        responseBody: formatDraft({
          to: to ?? undefined,
          cc,
          bcc,
          subject,
          body,
          attachments,
          reason: uncertainty.length > 0 ? uncertainty.join(" ") : undefined,
        }),
        confirmationReason:
          uncertainty.length > 0 ? uncertainty.join(" ") : "Ready to send?",
        responseTo: to ?? undefined,
        responseCc: cc.length > 0 ? cc : undefined,
        responseBcc: bcc.length > 0 ? bcc : undefined,
        subject,
        emailBody: body,
        pendingEmailId: draftPendingEmailId,
        attachments,
      };
      return finalResult;
    }

    if (!to) throw new Error("Recipient email is required before sending.");
    const sendTo = to;
    const signature = buildEmailSignature(context.agentAddress);
    const emailPayload = buildEmailPayload({
      fromHeader: context.fromHeader,
      to: sendTo,
      cc,
      bcc,
      subject,
      body,
      signature,
      inReplyTo: context.inReplyTo,
      references: context.references,
      replyTo: context.replyTo,
    });

    const sendDelay = context.emailSendDelay ?? 5;
    if (sendDelay > 0 && context.threadId) {
      const scheduledSendTime = dayjs().add(sendDelay, "second").valueOf();
      const persistedDraftId = await queueEmailDraftArtifact(ctx, context, {
        to: sendTo,
        cc,
        bcc,
        subject,
        body,
        attachments,
        referencedPolicyIds,
        scheduledSendTime,
        explicitSendAuthorization,
      });
      const pendingEmailId =
        persistedDraftId ??
        (await ctx.runMutation(internal.pendingEmails.create, {
          orgId: context.orgId,
          threadId: context.threadId,
          scheduledSendTime,
          chatMessageId: context.chatMessageId,
          recipientEmail: sendTo,
          ccAddresses: cc.length > 0 ? cc : undefined,
          bccAddresses: bcc.length > 0 ? bcc : undefined,
          subject,
          emailBody: body,
          fromHeader: context.fromHeader,
          replyTo: context.replyTo,
          inReplyTo: context.inReplyTo,
          references: context.references,
          renderedText: emailPayload.text,
          renderedHtml: emailPayload.html,
          attachments: attachments.length > 0 ? attachments : undefined,
          referencedPolicyIds,
          explicitSendAuthorization,
        }));
      await ctx.scheduler.runAfter(
        sendDelay * 1000,
        internal.actions.sendPendingEmail.sendPending,
        { id: pendingEmailId },
      );
      const pendingResult: EmailSubagentResult = {
        status: "pending",
        responseBody: `Sending email to ${sendTo}${cc.length > 0 ? ` (CC: ${cc.join(", ")})` : ""}...`,
        responseTo: sendTo,
        responseCc: cc.length > 0 ? cc : undefined,
        responseBcc: bcc.length > 0 ? bcc : undefined,
        subject,
        emailBody: body,
        pendingEmailId,
        attachments,
      };
      finalResult = pendingResult;
      return pendingResult;
    }

    const persistedDraftId = await upsertEmailDraftArtifact(ctx, context, {
      to: sendTo,
      cc,
      bcc,
      subject,
      body,
      attachments,
      referencedPolicyIds,
    });
    if (persistedDraftId) {
      await ctx.runAction(internal.actions.sendPendingEmail.sendDraftInternal, {
        id: persistedDraftId,
        authorization: {
          kind: "channel_explicit_action",
          ...explicitSendAuthorization,
        },
      });
      const sentDraft = await ctx.runQuery(internal.pendingEmails.getInternal, {
        id: persistedDraftId,
      });
      const sentResult: EmailSubagentResult = {
        status: "sent",
        responseBody: `Email sent to ${sendTo}${cc.length > 0 ? ` (CC: ${cc.join(", ")})` : ""}.`,
        responseTo: sendTo,
        responseCc: cc.length > 0 ? cc : undefined,
        responseBcc: bcc.length > 0 ? bcc : undefined,
        subject,
        emailBody: body,
        responseMessageId: sentDraft?.sentMessageId,
        pendingEmailId: persistedDraftId,
        attachments,
      };
      finalResult = sentResult;
      return sentResult;
    }

    if (attachments.length > 0) {
      emailPayload.attachments = await toResendAttachments(ctx, attachments);
    }
    const sendOutcome = await sendTrackedResendEmail(ctx, {
      source: "email_subagent",
      orgId: context.orgId,
      threadId: context.threadId,
      recipientEmail: sendTo,
      ccAddresses: cc.length > 0 ? cc : undefined,
      bccAddresses: bcc.length > 0 ? bcc : undefined,
      subject,
      payload: emailPayload,
    });
    if (!sendOutcome.ok)
      throw new Error(`Failed to send email: ${sendOutcome.error}`);
    const sentMessageId = sendOutcome.id;

    if (context.threadId) {
      await ctx.runMutation(internal.threads.insertEmailMessage, {
        threadId: context.threadId,
        orgId: context.orgId,
        role: "agent",
        content: body,
        toAddresses: [sendTo],
        ccAddresses: cc.length > 0 ? cc : undefined,
        bccAddresses: bcc.length > 0 ? bcc : undefined,
        subject,
        responseMessageId: sentMessageId,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
    }

    const sentResult: EmailSubagentResult = {
      status: "sent",
      responseBody: `Email sent to ${sendTo}${cc.length > 0 ? ` (CC: ${cc.join(", ")})` : ""}.`,
      responseTo: sendTo,
      responseCc: cc.length > 0 ? cc : undefined,
      responseBcc: bcc.length > 0 ? bcc : undefined,
      subject,
      emailBody: body,
      responseMessageId: sentMessageId,
      attachments,
    };
    finalResult = sentResult;
    return sentResult;
  };

  const emailRunId = `${context.routingParentId}:email-draft`;
  const subagentResult = await generateAgentTextForOrg(
    ctx,
    context.orgId,
    "email_draft",
    {
      maxOutputTokens: 1536,
      system: `You are Spot's email expert subagent.

You only handle Spot Agent outbound email. Your job is to draft or send polished insurance-business emails from ${context.agentAddress}.

Be careful by default:
- If the recipient email is missing, inferred, or not clearly the intended recipient, do not send. Produce a draft and ask for confirmation.
- Never invent broker, carrier, underwriter, General Agent, client, or vendor recipient emails. If a requested recipient is not supplied or present in known contacts/context, ask for the missing contact information instead.
- If the request says "email me", "send me", or "email this to me", use the supplied default recipient as the recipient.
- If the subject, body, or requested attachments are ambiguous, do not send.
- Respect deliveryIntent. An affirmative current-turn send request may send the generated draft; draft-only, negated, advisory, or uncertain requests must remain drafts. The final sender independently validates the persisted user message.
- Attach original policy PDFs or generated COIs when requested. Never claim an attachment is included unless you used an attachment tool or it was already attached.
- If the requested document is already listed in availableUploadedAttachments, attach that exact saved file. For follow-ups like "send that" after Spot generated a COI, reuse the matching saved COI instead of generating another certificate.
- Available uploaded attachments may include files saved from connected mailboxes, including .eml exports of source emails. If the user asks to attach the email itself or proof from an email body, attach the saved .eml export with attach_uploaded_file.
- For certificate/COI delivery requests, attach only the generated COI unless the request separately asks for the original/full policy PDF too.
- When drafting COIs for multiple recipients, each recipient's email must include only that recipient's generated COI, not the full batch of generated COIs.
- When the user explicitly asks to bundle all COIs/certificates into one email for a single recipient, attach the requested COIs together in that one email.
- ${COI_DISCLAIMER}
- Do not call an attachment tool for a document that is already listed in preparedAttachments.
- Use concise professional formatting. Prefer 1-3 short paragraphs or a short bullet list.
- Include only the policy facts that are directly useful to the recipient. Avoid exhaustive coverage memos unless explicitly requested.
- ${NO_OPEN_ENDED_OFFERS}
- ${NO_SIGN_OFF}

Call send_or_draft_email exactly once after preparing any requested attachments.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            channel: context.channel,
            request: input.request,
            supplied: {
              to: input.to ?? directedDefaultTo,
              recipientName: input.recipientName,
              defaultRecipientName: directedRecipientName,
              subject: input.subject ?? context.subjectHint,
              body: input.body,
              deliveryIntent: input.deliveryIntent,
              cc: defaultCc,
              bcc: defaultBcc,
              recipientDirection: input.recipientDirection,
              recipientGuard: context.requireKnownRecipient
                ? {
                    requireKnownRecipient: true,
                  }
                : undefined,
            },
            requestedAttachments: input.attachments ?? [],
            attachmentSafetyWarning:
              safeRequestedAttachments.requiresCoiBatchConfirmation
                ? MULTIPLE_COI_SINGLE_RECIPIENT_WARNING
                : undefined,
            preparedAttachments: preparedAttachments.map((att) => ({
              filename: att.filename,
              contentType: att.contentType,
              fileId: att.fileId,
            })),
            conversationContext: context.conversationContext,
            availablePolicies,
            availableUploadedAttachments: availableAttachments.map((att) => ({
              fileId: att.fileId,
              filename: att.filename,
              contentType: att.contentType,
            })),
          }),
        },
      ],
      tools: {
        attach_original_policy: tool({
          description: "Attach the original PDF file for a policy.",
          inputSchema: z.object({
            policyId: z.string(),
          }),
          execute: async ({ policyId }) => attachOriginalPolicy(policyId),
        }),
        attach_uploaded_file: tool({
          description:
            "Attach a file that the user uploaded in this conversation.",
          inputSchema: z.object({
            fileId: z.string(),
            filename: z.string().optional(),
          }),
          execute: async ({ fileId, filename }) =>
            attachUploadedFile(fileId, filename),
        }),
        generate_coi_attachment: tool({
          description:
            "Attach certificates in either policy mode or requirements-source mode. Never combine the modes.",
          inputSchema: z.object({
            policyId: z.string().optional(),
            requirementSourceDocumentId: z.string().optional(),
            requirementId: z.string().optional(),
            certificateHolder: z.string().optional(),
            holderContactName: z.string().optional(),
            holderEmail: z.string().optional(),
            holderPhone: z.string().optional(),
            addressLine1: z.string().optional(),
            addressLine2: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            postalCode: z.string().optional(),
            country: z.string().optional(),
            requestText: z.string().optional(),
            requestedEndorsements: z.array(z.string()).optional(),
            additionalInsuredName: z.string().optional(),
          }),
          execute: async ({
            policyId,
            certificateHolder,
            holderContactName,
            holderEmail,
            holderPhone,
            addressLine1,
            addressLine2,
            city,
            state,
            postalCode,
            country,
            requestText,
            requestedEndorsements,
            additionalInsuredName,
            requirementSourceDocumentId,
            requirementId,
          }) =>
            generateCoiAttachment(
              policyId,
              certificateHolder,
              holderContactName,
              holderEmail,
              holderPhone,
              addressLine1,
              addressLine2,
              city,
              state,
              postalCode,
              country,
              requestText,
              requestedEndorsements,
              additionalInsuredName,
              requirementSourceDocumentId,
              requirementId,
            ),
        }),
        send_or_draft_email: tool({
          description:
            "Finalize the email. This either sends, queues, or returns a confirmation draft based on safety and org settings.",
          inputSchema: z.object({
            to: z.string().optional(),
            recipientName: z.string().optional(),
            subject: z.string().optional(),
            body: z.string().optional(),
            cc: z.array(z.string()).optional(),
            bcc: z.array(z.string()).optional(),
          }),
          execute: sendOrDraftEmail,
        }),
      },
      stopWhen: stepCountIs(8),
    },
    {
      taskKind: "email_draft_tool_loop",
      sessionKey: String(context.threadId ?? context.orgId),
      trace: {
        traceId: emailRunId,
        parentRequestId: context.routingParentId,
        label: "convex.emailSubagent",
        phase: "email_draft_tool_loop",
        channel: context.channel,
      },
    },
  );

  if (finalResult) return finalResult;

  return {
    status: "draft",
    responseBody:
      cleanAgentMarkdownForTransport(subagentResult.text) ||
      "I drafted the email, but need confirmation before sending.",
  };
}
