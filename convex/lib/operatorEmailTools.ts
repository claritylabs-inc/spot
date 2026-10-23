"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
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
  "draft_email",
  "update_email_draft",
  "attach_policy_pdf_to_draft",
  "attach_client_file_to_draft",
  "list_email_drafts",
  "send_email_draft",
  "cancel_email_draft",
]);

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

export async function runOperatorEmailTool(
  ctx: ActionCtx,
  args: {
    operatorUserId: Id<"users">;
    threadId: Id<"operatorAgentThreads">;
    toolName: string;
    input: Record<string, unknown>;
    messageId?: Id<"operatorAgentMessages">;
    confirmationId?: Id<"operatorAgentConfirmations">;
  },
) {
  const { input } = args;
  if (args.toolName === "list_email_drafts") {
    const drafts = await ctx.runQuery(
      internal.operatorEmailDrafts.listForThreadInternal,
      { operatorUserId: args.operatorUserId, threadId: args.threadId },
    );
    return {
      drafts: drafts.map((draft) => ({
        ...serializeEmailDraft(draft),
        sendBlockedReason: draft.sendBlockedReason,
      })),
    };
  }

  if (args.toolName === "send_email_draft" && !args.confirmationId) {
    throw new Error("Exact operator confirmation is required");
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
    switch (args.toolName) {
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
        throw new Error(`Unsupported operator email tool: ${args.toolName}`);
    }
  })();
  if (
    args.toolName === "send_email_draft" &&
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
