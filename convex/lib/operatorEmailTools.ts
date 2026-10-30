"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  buildEmailToolExecutors,
  serializeEmailDraft,
  type EmailToolResult,
  type OperatorEmailToolContext,
} from "./emailTools";

/**
 * Operator-agent email tools run the shared draft executors as the operator
 * making the call: drafts are signed with their name, sent from their own team
 * address, and optionally linked to a client, request or team thread. Only the
 * operator thread can reach its drafts, and a send runs only under the signing
 * operator's completed exact approval.
 */
export const OPERATOR_EMAIL_TOOL_NAMES = new Set([
  "save_email_draft",
  // Retired send tools: each now saves the draft that send_email_draft sends.
  "reply_email_thread",
  "reply_procurement_email_thread",
  "send_procurement_client_email",
  "draft_email",
  "update_email_draft",
  "attach_policy_pdf_to_draft",
  "attach_client_file_to_draft",
  "list_email_drafts",
  "send_email_draft",
  "cancel_email_draft",
]);

/**
 * The retired reply and client email send tools, as the draft they now save:
 * every agent email starts as a draft the operator can review and edit.
 */
function retiredSendAsDraft(toolName: string, input: Record<string, unknown>) {
  if (toolName === "reply_email_thread" || toolName === "reply_procurement_email_thread")
    return {
      teamEmailThreadId: input.teamEmailThreadId ?? input.procurementEmailThreadId,
      procurementRequestId: input.procurementRequestId,
      body: input.message,
    };
  if (toolName === "send_procurement_client_email") {
    const cadence = input.cadence as
      | { followUpCount: number; intervalBusinessDays: number }
      | undefined;
    return {
      procurementRequestId: input.procurementRequestId,
      to: input.recipientEmail,
      subject: input.subject,
      body: input.message,
      informationFormId: input.informationFormId,
      clientRequest: true,
      followUps: cadence?.followUpCount
        ? { followUpCount: cadence.followUpCount, intervalBusinessDays: cadence.intervalBusinessDays }
        : null,
    };
  }
  return null;
}

/** `save_email_draft` follow-ups as stored: a schedule, Spot's pick, or none. */
function draftFollowUps(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value === "auto") return {};
  const cadence = value as { followUpCount: number; intervalBusinessDays: number };
  return {
    cadence: {
      followUpCount: cadence.followUpCount,
      intervalBusinessDays: cadence.intervalBusinessDays,
    },
  };
}

function operatorEmailResult(result: EmailToolResult) {
  const showsDraft =
    result.status === "draft" || result.status === "needs_confirmation";
  return Object.fromEntries(
    Object.entries({
      status: result.status,
      draftId: result.pendingEmailId,
      from: result.responseFrom,
      teamThreadId: result.teamEmailThreadId,
      to: result.responseTo,
      cc: result.responseCc,
      bcc: result.responseBcc,
      subject: result.subject,
      body: result.emailBody,
      attachments: result.attachments?.map(({ filename }) => filename),
      blockedReason:
        result.status === "needs_confirmation"
          ? result.confirmationReason
          : undefined,
      message: showsDraft ? undefined : result.responseBody,
    }).filter(([, value]) => value !== undefined),
  );
}

/** Compact list row: enough to pick a draft; `view: "full"` returns the whole draft. */
function compactDraftRow(draft: Doc<"pendingEmails">) {
  return Object.fromEntries(
    Object.entries({
      id: draft._id,
      subject: draft.subject,
      to: draft.recipientEmail,
      status: draft.status,
      updatedAt: draft._creationTime,
      attachmentCount: draft.attachments?.length ?? 0,
      sendBlockedReason: draft.sendBlockedReason,
      orgId: draft.orgId,
      procurementRequestId: draft.procurementRequestId,
      teamEmailThreadId: draft.teamEmailThreadId,
    }).filter(([, value]) => value !== undefined),
  );
}

export async function runOperatorEmailTool(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    /** Signs the draft as this operator; by default a draft keeps its sender. */
    senderUserId?: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    toolName: string;
    input: Record<string, unknown>;
    messageId?: Id<"operatorAgentMessages">;
    confirmationId?: Id<"operatorAgentConfirmations">;
  },
) {
  let { input } = args;
  let toolName = args.toolName;
  const retired = retiredSendAsDraft(toolName, input);
  if (retired) {
    toolName = "save_email_draft";
    input = Object.fromEntries(
      Object.entries(retired).filter(([, value]) => value !== undefined),
    );
  }
  // Who to sign as and the send options are resolved here, not by the draft executors.
  const {
    fromUserId,
    followUps: followUpsInput,
    informationFormId,
    clientRequest,
    ...draftInput
  } = input;
  input = draftInput;
  // A new reply goes to the thread's reply-all recipients unless `to` names others.
  if (
    toolName === "save_email_draft" &&
    !input.draftId &&
    !input.to &&
    typeof input.teamEmailThreadId === "string"
  )
    input = { ...input, recipientDirection: "explicit" };
  const senderUserId =
    args.senderUserId ?? (typeof fromUserId === "string" ? fromUserId : undefined);
  if (toolName === "list_email_drafts") {
    const text = (value: unknown) =>
      typeof value === "string" && value ? value : undefined;
    const before = text(input.cursor) === undefined ? undefined : Number(input.cursor);
    if (before !== undefined && !Number.isFinite(before)) {
      throw new Error("Draft cursor is invalid. Restart without a cursor.");
    }
    const status = text(input.status);
    const page = await ctx.runQuery(
      internal.operatorEmailDrafts.listForThreadInternal,
      {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        status:
          status === "draft" ||
          status === "pending" ||
          status === "sent" ||
          status === "cancelled"
            ? status
            : undefined,
        orgId: text(input.clientOrgId),
        procurementRequestId: text(input.procurementRequestId),
        teamEmailThreadId: text(input.teamEmailThreadId),
        createdByMe: input.createdByMe === true ? true : undefined,
        before,
        limit: typeof input.limit === "number" ? input.limit : undefined,
      },
    );
    const nextCursor = page.nextCursor === null ? null : String(page.nextCursor);
    return {
      drafts:
        input.view === "full"
          ? page.drafts.map((draft) => ({
              ...serializeEmailDraft(draft),
              sendBlockedReason: draft.sendBlockedReason,
            }))
          : page.drafts.map(compactDraftRow),
      nextCursor,
      bounded: nextCursor !== null,
    };
  }

  if (toolName === "send_email_draft" && !args.confirmationId) {
    throw new Error("Exact operator confirmation is required");
  }
  // A client information request sends by launching its client email sequence.
  if (toolName === "send_email_draft") {
    const draft = await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: String(input.draftId) as Id<"pendingEmails">,
    });
    if (draft?.clientOutreach && draft.operatorThreadId === args.threadId) {
      const launched = await ctx.runMutation(
        internal.operatorEmailDrafts.launchClientRequestDraftInternal,
        { pendingEmailId: draft._id, confirmationId: args.confirmationId },
      );
      return {
        status: "sent",
        draftId: draft._id,
        to: launched.recipientEmail,
        subject: draft.subject,
        message:
          "Client information request sent; its follow-ups stop when the client replies or submits the form.",
      };
    }
  }
  // Attachment IDs are trimmed and verified against the draft's client first.
  if (
    toolName === "attach_client_file_to_draft" ||
    toolName === "attach_policy_pdf_to_draft"
  ) {
    const field =
      toolName === "attach_client_file_to_draft"
        ? "clientFileId"
        : "policyId";
    const checked = await ctx.runQuery(
      internal.operatorEmailDrafts.checkAttachmentInputInternal,
      {
        operatorUserId: args.operatorUserId,
        threadId: args.threadId,
        toolName,
        draftId: String(input.draftId ?? ""),
        reference: String(input[field] ?? ""),
      },
    );
    input = { ...input, draftId: String(input.draftId).trim(), [field]: checked.reference };
  }
  if (toolName === "save_email_draft" && typeof input.draftId === "string") {
    const draftId = input.draftId;
    for (const [field, toolName] of [
      ["clientFileIds", "attach_client_file_to_draft"],
      ["policyIds", "attach_policy_pdf_to_draft"],
    ] as const) {
      if (!Array.isArray(input[field])) continue;
      const checkedIds: string[] = [];
      for (const reference of input[field]) {
        const checked = await ctx.runQuery(internal.operatorEmailDrafts.checkAttachmentInputInternal, {
          operatorUserId: args.operatorUserId, threadId: args.threadId,
          toolName, draftId, reference: String(reference),
        });
        checkedIds.push(checked.reference);
      }
      input = { ...input, [field]: checkedIds };
    }
  }
  // `clientOrgId` is an alias of `orgId`; naming two different clients is an error.
  if (
    typeof input.orgId === "string" &&
    typeof input.clientOrgId === "string" &&
    input.orgId !== input.clientOrgId
  ) {
    throw new Error("orgId and clientOrgId name different clients; use one.");
  }
  const clientOrgId =
    typeof input.orgId === "string"
      ? input.orgId
      : typeof input.clientOrgId === "string"
        ? input.clientOrgId
        : undefined;
  const sender = await ctx.runQuery(
    internal.operatorEmailDrafts.resolveSenderInternal,
    {
      operatorUserId: args.operatorUserId,
      senderUserId,
      threadId: args.threadId,
      orgId: clientOrgId,
      draftId: typeof input.draftId === "string" ? input.draftId : undefined,
      procurementRequestId:
        typeof input.procurementRequestId === "string"
          ? input.procurementRequestId
          : undefined,
      teamEmailThreadId:
        typeof input.teamEmailThreadId === "string"
          ? input.teamEmailThreadId
          : undefined,
      write: true,
    },
  );
  const context: OperatorEmailToolContext = {
    orgId: sender.orgId,
    userId: args.operatorUserId,
    channel: "web",
    fromHeader: sender.fromHeader,
    operator: {
      threadId: args.threadId,
      messageId: args.messageId,
      senderUserId: sender.senderUserId,
      senderName: sender.name,
      teamAddress: sender.teamAddress,
      prompts: sender.prompts,
      alwaysCc: sender.alwaysCc ?? undefined,
      procurementRequestId: sender.procurementRequestId,
      teamThread: sender.teamThread,
    },
    sendAuthorization: args.confirmationId
      ? {
          kind: "operator_confirmed_action",
          confirmationId: args.confirmationId,
        }
      : undefined,
  };
  const executors = buildEmailToolExecutors(ctx, context);
  const {
    orgId: _orgId,
    clientOrgId: _clientOrgId,
    procurementRequestId: _requestId,
    teamEmailThreadId: _teamThreadId,
    ...fields
  } = input;
  const result = await (async (): Promise<EmailToolResult> => {
    switch (toolName) {
      case "save_email_draft":
        return executors.save_email_draft.execute(fields as never);
      case "draft_email":
        return executors.draft_email.execute({
          ...fields,
          recipientDirection: "explicit",
        });
      case "update_email_draft":
        return executors.update_email_draft.execute(fields as never);
      case "attach_policy_pdf_to_draft":
        return executors.attach_policy_pdf_to_draft.execute(fields as never);
      case "attach_client_file_to_draft":
        return executors.attach_client_file_to_draft.execute(fields as never);
      case "send_email_draft":
        return executors.send_email_draft.execute({
          draftId: String(input.draftId),
        });
      case "cancel_email_draft":
        return executors.cancel_email_draft.execute({
          draftId: String(input.draftId),
        });
      default:
        throw new Error(`Unsupported operator email tool: ${toolName}`);
    }
  })();
  const savedDraftId =
    result.status === "draft" && result.pendingEmailId ? result.pendingEmailId : undefined;
  if (
    savedDraftId &&
    (toolName === "save_email_draft" ||
      toolName === "update_email_draft" ||
      toolName === "draft_email")
  ) {
    const options = await ctx.runMutation(
      internal.operatorEmailDrafts.applyDraftOptionsInternal,
      {
        threadId: args.threadId,
        draftId: savedDraftId as Id<"pendingEmails">,
        followUps: draftFollowUps(followUpsInput),
        informationFormId:
          typeof informationFormId === "string" ? informationFormId : undefined,
        clientRequest: clientRequest === true ? true : undefined,
      },
    );
    return {
      ...operatorEmailResult(result),
      ...options,
    };
  }
  if (
    toolName === "send_email_draft" &&
    result.status !== "sent" &&
    result.status !== "pending"
  ) {
    throw new Error(
      result.confirmationReason ??
        result.responseBody ??
        "The email was not sent",
    );
  }
  return operatorEmailResult(result);
}
