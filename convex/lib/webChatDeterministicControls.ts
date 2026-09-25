"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  emailCancelConfirmationPayload,
  parseTaskControlCommand,
  resolveChannelEmailControl,
  resolvePendingActionConfirmation,
  taskControlResponse,
} from "./channelControls";
import {
  executeEmailCommand,
  type EmailCommandDraft,
} from "./emailCommandExecutor";
import {
  emailSendDecisionAuthorizesSend,
  ensureEmailSendAuthorizationDecision,
  type EmailSendAuthorizationSource,
} from "./emailSendAuthorization";
import {
  confirmedRequirementImportMessage,
  importConfirmedRequirementSources,
} from "./requirementAttachmentIntent";

export type WebChatControlMessage = {
  _id: Id<"threadMessages">;
  role: string;
  content: string;
  status?: string;
  pendingEmailId?: Id<"pendingEmails">;
};

type WebChatEmailControlRecord = Doc<"pendingEmails">;

export type WebChatDeterministicControlState = {
  messageText: string;
  threadMessages: WebChatControlMessage[];
  pendingEmails: WebChatEmailControlRecord[];
  draftEmails: EmailCommandDraft[];
  latestCancelledEmail?: WebChatEmailControlRecord | null;
  sourceMessage?: EmailSendAuthorizationSource;
};

export async function loadWebChatDeterministicControlState(
  ctx: ActionCtx,
  args: {
    threadId: Id<"threads">;
    orgId: Id<"organizations">;
    userMessageId: Id<"threadMessages">;
  },
): Promise<WebChatDeterministicControlState> {
  const pendingEmails = await ctx.runQuery(
    internal.pendingEmails.findPendingByThread,
    { threadId: args.threadId },
  );
  const draftEmails = await ctx.runQuery(
    internal.pendingEmails.listDraftsInternal,
    { threadId: args.threadId, orgId: args.orgId },
  );
  const latestCancelledEmail = await ctx.runQuery(
    internal.pendingEmails.findLatestCancelledByThread,
    { threadId: args.threadId, orgId: args.orgId },
  );
  const userMessage = await ctx.runQuery(internal.threads.getMessageInternal, {
    id: args.userMessageId,
  });
  const threadMessages = await ctx.runQuery(
    internal.agentHistory.getRecentControlMessages,
    { threadId: args.threadId },
  );
  const messageText = userMessage?.content.trim() ?? "";

  return {
    messageText,
    threadMessages,
    pendingEmails,
    draftEmails,
    latestCancelledEmail,
    sourceMessage:
      userMessage?.role === "user"
        ? {
            _id: userMessage._id,
            orgId: userMessage.orgId,
            threadId: userMessage.threadId,
            content: messageText,
            emailSendAuthorization: userMessage.emailSendAuthorization,
          }
        : undefined,
  };
}

export async function runWebChatEmailControls(
  ctx: ActionCtx,
  args: WebChatDeterministicControlState & {
    agentMessageId: Id<"threadMessages">;
    userMessageId: Id<"threadMessages">;
    userId: Id<"users">;
    threadId: Id<"threads">;
    orgId: Id<"organizations">;
  },
): Promise<boolean> {
  const { confirmation, resolution } = await resolvePendingActionConfirmation(
    ctx,
    {
      messageText: args.messageText,
      orgId: args.orgId,
      threadId: args.threadId,
      userId: args.userId,
      currentMessageId: args.userMessageId,
      draftEmailIds: args.draftEmails.map((draft) => draft._id),
    },
  );
  switch (resolution.kind) {
    case "stale":
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: args.agentMessageId,
        content:
          resolution.outcome === "expired"
            ? "That confirmation expired. Refresh the draft and confirm again."
            : "That draft changed or is no longer the latest confirmation. Refresh it and confirm again.",
      });
      return true;
    case "coi_batch_delivery":
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: args.agentMessageId,
        content:
          "The exact COI attachment set is authorized. Use the Send action on the draft to deliver it.",
        pendingEmailId: resolution.pendingEmailId,
      });
      return true;
    case "requirement_import": {
      const imported = await importConfirmedRequirementSources(ctx, {
        orgId: args.orgId,
        userId: args.userId,
        payload: resolution.payload,
      });
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: args.agentMessageId,
        content: confirmedRequirementImportMessage(imported),
        toolArtifacts: [
          { type: "workflow_outcome", data: imported.workflowOutcome },
        ],
      });
      return true;
    }
    case "email_send": {
      const result = await executeEmailCommand(ctx, resolution.command, {
        draftEmails: args.draftEmails,
        sendConfirmationId: resolution.sendConfirmationId,
      });
      if (result.kind === "send_failed") {
        await ctx.runMutation(internal.threads.updateAgentError, {
          id: args.agentMessageId,
          error: result.error ?? result.responseBody,
          content: "Failed to send the confirmed draft email.",
        });
      } else {
        await ctx.runMutation(internal.threads.deleteMessageInternal, {
          id: args.agentMessageId,
        });
      }
      return true;
    }
    case "email_cancel": {
      const result = await executeEmailCommand(ctx, resolution.command, {
        draftEmails: args.draftEmails,
      });
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: args.agentMessageId,
        content: result.responseBody,
      });
      return true;
    }
    case "none":
      break;
  }

  const ensureSendDecision = async () =>
    args.sourceMessage
      ? ensureEmailSendAuthorizationDecision(ctx, {
          message: args.sourceMessage,
          pendingDrafts: [...args.draftEmails, ...args.pendingEmails],
        })
      : null;
  const emailControl = await resolveChannelEmailControl(ctx, {
    orgId: args.orgId,
    messageText: args.messageText,
    isCancelConfirmationContext: confirmation?.payload.kind === "email_cancel",
    latestCancelledEmailId: args.latestCancelledEmail?._id,
    draftEmailIds: args.draftEmails.map((draftEmail) => draftEmail._id),
    pendingEmailIds: args.pendingEmails.map((pendingEmail) => pendingEmail._id),
    allowDraftApproval: false,
    authorizeSend: async () =>
      emailSendDecisionAuthorizesSend(await ensureSendDecision()),
  });

  if (!emailControl) {
    // The agent turn may send email; decide authorization at ingest.
    if (!parseTaskControlCommand(args.messageText)) await ensureSendDecision();
    return false;
  }

  const result = await executeEmailCommand(ctx, emailControl, {
    draftEmails: args.draftEmails,
  });
  if (
    result.kind === "cancel_draft_emails" ||
    result.kind === "send_draft_emails"
  ) {
    await ctx.runMutation(internal.threads.deleteMessageInternal, {
      id: args.agentMessageId,
    });
    return true;
  }
  if (result.kind === "send_failed") {
    await ctx.runMutation(internal.threads.updateAgentError, {
      id: args.agentMessageId,
      error: result.error ?? result.responseBody,
      content:
        args.draftEmails.length === 1
          ? "Failed to send the draft email."
          : "Failed to send one or more draft emails.",
    });
    return true;
  }
  await ctx.runMutation(internal.threads.updateAgentMessage, {
    id: args.agentMessageId,
    content:
      result.kind === "restore_cancelled_email" && result.pendingEmailId
        ? "Email restored as a draft. Review it in the email draft card."
        : result.kind === "update_single_draft_recipient" &&
            result.pendingEmailId
          ? "Updated the draft recipient. Review it in the email draft card."
          : result.kind === "cancel_pending_emails"
            ? `Done - ${result.responseBody}`
            : result.responseBody,
    pendingEmailId: result.pendingEmailId,
  });
  if (
    result.kind === "request_draft_cancel_confirmation" ||
    result.kind === "request_pending_cancel_confirmation"
  ) {
    const targets =
      result.kind === "request_draft_cancel_confirmation"
        ? args.draftEmails
        : args.pendingEmails;
    if (targets.length > 0) {
      await ctx.runMutation(internal.threadActionConfirmations.createInternal, {
        orgId: args.orgId,
        threadId: args.threadId,
        actor: { kind: "user", userId: args.userId },
        promptMessageId: args.agentMessageId,
        payload: await emailCancelConfirmationPayload(targets),
      });
    }
  }
  return true;
}

export async function runWebChatTaskControl(
  ctx: ActionCtx,
  args: {
    threadId: Id<"threads">;
    agentMessageId: Id<"threadMessages">;
    userMessageId: Id<"threadMessages">;
    messageText: string;
  },
): Promise<boolean> {
  const taskControlIntent = parseTaskControlCommand(args.messageText);
  if (!taskControlIntent) return false;

  await ctx.runMutation(internal.agentHistory.resetTask, {
    threadId: args.threadId,
    currentMessageId: args.userMessageId,
  });

  await ctx.runMutation(internal.threads.updateAgentMessage, {
    id: args.agentMessageId,
    content: taskControlResponse(taskControlIntent),
  });
  return true;
}
