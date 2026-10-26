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
import {
  MAX_EMAIL_SIZE,
  buildEmailPayload,
  type EmailAttachmentMeta,
} from "./emailDelivery";
import { buildEmailSignature, getEmailAgentFromName } from "./emailIdentity";
import { isOperatorEmailDraft } from "./actionConfirmationFingerprint";
import { NoWriteInputError } from "./noWriteInputError";
import { buildOperatorSignature } from "./teamEmail";
import {
  withoutQuotedHistory,
  type TeamThreadDraftContext,
} from "./teamThreadReply";
import { EMAIL_FAMILY_GUIDANCE } from "./channelStyle";
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
export { EMAIL_FAMILY_GUIDANCE };
export {
  queueEmailDraftArtifact,
  upsertEmailDraftArtifact,
} from "./emailDraftArtifacts";

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
  responseFrom?: string;
  teamEmailThreadId?: Id<"teamEmailThreads">;
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

type EmailToolContextBase = {
  userId?: Id<"users">;
  threadId?: Id<"threads">;
  sourceUserMessageId?: Id<"threadMessages">;
  chatMessageId?: Id<"threadMessages">;
  routingParentId?: string;
  channel: "web" | "email" | "imessage" | "slack" | "mcp";
  fromHeader: string;
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
    | {
        kind: "operator_confirmed_action";
        confirmationId: Id<"operatorAgentConfirmations">;
      }
    | { kind: "mcp_explicit_action" };
  onResult?: (result: EmailToolResult) => void;
};

/** Client agent email: always one exact organization, sent as that client's agent address. */
export type EmailToolContext = EmailToolContextBase & {
  orgId: Id<"organizations">;
  agentAddress: string;
  operator?: undefined;
};

/**
 * Operator-agent drafts are not client threads. They are signed by the
 * operator, sent from that operator's team inbox, optionally linked to a
 * client, request or team thread, and can only be read or changed from the
 * operator thread that owns them.
 */
export type OperatorEmailSender = {
  threadId: Id<"operatorAgentThreads">;
  messageId?: Id<"operatorAgentMessages">;
  senderUserId: Id<"users">;
  senderName: string;
  teamAddress: string;
  /** The operator's permanent Always CC, stored on every draft. */
  alwaysCc?: string;
  procurementRequestId?: Id<"procurementRequests">;
  teamThread?: TeamThreadDraftContext;
};

export type OperatorEmailToolContext = EmailToolContextBase & {
  /** Absent for unlinked ad hoc email. */
  orgId?: Id<"organizations">;
  agentAddress?: undefined;
  operator: OperatorEmailSender;
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
const saveSchema = updateSchema.extend({
  draftId: z.string().optional(),
  clientFileIds: z.array(z.string()).max(10).optional(),
  policyIds: z.array(z.string()).max(10).optional(),
  explicitArtifactRequest: z.literal("original_policy_document").optional(),
  intentEvidence: z.string().optional(),
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
const clientFileSchema = z.object({
  draftId: z.string(),
  clientFileId: z.string(),
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
    from: draft.fromHeader,
    orgId: draft.orgId,
    procurementRequestId: draft.procurementRequestId,
    teamEmailThreadId: draft.teamEmailThreadId,
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
  context: EmailToolContext | OperatorEmailToolContext,
) {
  const operator = context.operator;
  const orgId = context.orgId;
  let activeThreadId = context.threadId;

  /** The exact client; operator drafts without one cannot use client files or policies. */
  function requireOrg(): Id<"organizations"> {
    if (!orgId) throw new NoWriteInputError("client_required", "Link a client first");
    return orgId;
  }
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
  const scope: AgentScope | undefined =
    context.scope ??
    (orgId
      ? {
          mode: "client",
          surface: context.channel,
          primaryOrgId: orgId,
          readOrgIds: [orgId],
          writableOrgIds: [orgId],
          orgs: [],
          brokerInternal: false,
        }
      : undefined);

  /** Client-file and policy tools run against one exact client's scope. */
  function requireClientScope(): { orgId: Id<"organizations">; scope: AgentScope } {
    const exactOrgId = requireOrg();
    if (!scope) throw new NoWriteInputError("client_required", "Link a client first");
    return { orgId: exactOrgId, scope };
  }

  function assertScope(write: boolean) {
    // Operator drafts without a client have no tenant scope to check.
    if (!orgId || !scope) return;
    const orgs = write ? scope.writableOrgIds : scope.readOrgIds;
    if (!orgs.includes(orgId))
      throw new Error("Email access is not available for this organization.");
  }

  async function assertThread(threadId: Id<"threads">) {
    if (activeThreadId && threadId !== activeThreadId)
      throw new Error("Thread not found");
    const thread = await ctx.runQuery(internal.threads.getInternal, {
      id: threadId,
    });
    if (!thread || thread.orgId !== orgId)
      throw new Error("Thread not found");
  }

  async function getDraft(draftId: string, writable = true): Promise<Draft> {
    assertScope(writable);
    const draft = await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: draftId as Id<"pendingEmails">,
    });
    if (
      !draft ||
      // An operator revision may add a client to a draft that has none.
      (draft.orgId !== orgId && !(operator && draft.orgId === undefined)) ||
      (activeThreadId && draft.threadId !== activeThreadId) ||
      draft.operatorThreadId !== operator?.threadId ||
      // Operator drafts never belong to a client context, whichever org they name.
      (!operator && isOperatorEmailDraft(draft))
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
      responseFrom: draft.fromHeader,
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
      orgId &&
      context.userId &&
      activeThreadId &&
      context.sourceUserMessageId &&
      isActorBoundExplicitEmailSendSource({
        message,
        orgId,
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

  /**
   * A reply that is not threaded in the sender's inbox is a new "Re:" and
   * carries the thread's latest message. Any earlier quote is replaced, so
   * re-signing another operator's draft (even without a new body) gets the
   * history that fits this sender.
   */
  function withQuotedHistory(body: string): string {
    const thread = operator?.teamThread;
    if (!thread) return body;
    const bare = withoutQuotedHistory(body);
    return thread.crossReply && thread.quote ? `${bare}\n\n${thread.quote}` : bare;
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
            ? operator?.teamThread?.defaultTo
            : (existing?.recipientEmail ?? context.defaultTo)));
    const to = extractEmailAddress(recipient) ?? "";
    const blocked = new Set(
      (context.blockedCopyEmails ?? []).map(normalizeEmailAddress),
    );
    if (operator) {
      // The signer is never copied on their own email.
      blocked.add(operator.teamAddress.toLowerCase());
      // A standing Always CC belongs to whoever signed it: once the setting
      // differs (another signer, or it was changed), the old copy is replaced.
      const stale = existing?.operatorAlwaysCcEmail?.toLowerCase();
      if (
        stale &&
        stale !== operator.alwaysCc?.toLowerCase() &&
        stale !== operator.teamThread?.ownerAddress?.toLowerCase()
      ) {
        blocked.add(stale);
      }
    }
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
    // Always CC and the thread owner (on a cross-operator reply) are stored on
    // the draft, so the approval shows them and send never adds recipients.
    const requiredCopies = operator
      ? [operator.alwaysCc, operator.teamThread?.ownerAddress].filter(
          (address): address is string => Boolean(address),
        )
      : [];
    const cc = normalizeCopies([
      ...(input.cc ?? []),
      ...(context.defaultCc ?? []),
      ...requiredCopies,
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
        (operator?.teamThread
          ? `Re: ${operator.teamThread.subject.replace(/^re:\s*/i, "")}`
          : "")
      ).trim(),
      body: withQuotedHistory(
        cleanAgentMarkdownForTransport(input.body ?? existing?.emailBody ?? ""),
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
    if (!operator && !activeThreadId && !existing?.threadId) {
      if (!context.userId)
        throw new Error(
          "An authenticated user is required to create an email thread.",
        );
      activeThreadId = await ctx.runMutation(internal.threads.createInternal, {
        orgId: requireOrg(),
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
      signature: operator
        ? buildOperatorSignature({ name: operator.senderName })
        : buildEmailSignature(context.agentAddress),
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
        orgId,
        threadId,
        operatorThreadId: operator?.threadId,
        ...(operator
          ? {
              senderUserId: operator.senderUserId,
              operatorAlwaysCcEmail: operator.alwaysCc?.toLowerCase(),
              transport: "operator_inbox" as const,
              procurementRequestId: operator.procurementRequestId,
              teamEmailThreadId: operator.teamThread?.id,
            }
          : {}),
        status: "draft",
        scheduledSendTime: 0,
      }));
    if (existing)
      await ctx.runMutation(internal.pendingEmails.updateDraftInternal, {
        id,
        ...fields,
        // A revision is re-signed as the operator making it.
        ...(operator
          ? {
              senderUserId: operator.senderUserId,
              operatorAlwaysCcEmail: operator.alwaysCc?.toLowerCase(),
              transport: "operator_inbox" as const,
              orgId,
              procurementRequestId: operator.procurementRequestId,
              teamEmailThreadId: operator.teamThread?.id,
            }
          : {}),
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
    } else if (threadId && context.agentAddress) {
      const threadMessageId = await ctx.runMutation(
        internal.threads.insertEmailMessage,
        {
          threadId,
          orgId: requireOrg(),
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
    if (operator?.messageId)
      await ctx.runMutation(
        internal.operatorEmailDrafts.attachDraftToOperatorMessageInternal,
        { messageId: operator.messageId, pendingEmailId: id },
      );
    else if (context.chatMessageId)
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

  function isAttached(draft: Draft, fileId: string) {
    return Boolean(
      draft.attachments?.some(
        (attachment) => String(attachment.fileId) === fileId,
      ),
    );
  }

  // Shared by every "attach an existing file" tool: COI-only, size, and
  // duplicate rules live here once.
  async function attachFile(
    draft: Draft,
    key: string,
    found: EmailAttachmentMeta,
    filename?: string,
  ): Promise<EmailToolResult> {
    const isCoi = countCoiAttachments([found]) > 0;
    if (countCoiAttachments(draft.attachments) > 0 && !isCoi)
      return failedAttachment(
        draft,
        key,
        "Skipped uploaded file because COI delivery requests should attach only the generated COI.",
      );
    const encodedSize = [...(draft.attachments ?? []), found].reduce(
      (total, attachment) => total + Math.ceil(attachment.size / 3) * 4,
      0,
    );
    if (encodedSize > MAX_EMAIL_SIZE)
      return failedAttachment(
        draft,
        key,
        "Attachments would be too large to send in one email.",
      );
    const content = draftContent(draft);
    const name = filename ?? found.filename;
    content.attachments.push({
      ...found,
      filename: name,
      kind: found.kind ?? (isCoi ? "coi" : "uploaded_file"),
    });
    return attached(draft, key, content, `Attached uploaded file: ${name}`);
  }

  function attachmentExecutors(
    attachments: EmailAttachmentMeta[],
    policyIds: Set<Id<"policies">>,
  ) {
    const client = requireClientScope();
    return buildAgentToolExecutors(ctx, {
      surface: context.channel,
      orgId: client.orgId,
      userId: context.userId!,
      scope: {
        ...client.scope,
        primaryOrgId: client.orgId,
        focusedOrgId: client.orgId,
        readOrgIds: [client.orgId],
        writableOrgIds: [client.orgId],
        orgs: client.scope.orgs.filter((org) => org.orgId === client.orgId),
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
    save_email_draft: {
      description: "Create or patch a draft, preserving omitted fields and preparing every attachment before saving.",
      inputSchema: saveSchema,
      execute: serialized(async (input: z.infer<typeof saveSchema>): Promise<EmailToolResult> => {
        // Only the operator projection exposes this contract; tenant updates keep replacement semantics.
        if (!operator) throw new Error("Operator draft context is required");
        assertScope(true);
        let existing = input.draftId ? await getDraft(input.draftId) : undefined;
        if (existing) assertEditable(existing);
        const content = normalizeContent({
          ...input,
          cc: input.cc ?? existing?.ccAddresses,
          bcc: input.bcc ?? existing?.bccAddresses,
        }, existing);
        content.referencedPolicyIds = existing?.referencedPolicyIds ?? content.referencedPolicyIds;
        const retain = input.attachmentFileIds === undefined
          ? undefined : new Set(input.attachmentFileIds);
        if (retain && [...retain].some((id) => !existing?.attachments?.some((attachment) => String(attachment.fileId) === id)))
          throw new Error("That attachment is not available on this draft.");
        content.attachments = (existing?.attachments ?? []).filter((attachment) => !retain || retain.has(String(attachment.fileId)));
        for (const clientFileId of new Set(input.clientFileIds ?? [])) {
          const file = await ctx.runQuery(internal.clientFiles.getForEmailAttachmentInternal, { orgId: requireOrg(), clientFileId });
          if (!file) throw new Error("Client file not found, archived, or belongs to another client.");
          if (!content.attachments.some((attachment) => attachment.fileId === file.fileId))
            content.attachments.push({ ...file, kind: countCoiAttachments([file]) > 0 ? "coi" : "uploaded_file" });
        }
        const policyIds = [...new Set(input.policyIds ?? [])];
        for (const policyId of policyIds) {
          const requested = resolveRequestedCoiAttachmentsForRecipient({
            to: content.to,
            attachments: [{ kind: "original_policy", policyId, explicitArtifactRequest: input.explicitArtifactRequest, intentEvidence: input.intentEvidence }],
          });
          if (!requested.attachments.length)
            throw new Error("Original policy PDFs require an explicit operator request identifying the artifact and policy.");
        }
        const error = await prepareOriginalPolicies(policyIds, content);
        if (error) throw new Error(error);
        content.attachments = uniqueAttachments(content.attachments);
        if (content.attachments.reduce((total, attachment) => total + Math.ceil(attachment.size / 3) * 4, 0) > MAX_EMAIL_SIZE)
          throw new Error("Attachments would be too large to send in one email.");
        if (countCoiAttachments(content.attachments) > 0 && content.attachments.some((attachment) => countCoiAttachments([attachment]) === 0))
          throw new Error("COI delivery requests should attach only generated COIs.");
        if (!existing && content.to) {
          const previous = await ctx.runQuery(internal.pendingEmails.findDraftByOperatorThreadAndRecipient, {
            orgId, teamEmailThreadId: operator.teamThread?.id,
            operatorThreadId: operator.threadId, recipientEmail: content.to,
          });
          if (previous && previous.orgId !== orgId) throw new Error("Draft not found");
          if (previous && (!previous.senderUserId || previous.senderUserId === operator.senderUserId))
            existing = previous;
        }
        const draft = await persist(content, existing, true);
        return resultForDraft(draft, draft.sendBlockedReason);
      }),
    },
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
          const operatorThreadId = context.operator?.threadId;
          const existing = !content.to
            ? null
            : operatorThreadId
              ? await ctx.runQuery(
                  internal.pendingEmails.findDraftByOperatorThreadAndRecipient,
                  {
                    orgId,
                    teamEmailThreadId: operator?.teamThread?.id,
                    operatorThreadId,
                    recipientEmail: content.to,
                  },
                )
              : activeThreadId
                ? await ctx.runQuery(
                    internal.pendingEmails.findDraftByThreadAndRecipient,
                    { threadId: activeThreadId, recipientEmail: content.to },
                  )
                : null;
          if (existing && existing.orgId !== orgId)
            throw new Error("Draft not found");
          // Another operator's draft is theirs to send: write a new one beside it.
          const reusable =
            existing &&
            (!operator ||
              !existing.senderUserId ||
              existing.senderUserId === operator.senderUserId)
              ? existing
              : undefined;
          const draft = await persist(content, reusable, true);
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
          requireOrg();
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
          requireOrg();
          const draft = await getDraft(input.draftId);
          assertEditable(draft);
          if (isAttached(draft, input.fileId))
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
                  orgId: requireOrg(),
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
          return attachFile(draft, key, found, input.filename);
        },
      ),
    },
    attach_client_file_to_draft: {
      description:
        "Attach an existing file from this client organization's stored files to a saved draft, including a certificate saved there by generate_coi.",
      inputSchema: clientFileSchema,
      execute: serialized(
        async (
          input: z.infer<typeof clientFileSchema>,
        ): Promise<EmailToolResult> => {
          const exactOrgId = requireOrg();
          const draft = await getDraft(input.draftId);
          assertEditable(draft);
          const key = `client_file:${input.clientFileId}`;
          const file = await ctx.runQuery(
            internal.clientFiles.getForEmailAttachmentInternal,
            { orgId: exactOrgId, clientFileId: input.clientFileId },
          );
          if (!file)
            return failedAttachment(
              draft,
              key,
              "That client file was not found for this organization.",
            );
          if (isAttached(draft, String(file.fileId)))
            return resultForDraft(
              draft,
              undefined,
              "Client file is already attached.",
            );
          return attachFile(draft, key, file, input.filename);
        },
      ),
    },
    attach_coi_to_draft: {
      description:
        "Generate and attach a COI using the shared certificate and endorsement gates. Choose policy mode or requirements-source mode, never both.",
      inputSchema: coiSchema,
      execute: serialized(
        async (input: z.infer<typeof coiSchema>): Promise<EmailToolResult> => {
          requireOrg();
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
            { orgId: requireOrg(), threadId },
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
          // A claimed operator send is resumed, never reported as done: the
          // transport finishes its record or refuses a duplicate.
          if (
            draft.status === "sent" ||
            (draft.status === "pending" && !operator)
          )
            return emit({
              status: draft.status,
              responseBody:
                draft.status === "sent"
                  ? `Email sent to ${draft.recipientEmail}.`
                  : `Sending email to ${draft.recipientEmail}...`,
              pendingEmailId: draft._id,
              responseMessageId: draft.sentMessageId,
              responseFrom: draft.fromHeader,
              teamEmailThreadId: draft.teamEmailThreadId,
              responseTo: draft.recipientEmail,
              attachments: draft.attachments,
            });
          if (!(operator && draft.status === "pending")) assertEditable(draft);
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
            responseFrom: sent.fromHeader,
            teamEmailThreadId: sent.teamEmailThreadId,
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
