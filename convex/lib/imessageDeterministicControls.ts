"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { AgentScope } from "./agentScope";
import {
  emailCancelConfirmationPayload,
  resolveChannelEmailControl,
  resolvePendingActionConfirmation,
  runImessageSlashCommand,
} from "./channelControls";
import { executeEmailCommand } from "./emailCommandExecutor";
import {
  emailSendDecisionAuthorizesSend,
  ensureEmailSendAuthorizationDecision,
} from "./emailSendAuthorization";
import type { ImessageHistoryMessage } from "./imessageAgentContext";
import {
  confirmedRequirementImportMessage,
  importConfirmedRequirementSources,
} from "./requirementAttachmentIntent";

export type ImessageDeterministicControlResult = {
  response: string;
  leaveGroup?: boolean;
};

export async function runImessageDeterministicControls(
  ctx: ActionCtx,
  args: {
    messageText: string;
    orgId: Id<"organizations">;
    userId: Id<"users">;
    orgName: string;
    userName?: string;
    userEmail?: string;
    threadId: Id<"threads">;
    eventKey: string;
    chatGuid: string;
    isGroup: boolean;
    scopeMode: AgentScope["mode"];
    currentSenderIsLinked: boolean;
    draftEmails: Array<Doc<"pendingEmails">>;
    pendingEmails: Array<Doc<"pendingEmails">>;
    latestCancelledEmail?: Doc<"pendingEmails"> | null;
    history: ImessageHistoryMessage[];
    currentMessageId: Id<"threadMessages">;
  },
): Promise<ImessageDeterministicControlResult | null> {
  const reply = async (
    response: string,
    options?: {
      leaveGroup?: boolean;
      draftSnapshot?: {
        pendingEmailIds: Id<"pendingEmails">[];
        draftFingerprints: string[];
      };
      cancelTargets?: Array<Doc<"pendingEmails">>;
    },
  ): Promise<ImessageDeterministicControlResult> => {
    const promptMessageId = await ctx.runMutation(
      internal.threads.insertImessageMessage,
      {
        threadId: args.threadId,
        orgId: args.orgId,
        role: "agent",
        messageKind:
          options?.draftSnapshot || options?.cancelTargets
            ? "workflow_status"
            : "conversation",
        content: response,
        responseMessageId: `${args.eventKey}:response`,
      },
    );
    if (options?.draftSnapshot) {
      await ctx.runMutation(internal.threadActionConfirmations.createInternal, {
        orgId: args.orgId,
        threadId: args.threadId,
        actor: { kind: "user", userId: args.userId },
        promptMessageId,
        payload: {
          kind: "draft_snapshot",
          pendingEmailIds: options.draftSnapshot.pendingEmailIds,
          draftFingerprints: options.draftSnapshot.draftFingerprints,
        },
      });
    }
    if (options?.cancelTargets?.length) {
      await ctx.runMutation(internal.threadActionConfirmations.createInternal, {
        orgId: args.orgId,
        threadId: args.threadId,
        actor: { kind: "user", userId: args.userId },
        promptMessageId,
        payload: await emailCancelConfirmationPayload(options.cancelTargets),
      });
    }
    return { response, leaveGroup: options?.leaveGroup };
  };

  const slashCommandResult = await runImessageSlashCommand(ctx, {
    messageText: args.messageText,
    userId: args.userId,
    orgName: args.orgName,
    userName: args.userName,
    userEmail: args.userEmail,
    isGroup: args.isGroup,
    scopeMode: args.scopeMode,
    currentSenderIsLinked: args.currentSenderIsLinked,
    draftEmails: args.draftEmails,
    pendingEmails: args.pendingEmails,
    history: args.history,
    threadId: args.threadId,
    currentMessageId: args.currentMessageId,
  });
  if (slashCommandResult) {
    if (slashCommandResult.leaveGroup && args.isGroup) {
      await ctx.runMutation(internal.imessageChats.markLeft, {
        chatGuid: args.chatGuid,
      });
    }
    return reply(slashCommandResult.response, {
      leaveGroup: slashCommandResult.leaveGroup,
      draftSnapshot: slashCommandResult.draftSnapshot,
    });
  }

  if (!args.currentSenderIsLinked) return null;

  const { confirmation, resolution } = await resolvePendingActionConfirmation(
    ctx,
    {
      messageText: args.messageText,
      orgId: args.orgId,
      threadId: args.threadId,
      userId: args.userId,
      currentMessageId: args.currentMessageId,
      draftEmailIds: args.draftEmails.map((draft) => draft._id),
    },
  );
  switch (resolution.kind) {
    case "stale":
      return reply(
        resolution.outcome === "expired"
          ? "That confirmation expired. Use /drafts and confirm again."
          : "That draft changed or is no longer the latest confirmation. Use /drafts and confirm again.",
      );
    case "coi_batch_delivery":
      return reply(
        "The exact COI attachment set is authorized. Use /send 1 to deliver it.",
      );
    case "requirement_import": {
      const imported = await importConfirmedRequirementSources(ctx, {
        orgId: args.orgId,
        userId: args.userId,
        payload: resolution.payload,
      });
      return reply(confirmedRequirementImportMessage(imported));
    }
    case "email_send": {
      const result = await executeEmailCommand(ctx, resolution.command, {
        draftEmails: args.draftEmails,
        sendConfirmationId: resolution.sendConfirmationId,
      });
      return reply(result.responseBody);
    }
    case "email_cancel": {
      const result = await executeEmailCommand(ctx, resolution.command, {
        draftEmails: args.draftEmails,
      });
      return reply(result.responseBody);
    }
    case "none":
      break;
  }

  const sourceMessage = {
    _id: args.currentMessageId,
    orgId: args.orgId,
    threadId: args.threadId,
    content: args.messageText,
  };
  const ensureSendDecision = () =>
    ensureEmailSendAuthorizationDecision(ctx, {
      message: sourceMessage,
      pendingDrafts: [...args.draftEmails, ...args.pendingEmails],
    });
  const emailControl = await resolveChannelEmailControl(ctx, {
    orgId: args.orgId,
    messageText: args.messageText,
    isCancelConfirmationContext: confirmation?.payload.kind === "email_cancel",
    latestCancelledEmailId: args.latestCancelledEmail?._id,
    draftEmailIds: args.draftEmails.map((draftEmail) => draftEmail._id),
    pendingEmailIds: args.pendingEmails.map((pendingEmail) => pendingEmail._id),
    allowDraftList: false,
    authorizeSend: async () =>
      emailSendDecisionAuthorizesSend(await ensureSendDecision()),
  });

  if (!emailControl) {
    // The agent turn may send email; decide authorization at ingest.
    await ensureSendDecision();
    return null;
  }

  const result = await executeEmailCommand(ctx, emailControl, {
    draftEmails: args.draftEmails,
  });
  const cancelTargets =
    result.kind === "request_draft_cancel_confirmation"
      ? args.draftEmails
      : result.kind === "request_pending_cancel_confirmation"
        ? args.pendingEmails
        : undefined;
  return reply(result.responseBody, { cancelTargets });
}
