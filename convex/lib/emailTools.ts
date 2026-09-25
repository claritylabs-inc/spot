"use node";

import { tool } from "ai";
import { z } from "zod";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildAgentToolExecutors } from "./agentToolExecutors";
import type { AgentScope } from "./agentScope";
import { extractEmailAddress, normalizeEmailAddress } from "./emailAddress";
import {
  isActorBoundExplicitEmailSendSource,
  sourceExplicitlyNamesEmailAddress,
} from "./emailSendAuthorization";
import { cleanAgentMarkdownForTransport } from "./transportRenderers";
import { buildEmailPayload, type EmailAttachmentMeta } from "./emailDelivery";
import { buildEmailSignature, getEmailAgentFromName } from "./emailIdentity";
import {
  COI_DISCLAIMER,
  NO_OPEN_ENDED_OFFERS,
  NO_SIGN_OFF,
} from "./channelStyle";
import {
  MULTIPLE_COI_SINGLE_RECIPIENT_WARNING,
  countCoiAttachments,
  normalizeAttachmentText,
  resolveRequestedCoiAttachmentsForRecipient,
} from "./coiAttachmentGuards";
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

export const EMAIL_FAMILY_GUIDANCE = `EMAIL DRAFTS AND DELIVERY:
Use draft_email to prepare an email, attachment tools to add requested files, and send_email_draft only for a current affirmative send request. Updates replace the draft; omitted CC, BCC, and attachments are cleared. Preserve attachments on an update by supplying their attachmentFileIds.
Never invent recipient addresses. If the request says "email me" or "send me", set recipientDirection to requester. Use explicit direction for a supplied recipient. Ask for missing or ambiguous recipients, subject, body, or requested attachments before sending. Draft-only, negated, advisory, and uncertain requests remain drafts; the sender independently checks the stored user-message authorization.
Attach only requested documents. Use attach_file_to_draft for exact saved files already generated or uploaded, including follow-ups like "send that" and saved .eml exports. Use attach_coi_to_draft only when a new certificate is needed. Original/full policy PDFs require a separate explicit request and intent evidence. For COI requests, include only the generated COI unless the original PDF was separately requested. Each recipient receives only their own COI; a requested bundle of multiple COIs needs exact recipient and attachment confirmation. Never claim a file is attached until an attachment tool succeeds, and do not reattach files already listed on the draft.
${COI_DISCLAIMER}
Use concise professional formatting: 1–3 short paragraphs or a short bullet list. Include only policy facts directly useful to the recipient; avoid exhaustive coverage memos unless requested.
${NO_OPEN_ENDED_OFFERS}
${NO_SIGN_OFF}`;

export type EmailToolResult = {
  status:
    | "draft"
    | "needs_confirmation"
    | "pending"
    | "sent"
    | "cancelled"
    | "error";
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
  cancelled: {
    status: "completed",
    nextAction: "email_cancelled",
    sideEffectKind: "record_updated",
  },
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
} as const satisfies Record<EmailToolResult["status"], object>;

function withEmailWorkflowOutcome(result: EmailToolResult): EmailToolResult {
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

export type EmailToolContext = {
  orgId: Id<"organizations">;
  userId?: Id<"users">;
  threadId?: Id<"threads">;
  sourceUserMessageId?: Id<"threadMessages">;
  chatMessageId?: Id<"threadMessages">;
  routingParentId?: string;
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
  scope?: AgentScope;
  // The direct MCP compatibility adapter carries its explicit original-policy list here.
  mcpOriginalPolicyIds?: string[];
  // Supplied only by authenticated server adapters, never model arguments.
  sendAuthorization?:
    | { kind: "confirmation"; confirmationId: Id<"threadActionConfirmations"> }
    | { kind: "mcp_explicit_action" };
  onResult?: (result: EmailToolResult) => void;
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
    const key = String(att.fileId);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(att);
  }
  return result;
}

const draftFields = {
  to: z.string().optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  recipientDirection: z.enum(["requester", "explicit"]).optional(),
};
const draftIdSchema = z.object({ draftId: z.string() });
const draftSchema = z.object(draftFields);
const updateSchema = z.object({
  draftId: z.string(),
  ...draftFields,
  attachmentFileIds: z
    .array(z.string())
    .optional()
    .describe(
      "Existing draft attachments to retain. Omission clears attachments.",
    ),
});
const policySchema = z.object({
  draftId: z.string(),
  policyId: z.string(),
  explicitArtifactRequest: z.literal("original_policy_document"),
  intentEvidence: z
    .string()
    .describe("The user's explicit request for the original/full policy PDF."),
});
const fileSchema = z.object({
  draftId: z.string(),
  fileId: z.string(),
  filename: z.string().optional(),
});
const coiSchema = z.object({
  draftId: z.string(),
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
});

type DraftFields = z.infer<typeof draftSchema>;
type Draft = Doc<"pendingEmails">;
type DraftContent = {
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: EmailAttachmentMeta[];
  referencedPolicyIds?: Id<"policies">[];
};

export function serializeEmailDraft(draft: Draft) {
  return {
    id: draft._id,
    status: draft.status,
    threadId: draft.threadId,
    threadMessageId: draft.threadMessageId,
    recipientEmail: draft.recipientEmail,
    ccAddresses: draft.ccAddresses,
    bccAddresses: draft.bccAddresses,
    subject: draft.subject,
    emailBody: draft.emailBody,
    attachments: draft.attachments,
    scheduledSendTime: draft.scheduledSendTime,
    sentMessageId: draft.sentMessageId,
    createdAt: draft._creationTime,
  };
}
export type SerializedEmailDraft = ReturnType<typeof serializeEmailDraft>;

function draftContent(draft: Draft): DraftContent {
  return {
    to: draft.recipientEmail,
    cc: draft.ccAddresses ?? [],
    bcc: draft.bccAddresses ?? [],
    subject: draft.subject,
    body: draft.emailBody,
    attachments: draft.attachments ?? [],
    referencedPolicyIds: draft.referencedPolicyIds,
  };
}

export function buildEmailToolExecutors(
  ctx: ActionCtx,
  context: EmailToolContext,
) {
  let activeThreadId = context.threadId;
  let pendingExecution = Promise.resolve();

  function serialized<Input, Result>(
    execute: (input: Input) => Promise<Result>,
  ) {
    return (input: Input): Promise<Result> => {
      const result = pendingExecution.then(() => execute(input));
      pendingExecution = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    };
  }
  const attachedPolicyKeys = new Set<string>();
  const attachedCoiKeys = new Set<string>();
  const attachmentFailures = new Map<string, Map<string, string>>();
  const attachmentFailurePrefix = "Requested attachments are not ready:";
  const mcpOriginalPolicyIds =
    context.channel === "mcp" ? (context.mcpOriginalPolicyIds ?? []) : [];

  function failuresFor(draft: Draft) {
    let failures = attachmentFailures.get(draft._id);
    if (!failures) {
      failures = new Map();
      if (draft.sendBlockedReason?.startsWith(attachmentFailurePrefix)) {
        failures.set("previous_turn", draft.sendBlockedReason);
      }
      attachmentFailures.set(draft._id, failures);
    }
    return failures;
  }

  function attachmentBlocker(draft: Draft): string | undefined {
    const failures = failuresFor(draft);
    if (!failures.size) return undefined;
    if (failures.has("previous_turn")) return [...failures.values()].join(" ");
    return `${attachmentFailurePrefix} ${[...failures.values()].join(" ")} Resolve the requested attachments, or explicitly replace the draft to revise its attachment requirements.`;
  }

  function resetDraftState(draftId: string) {
    attachmentFailures.delete(draftId);
    for (const keys of [attachedPolicyKeys, attachedCoiKeys]) {
      for (const key of keys)
        if (key.startsWith(`${draftId}:`)) keys.delete(key);
    }
  }
  const scope: AgentScope = context.scope ?? {
    mode: "client",
    surface: context.channel,
    primaryOrgId: context.orgId,
    readOrgIds: [context.orgId],
    writableOrgIds: [context.orgId],
    orgs: [],
    brokerInternal: false,
  };

  function assertScope(write: boolean) {
    const orgs = write ? scope.writableOrgIds : scope.readOrgIds;
    if (!orgs.includes(context.orgId))
      throw new Error("Email access is not available for this organization.");
  }

  async function assertThread(threadId: Id<"threads">) {
    if (activeThreadId && threadId !== activeThreadId)
      throw new Error("Thread not found");
    const thread = await ctx.runQuery(internal.threads.getInternal, {
      id: threadId,
    });
    if (!thread || thread.orgId !== context.orgId)
      throw new Error("Thread not found");
  }

  async function getDraft(draftId: string, writable = true): Promise<Draft> {
    assertScope(writable);
    const draft = await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: draftId as Id<"pendingEmails">,
    });
    if (
      !draft ||
      draft.orgId !== context.orgId ||
      (activeThreadId && draft.threadId !== activeThreadId)
    )
      throw new Error("Draft not found");
    if (draft.threadId) await assertThread(draft.threadId);
    return draft;
  }

  function assertEditable(draft: Draft) {
    if (draft.status !== "draft")
      throw new Error("Only draft emails can be updated");
  }

  function emit(result: EmailToolResult): EmailToolResult {
    const output = withEmailWorkflowOutcome(result);
    context.onResult?.(output);
    return output;
  }

  function resultForDraft(
    draft: Draft,
    reason?: string,
    responseBody?: string,
  ): EmailToolResult {
    const content = draftContent(draft);
    return emit({
      status: reason ? "needs_confirmation" : "draft",
      responseBody: responseBody ?? formatDraft({ ...content, reason }),
      confirmationReason: reason ?? "Ready to send?",
      responseTo: content.to || undefined,
      responseCc: content.cc.length ? content.cc : undefined,
      responseBcc: content.bcc.length ? content.bcc : undefined,
      subject: content.subject,
      emailBody: content.body,
      pendingEmailId: draft._id,
      attachments: content.attachments,
    });
  }

  async function sourceAuthorization() {
    const message = context.sourceUserMessageId
      ? await ctx.runQuery(internal.threads.getMessageInternal, {
          id: context.sourceUserMessageId,
        })
      : null;
    const authorization =
      context.userId &&
      activeThreadId &&
      context.sourceUserMessageId &&
      isActorBoundExplicitEmailSendSource({
        message,
        orgId: context.orgId,
        threadId: activeThreadId,
        actorUserId: context.userId,
        actorEmail: context.senderEmail,
      })
        ? {
            kind: "channel_explicit_action" as const,
            actorUserId: context.userId,
            sourceMessageId: context.sourceUserMessageId,
          }
        : undefined;
    return { message, authorization };
  }

  async function blockers(content: DraftContent): Promise<string[]> {
    const reasons: string[] = [];
    if (!extractEmailAddress(content.to))
      reasons.push("Confirm the recipient email address.");
    if (!content.subject) reasons.push("Confirm the subject line.");
    if (!content.body) reasons.push("Confirm the email body.");
    if (countCoiAttachments(content.attachments) > 1)
      reasons.push(MULTIPLE_COI_SINGLE_RECIPIENT_WARNING);
    const allowed = (context.allowedRecipients ?? []).map(
      normalizeEmailAddress,
    );
    const { message, authorization } = await sourceAuthorization();
    const recipients = [content.to, ...content.cc, ...content.bcc].filter(
      Boolean,
    );
    const malformed = recipients.filter((email) => !extractEmailAddress(email));
    if (malformed.length)
      reasons.push(
        `Confirm valid email addresses for ${malformed.join(", ")}.`,
      );
    const unknown = recipients.filter(
      (email) =>
        allowed.length > 0 &&
        !allowed.includes(email) &&
        !(
          authorization &&
          message &&
          sourceExplicitlyNamesEmailAddress(message.content, email)
        ),
    );
    if (unknown.length) {
      reasons.push(
        context.requireKnownRecipient
          ? "I cannot use that recipient because it is not a known contact in Spot. Add the contact in settings or provide the correct recipient explicitly."
          : `Confirm that ${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} the intended recipient${unknown.length === 1 ? "" : "s"}.`,
      );
    }
    return reasons;
  }

  function normalizeContent(
    input: DraftFields,
    existing?: Draft,
  ): DraftContent {
    const recipient =
      input.recipientDirection === "requester"
        ? (context.defaultTo ?? context.senderEmail)
        : (input.to ??
          (input.recipientDirection === "explicit"
            ? undefined
            : (existing?.recipientEmail ?? context.defaultTo)));
    const to = extractEmailAddress(recipient) ?? "";
    const blocked = new Set(
      (context.blockedCopyEmails ?? []).map(normalizeEmailAddress),
    );
    const normalizeCopies = (addresses: string[]) => [
      ...new Set(
        addresses
          .map(
            (address) =>
              extractEmailAddress(address) ?? normalizeEmailAddress(address),
          )
          .filter(
            (address) => address && address !== to && !blocked.has(address),
          ),
      ),
    ];
    const cc = normalizeCopies([
      ...(input.cc ?? []),
      ...(context.defaultCc ?? []),
    ]);
    const bcc = normalizeCopies([
      ...(input.bcc ?? []),
      ...(context.defaultBcc ?? []),
    ]).filter((address) => !cc.includes(address));
    return {
      to,
      cc,
      bcc,
      subject: (
        input.subject ??
        existing?.subject ??
        context.subjectHint ??
        ""
      ).trim(),
      body: cleanAgentMarkdownForTransport(
        input.body ?? existing?.emailBody ?? "",
      ),
      attachments: [],
      referencedPolicyIds: context.referencedPolicyIds,
    };
  }

  async function persist(
    content: DraftContent,
    existing?: Draft,
    replacement = false,
  ): Promise<Draft> {
    assertScope(true);
    if (existing) assertEditable(existing);
    if (activeThreadId) await assertThread(activeThreadId);
    if (!activeThreadId && !existing?.threadId) {
      if (!context.userId)
        throw new Error(
          "An authenticated user is required to create an email thread.",
        );
      activeThreadId = await ctx.runMutation(internal.threads.createInternal, {
        orgId: context.orgId,
        userId: context.userId,
        title: content.subject || "Email Draft",
      });
    }
    const threadId = existing?.threadId ?? activeThreadId;
    const reasons = await blockers(content);
    const failedAttachment =
      !replacement && existing ? attachmentBlocker(existing) : undefined;
    if (failedAttachment) reasons.unshift(failedAttachment);
    const payload = buildEmailPayload({
      fromHeader: context.fromHeader,
      to: content.to,
      cc: content.cc,
      bcc: content.bcc,
      subject: content.subject,
      body: content.body,
      signature: buildEmailSignature(context.agentAddress),
      replyTo: context.replyTo,
      inReplyTo: context.inReplyTo,
      references: context.references,
    });
    const fields = {
      recipientEmail: content.to,
      ccAddresses: content.cc.length ? content.cc : undefined,
      bccAddresses: content.bcc.length ? content.bcc : undefined,
      subject: content.subject,
      emailBody: content.body,
      fromHeader: context.fromHeader,
      replyTo: context.replyTo,
      inReplyTo: context.inReplyTo,
      references: context.references,
      renderedText: payload.text,
      renderedHtml: payload.html,
      attachments: content.attachments.length
        ? uniqueAttachments(content.attachments)
        : undefined,
      referencedPolicyIds: content.referencedPolicyIds?.length
        ? content.referencedPolicyIds
        : undefined,
      chatMessageId: context.chatMessageId,
      sendBlockedReason: reasons.length ? reasons.join(" ") : undefined,
    };
    const id =
      existing?._id ??
      (await ctx.runMutation(internal.pendingEmails.create, {
        ...fields,
        orgId: context.orgId,
        threadId,
        status: "draft",
        scheduledSendTime: 0,
      }));
    if (existing)
      await ctx.runMutation(internal.pendingEmails.updateDraftInternal, {
        id,
        ...fields,
      });
    const messageFields = {
      content: content.body,
      toAddresses: content.to ? [content.to] : [],
      ccAddresses: content.cc,
      bccAddresses: content.bcc,
      subject: content.subject,
      attachments: content.attachments,
      pendingEmailId: id,
      status: "draft_email" as const,
    };
    if (existing?.threadMessageId) {
      await ctx.runMutation(internal.threads.updateEmailMessage, {
        id: existing.threadMessageId,
        ...messageFields,
      });
    } else if (threadId) {
      const threadMessageId = await ctx.runMutation(
        internal.threads.insertEmailMessage,
        {
          threadId,
          orgId: context.orgId,
          role: "agent",
          fromEmail: context.agentAddress,
          fromName: getEmailAgentFromName(),
          ...messageFields,
        },
      );
      await ctx.runMutation(internal.pendingEmails.setThreadMessage, {
        id,
        threadMessageId,
      });
    }
    if (context.chatMessageId)
      await ctx.runMutation(internal.threads.attachPendingEmailToAgentMessage, {
        id: context.chatMessageId,
        pendingEmailId: id,
      });
    if (replacement) resetDraftState(id);
    return getDraft(id);
  }

  async function failedAttachment(
    draft: Draft,
    key: string,
    message: string,
  ): Promise<EmailToolResult> {
    failuresFor(draft).set(key, message);
    const updated = await persist(draftContent(draft), draft);
    return resultForDraft(updated, updated.sendBlockedReason, message);
  }

  async function attached(
    draft: Draft,
    key: string,
    content: DraftContent,
    message: string,
  ): Promise<EmailToolResult> {
    failuresFor(draft).delete(key);
    const updated = await persist(content, draft);
    return resultForDraft(updated, updated.sendBlockedReason, message);
  }

  function attachmentExecutors(
    attachments: EmailAttachmentMeta[],
    policyIds: Set<Id<"policies">>,
  ) {
    return buildAgentToolExecutors(ctx, {
      surface: context.channel,
      orgId: context.orgId,
      userId: context.userId!,
      scope: {
        ...scope,
        primaryOrgId: context.orgId,
        focusedOrgId: context.orgId,
        readOrgIds: [context.orgId],
        writableOrgIds: [context.orgId],
        orgs: scope.orgs.filter((org) => org.orgId === context.orgId),
      },
      onPolicyReferenced: (policyId) => {
        policyIds.add(policyId);
      },
      onResponseAttachment: (attachment) => {
        if (attachment.fileId)
          attachments.push({
            filename: attachment.filename,
            contentType: attachment.contentType,
            size: attachment.size,
            fileId: attachment.fileId,
          });
      },
    });
  }

  async function prepareOriginalPolicies(
    policyIds: string[],
    content: DraftContent,
  ): Promise<string | undefined> {
    if (policyIds.length && !context.userId)
      return "Cannot attach a policy document without an authenticated user context.";
    const references = new Set(content.referencedPolicyIds ?? []);
    for (const policyId of new Set(policyIds)) {
      const attachments: EmailAttachmentMeta[] = [];
      const execute = attachmentExecutors(attachments, references)
        .attach_policy_document.execute;
      let response: Awaited<ReturnType<typeof execute>>;
      try {
        response = await execute({ policyId });
      } catch (error) {
        return `Could not prepare the original policy attachment: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (!attachments.length)
        return typeof response === "string"
          ? response
          : "That policy does not have an original file available.";
      content.attachments.push(
        ...attachments.map((attachment) => ({
          ...attachment,
          kind: "original_policy" as const,
        })),
      );
    }
    content.referencedPolicyIds = [...references];
  }

  return {
    draft_email: {
      description:
        "Create a saved email draft. This never sends. Supply recipient direction and only explicitly requested original policy PDFs.",
      inputSchema: draftSchema,
      execute: serialized(
        async (
          input: z.infer<typeof draftSchema>,
        ): Promise<EmailToolResult> => {
          assertScope(true);
          const content = normalizeContent(input);
          const error = await prepareOriginalPolicies(
            mcpOriginalPolicyIds,
            content,
          );
          if (error) return emit({ status: "error", responseBody: error });
          const existing =
            activeThreadId && content.to
              ? await ctx.runQuery(
                  internal.pendingEmails.findDraftByThreadAndRecipient,
                  { threadId: activeThreadId, recipientEmail: content.to },
                )
              : null;
          if (existing && existing.orgId !== context.orgId)
            throw new Error("Draft not found");
          const draft = await persist(content, existing ?? undefined, true);
          return resultForDraft(draft, draft.sendBlockedReason);
        },
      ),
    },
    update_email_draft: {
      description:
        "Replace one saved draft. Omitted CC/BCC and attachments are cleared; attachmentFileIds retains selected existing files. Every edit invalidates the prior exact approval.",
      inputSchema: updateSchema,
      execute: serialized(
        async (
          input: z.infer<typeof updateSchema>,
        ): Promise<EmailToolResult> => {
          const existing = await getDraft(input.draftId);
          assertEditable(existing);
          const content = normalizeContent(input, existing);
          const retain = new Set(input.attachmentFileIds ?? []);
          if (
            [...retain].some(
              (id) =>
                !existing.attachments?.some(
                  (attachment) => String(attachment.fileId) === id,
                ),
            )
          )
            throw new Error("That attachment is not available on this draft.");
          content.attachments = (existing.attachments ?? []).filter(
            (attachment) => retain.has(String(attachment.fileId)),
          );
          const error = await prepareOriginalPolicies(
            mcpOriginalPolicyIds,
            content,
          );
          if (error)
            return emit({
              status: "error",
              responseBody: error,
              pendingEmailId: existing._id,
            });
          const draft = await persist(content, existing, true);
          return resultForDraft(draft, draft.sendBlockedReason);
        },
      ),
    },
    attach_policy_pdf_to_draft: {
      description:
        "Attach an explicitly requested original/full policy PDF to a saved draft. Policy access, extraction readiness, and original-file availability are checked.",
      inputSchema: policySchema,
      execute: serialized(
        async (
          input: z.infer<typeof policySchema>,
        ): Promise<EmailToolResult> => {
          const draft = await getDraft(input.draftId);
          assertEditable(draft);
          const requested = resolveRequestedCoiAttachmentsForRecipient({
            to: draft.recipientEmail,
            attachments: [{ kind: "original_policy", ...input }],
          });
          const key = `${draft._id}:${normalizeAttachmentText(input.policyId)}`;
          if (!requested.attachments.length)
            return failedAttachment(
              draft,
              key,
              "The original policy was not attached because the request did not explicitly identify that artifact and policy.",
            );
          if (attachedPolicyKeys.has(key))
            return resultForDraft(
              draft,
              undefined,
              "Original policy is already attached.",
            );
          const content = draftContent(draft);
          const error = await prepareOriginalPolicies(
            [input.policyId],
            content,
          );
          if (error) return failedAttachment(draft, key, error);
          const result = await attached(
            draft,
            key,
            content,
            "Attached original policy document.",
          );
          attachedPolicyKeys.add(key);
          return result;
        },
      ),
    },
    attach_file_to_draft: {
      description:
        "Attach an exact file already available in this conversation, including generated COIs and saved email exports.",
      inputSchema: fileSchema,
      execute: serialized(
        async (input: z.infer<typeof fileSchema>): Promise<EmailToolResult> => {
          const draft = await getDraft(input.draftId);
          assertEditable(draft);
          if (
            draft.attachments?.some(
              (attachment) => String(attachment.fileId) === input.fileId,
            )
          )
            return resultForDraft(
              draft,
              undefined,
              "Uploaded file is already attached.",
            );
          const saved = draft.threadId
            ? await ctx.runQuery(
                internal.threads.listThreadAttachmentsInternal,
                {
                  threadId: draft.threadId,
                  orgId: context.orgId,
                  excludeEmailArtifacts: true,
                },
              )
            : [];
          const found = [
            ...(context.availableAttachments ?? []),
            ...saved,
          ].find((attachment) => String(attachment.fileId) === input.fileId);
          const key = `file:${input.fileId}`;
          if (!found)
            return failedAttachment(
              draft,
              key,
              "That uploaded file is not available in this conversation.",
            );
          const isCoi = countCoiAttachments([found]) > 0;
          if (countCoiAttachments(draft.attachments) > 0 && !isCoi)
            return failedAttachment(
              draft,
              key,
              "Skipped uploaded file because COI delivery requests should attach only the generated COI.",
            );
          const content = draftContent(draft);
          content.attachments.push({
            ...found,
            filename: input.filename ?? found.filename,
            kind: found.kind ?? (isCoi ? "coi" : "uploaded_file"),
          });
          return attached(
            draft,
            key,
            content,
            `Attached uploaded file: ${input.filename ?? found.filename}`,
          );
        },
      ),
    },
    attach_coi_to_draft: {
      description:
        "Generate and attach a COI using the shared certificate and endorsement gates. Choose policy mode or requirements-source mode, never both.",
      inputSchema: coiSchema,
      execute: serialized(
        async (input: z.infer<typeof coiSchema>): Promise<EmailToolResult> => {
          const draft = await getDraft(input.draftId);
          assertEditable(draft);
          const { draftId, ...request } = input;
          const holder = normalizeAttachmentText(input.certificateHolder);
          const key = `${draftId}:${normalizeAttachmentText(input.policyId ?? input.requirementSourceDocumentId ?? input.requirementId)}:${holder}`;
          if (attachedCoiKeys.has(key))
            return resultForDraft(
              draft,
              undefined,
              "Generated COI is already attached.",
            );
          if (!context.userId)
            return failedAttachment(
              draft,
              key,
              "Cannot generate a COI without an authenticated user context.",
            );
          if (
            draft.attachments?.some(
              (attachment) =>
                attachment.kind !== "original_policy" &&
                countCoiAttachments([attachment]) === 0,
            )
          ) {
            return failedAttachment(
              draft,
              key,
              "Replace the draft to remove unrelated uploaded files before preparing COI delivery.",
            );
          }
          const content = draftContent(draft);
          const references = new Set<Id<"policies">>();
          const attachments: EmailAttachmentMeta[] = [];
          const execute = attachmentExecutors(attachments, references)
            .generate_coi.execute;
          let response: Awaited<ReturnType<typeof execute>>;
          try {
            response = await execute(request);
          } catch (error) {
            return failedAttachment(
              draft,
              key,
              `Could not prepare the requested COI attachment: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          if (
            !attachments.length &&
            response &&
            typeof response === "object" &&
            "attachment" in response
          ) {
            const attachment = response.attachment as
              | EmailAttachmentMeta
              | undefined;
            if (attachment?.fileId) attachments.push(attachment);
          }
          if (!attachments.length) {
            const message =
              typeof response === "string"
                ? response
                : response &&
                    typeof response === "object" &&
                    "message" in response
                  ? String(response.message)
                  : "COI request completed.";
            return failedAttachment(draft, key, message);
          }
          content.attachments.push(
            ...attachments.map((attachment) => ({
              ...attachment,
              kind: "coi" as const,
            })),
          );
          content.referencedPolicyIds = [
            ...new Set([...(content.referencedPolicyIds ?? []), ...references]),
          ];
          const result = await attached(
            draft,
            key,
            content,
            `Attached ${attachments.length} COI${attachments.length === 1 ? "" : "s"}.`,
          );
          attachedCoiKeys.add(key);
          for (const policyId of references)
            attachedCoiKeys.add(`${draftId}:${String(policyId)}:${holder}`);
          return result;
        },
      ),
    },
    list_email_drafts: {
      description:
        "List saved drafts in the current conversation, or in an authorized tenant MCP thread.",
      inputSchema: z.object({ threadId: z.string().optional() }),
      execute: serialized(
        async (input: {
          threadId?: string;
        }): Promise<{
          drafts: Array<SerializedEmailDraft & { sendBlockedReason?: string }>;
        }> => {
          assertScope(false);
          const threadId =
            (input.threadId as Id<"threads"> | undefined) ?? activeThreadId;
          if (threadId) await assertThread(threadId);
          const drafts = await ctx.runQuery(
            internal.pendingEmails.listDraftsInternal,
            { orgId: context.orgId, threadId },
          );
          return {
            drafts: drafts.map((draft) => ({
              ...serializeEmailDraft(draft),
              sendBlockedReason: draft.sendBlockedReason,
            })),
          };
        },
      ),
    },
    send_email_draft: {
      description:
        "Send a saved draft only when the current user message has stored send authorization or a server-validated exact confirmation. Otherwise return the unchanged draft and confirmation prompt.",
      inputSchema: draftIdSchema,
      execute: serialized(
        async ({ draftId }: { draftId: string }): Promise<EmailToolResult> => {
          const draft = await getDraft(draftId);
          if (draft.status === "sent" || draft.status === "pending")
            return emit({
              status: draft.status,
              responseBody:
                draft.status === "sent"
                  ? `Email sent to ${draft.recipientEmail}.`
                  : `Sending email to ${draft.recipientEmail}...`,
              pendingEmailId: draft._id,
              responseMessageId: draft.sentMessageId,
              responseTo: draft.recipientEmail,
              attachments: draft.attachments,
            });
          assertEditable(draft);
          const { authorization: source } = await sourceAuthorization();
          const authorization = context.sendAuthorization ?? source;
          const reasons = await blockers(draftContent(draft));
          const failedAttachment = attachmentBlocker(draft);
          if (failedAttachment) reasons.unshift(failedAttachment);
          const trustedExact = context.sendAuthorization !== undefined;
          const unconditionallyBlocked =
            Boolean(failedAttachment) ||
            (context.requireKnownRecipient &&
              reasons.some((reason) =>
                reason.startsWith("I cannot use that recipient"),
              )) ||
            !extractEmailAddress(draft.recipientEmail) ||
            !draft.subject.trim() ||
            !draft.emailBody.trim() ||
            [...(draft.ccAddresses ?? []), ...(draft.bccAddresses ?? [])].some(
              (address) => !extractEmailAddress(address),
            );
          if (
            !authorization ||
            unconditionallyBlocked ||
            (!trustedExact && reasons.length > 0)
          )
            return resultForDraft(
              draft,
              reasons.length ? reasons.join(" ") : undefined,
            );
          const delay = context.emailSendDelay ?? 5;
          if (!trustedExact && source && delay > 0 && draft.threadId) {
            const { actorUserId, sourceMessageId } = source;
            await ctx.runMutation(
              internal.pendingEmails.scheduleDraftInternal,
              {
                id: draft._id,
                scheduledSendTime: dayjs().add(delay, "second").valueOf(),
                explicitSendAuthorization: { actorUserId, sourceMessageId },
              },
            );
            await ctx.scheduler.runAfter(
              delay * 1000,
              internal.actions.sendPendingEmail.sendPending,
              { id: draft._id },
            );
            return emit({
              status: "pending",
              responseBody: `Sending email to ${draft.recipientEmail}...`,
              pendingEmailId: draft._id,
              responseTo: draft.recipientEmail,
              subject: draft.subject,
              emailBody: draft.emailBody,
              attachments: draft.attachments,
            });
          }
          await ctx.runAction(
            internal.actions.sendPendingEmail.sendDraftInternal,
            { id: draft._id, authorization },
          );
          const sent = await getDraft(draftId);
          if (sent.status !== "sent")
            return emit({
              status: "error",
              responseBody:
                "The draft was not sent. Check its current delivery status before retrying.",
              pendingEmailId: draft._id,
            });
          return emit({
            status: "sent",
            responseBody: `Email sent to ${sent.recipientEmail}${sent.ccAddresses?.length ? ` (CC: ${sent.ccAddresses.join(", ")})` : ""}.`,
            pendingEmailId: sent._id,
            responseMessageId: sent.sentMessageId,
            responseTo: sent.recipientEmail,
            responseCc: sent.ccAddresses,
            responseBcc: sent.bccAddresses,
            subject: sent.subject,
            emailBody: sent.emailBody,
            attachments: sent.attachments,
          });
        },
      ),
    },
    cancel_email_draft: {
      description:
        "Cancel a saved unsent email draft in the current authorized conversation.",
      inputSchema: draftIdSchema,
      execute: serialized(
        async ({ draftId }: { draftId: string }): Promise<EmailToolResult> => {
          const draft = await getDraft(draftId);
          assertEditable(draft);
          await ctx.runMutation(internal.pendingEmails.cancelInternal, {
            id: draft._id,
          });
          return emit({
            status: "cancelled",
            responseBody: "Email draft cancelled.",
            pendingEmailId: draft._id,
          });
        },
      ),
    },
  };
}

export function buildEmailTools(ctx: ActionCtx, context: EmailToolContext) {
  const executors = buildEmailToolExecutors(ctx, context);
  return {
    draft_email: tool(executors.draft_email),
    update_email_draft: tool(executors.update_email_draft),
    attach_policy_pdf_to_draft: tool(executors.attach_policy_pdf_to_draft),
    attach_file_to_draft: tool(executors.attach_file_to_draft),
    attach_coi_to_draft: tool(executors.attach_coi_to_draft),
    list_email_drafts: tool(executors.list_email_drafts),
    send_email_draft: tool(executors.send_email_draft),
    cancel_email_draft: tool(executors.cancel_email_draft),
  };
}
