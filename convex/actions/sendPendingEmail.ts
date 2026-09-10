"use node";

import { v, type Infer } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { getAgentDomain } from "../lib/resend";
import {
  buildPendingEmailResendPayload,
  sendTrackedResendEmail,
  toResendAttachments,
} from "../lib/emailDelivery";
import { countCoiAttachments } from "../lib/coiAttachmentGuards";
import {
  buildPendingEmailConfirmation,
  pendingEmailDraftFingerprint,
} from "../lib/actionConfirmationFingerprint";
import { sendOutboundImessage } from "../lib/imessageOutbound";
import {
  formatEmailDraftBlockers,
  getEmailDraftSendability,
} from "../lib/emailWorkflow";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";
import { threadActionActorsMatch } from "../lib/threadActionConfirmationValidators";
import { isActorBoundExplicitEmailSendSource } from "../lib/emailSendIntent";

type SendEmailResult = { recipientEmail: string } | null;
type BulkDraftSendResult = {
  sent: Array<{ id: Id<"pendingEmails">; recipientEmail: string }>;
  failed: Array<{ id: Id<"pendingEmails">; error: string }>;
};

const draftSendAuthorizationValidator = v.union(
  v.object({
    kind: v.literal("confirmation"),
    confirmationId: v.id("threadActionConfirmations"),
  }),
  v.object({ kind: v.literal("scheduled") }),
  v.object({
    kind: v.literal("channel_explicit_action"),
    actorUserId: v.id("users"),
    sourceMessageId: v.id("threadMessages"),
  }),
  v.object({ kind: v.literal("mcp_explicit_action") }),
);

type DraftSendAuthorization =
  | Infer<typeof draftSendAuthorizationValidator>
  | { kind: "authenticated_user_action" };

type ChannelExplicitSendAuthorization = {
  actorUserId: Id<"users">;
  sourceMessageId: Id<"threadMessages">;
};

function isCurrentCompletedConfirmation(
  confirmation: Doc<"threadActionConfirmations"> | null,
): confirmation is Doc<"threadActionConfirmations"> {
  return (
    confirmation?.status === "completed"
  );
}

async function authorizeExplicitCoiBatches(
  ctx: ActionCtx,
  drafts: Array<Doc<"pendingEmails">>,
  actorUserId: Id<"users">,
) {
  for (const draft of drafts) {
    const confirmation = await buildPendingEmailConfirmation(draft);
    if (confirmation.payload.kind !== "coi_batch_delivery") continue;
    if (!draft.threadId) {
      throw new Error("COI batch confirmation requires a thread.");
    }
    const batchPromptMessageId = await ctx.runMutation(
      internal.threads.insertWorkflowStatusMessage,
      {
        orgId: draft.orgId,
        threadId: draft.threadId,
        sourceThreadMessageId: draft.chatMessageId,
        pendingEmailId: draft._id,
        dedupeKey: `explicit-coi-batch:${String(draft._id)}:${confirmation.fingerprint}`,
        content: `Explicitly confirmed ${draft.attachments?.length ?? 0} attachments for ${draft.recipientEmail}.`,
      },
    );
    const batchConfirmationId = await ctx.runMutation(
      internal.threadActionConfirmations.createInternal,
      {
        orgId: draft.orgId,
        threadId: draft.threadId,
        actor: { kind: "user", userId: actorUserId },
        promptMessageId: batchPromptMessageId,
        payload: confirmation.payload,
      },
    );
    const batchConfirmation = await ctx.runMutation(
      internal.threadActionConfirmations.consumeInternal,
      {
        id: batchConfirmationId,
        actor: { kind: "user", userId: actorUserId },
        requireAdjacentPrompt: false,
      },
    );
    if (batchConfirmation !== "completed") {
      throw new Error(`COI batch confirmation ${batchConfirmation}.`);
    }
  }
}

async function assertChannelExplicitSendAuthorization(
  ctx: ActionCtx,
  pending: Doc<"pendingEmails">,
  authorization: ChannelExplicitSendAuthorization,
  expectedStatus: "draft" | "pending",
) {
  if (!pending.threadId || pending.status !== expectedStatus) {
    throw new Error("Explicit send requires a current thread email.");
  }
  const [sourceMessage, actor] = await Promise.all([
    ctx.runQuery(internal.threads.getMessageInternal, {
      id: authorization.sourceMessageId,
    }),
    ctx.runQuery(internal.users.getInternal, {
      id: authorization.actorUserId,
    }),
  ]);
  if (
    !isActorBoundExplicitEmailSendSource({
      message: sourceMessage,
      orgId: pending.orgId,
      threadId: pending.threadId,
      actorUserId: authorization.actorUserId,
      actorEmail: actor?.email,
    })
  ) {
    throw new Error(
      "The current user message does not authorize sending this email.",
    );
  }
}

async function assertDraftSendAuthorization(
  ctx: ActionCtx,
  pending: Doc<"pendingEmails">,
  authorization: DraftSendAuthorization,
) {
  if (authorization.kind === "scheduled") {
    if (pending.status !== "pending" || !pending.scheduledSendTime) {
      throw new Error(
        "Scheduled email authorization is not valid for this draft.",
      );
    }
    if (pending.explicitSendAuthorization) {
      await assertChannelExplicitSendAuthorization(
        ctx,
        pending,
        pending.explicitSendAuthorization,
        "pending",
      );
    }
    return;
  }
  if (authorization.kind === "channel_explicit_action") {
    await assertChannelExplicitSendAuthorization(
      ctx,
      pending,
      authorization,
      "draft",
    );
    return;
  }
  if (
    authorization.kind === "mcp_explicit_action" ||
    authorization.kind === "authenticated_user_action"
  ) {
    if (pending.status !== "draft") {
      throw new Error("Explicit send requires a current draft.");
    }
    return;
  }

  const confirmation = await ctx.runQuery(
    internal.threadActionConfirmations.getInternal,
    { id: authorization.confirmationId },
  );
  if (
    !isCurrentCompletedConfirmation(confirmation) ||
    confirmation.orgId !== pending.orgId ||
    confirmation.threadId !== pending.threadId ||
    (confirmation.payload.kind !== "email_send" &&
      confirmation.payload.kind !== "draft_snapshot" &&
      confirmation.payload.kind !== "coi_batch_delivery")
  ) {
    throw new Error(
      "A completed confirmation for this exact draft is required.",
    );
  }
  if (confirmation.payload.kind === "coi_batch_delivery") {
    if (
      confirmation.payload.pendingEmailId !== pending._id ||
      confirmation.payload.draftFingerprint !==
        (await pendingEmailDraftFingerprint(pending))
    ) {
      throw new Error(
        "The confirmed COI batch changed and must be reviewed again.",
      );
    }
    return;
  }
  const index = confirmation.payload.pendingEmailIds.findIndex(
    (id) => id === pending._id,
  );
  if (
    index < 0 ||
    confirmation.payload.draftFingerprints[index] !==
      (await pendingEmailDraftFingerprint(pending))
  ) {
    throw new Error("The confirmed draft changed and must be reviewed again.");
  }
}

async function hasExactCoiBatchAuthorization(
  ctx: ActionCtx,
  pending: Doc<"pendingEmails">,
) {
  const authorization = pending.coiBatchAuthorization;
  if (!authorization) return false;
  const confirmation = await ctx.runQuery(
    internal.threadActionConfirmations.getInternal,
    { id: authorization.confirmationId },
  );
  if (
    !isCurrentCompletedConfirmation(confirmation) ||
    confirmation.payload.kind !== "coi_batch_delivery" ||
    confirmation.payload.pendingEmailId !== pending._id
  ) {
    return false;
  }
  const confirmationPayload = confirmation.payload;
  const recipientEmail = pending.recipientEmail.trim().toLowerCase();
  const fileIds = (pending.attachments ?? []).map(({ fileId }) =>
    String(fileId),
  );
  return (
    threadActionActorsMatch(authorization.confirmedBy, confirmation.actor) &&
    authorization.recipientEmail === recipientEmail &&
    confirmationPayload.recipientEmail === recipientEmail &&
    authorization.draftFingerprint ===
      (await pendingEmailDraftFingerprint(pending)) &&
    authorization.draftFingerprint === confirmationPayload.draftFingerprint &&
    fileIds.length === authorization.fileIds.length &&
    fileIds.length === confirmationPayload.fileIds.length &&
    fileIds.every(
      (fileId, index) =>
        fileId === String(authorization.fileIds[index]) &&
        fileId === String(confirmationPayload.fileIds[index]),
    )
  );
}

async function assertSafeDraftAttachments(
  ctx: ActionCtx,
  pending: Doc<"pendingEmails">,
) {
  const requiresExactBatchAuthorization =
    countCoiAttachments(pending.attachments) > 1 ||
    pending.allowMultipleCoiAttachments === true;
  if (!requiresExactBatchAuthorization) return;
  const hasExactBatchAuthorization = await hasExactCoiBatchAuthorization(
    ctx,
    pending,
  );
  if (!hasExactBatchAuthorization) {
    throw new Error(
      "This multi-COI draft needs confirmation for its exact recipient and attachment list before sending.",
    );
  }
}

function outboundMessageIdForPending(id: Id<"pendingEmails">) {
  return `<spot-pending-${String(id)}@${getAgentDomain()}>`;
}

async function sendPendingEmailById(
  ctx: ActionCtx,
  id: Id<"pendingEmails">,
  options: {
    allowedStatuses: Array<Doc<"pendingEmails">["status"]>;
    updateChatMessage: boolean;
    notifyImessage: boolean;
    authorization: DraftSendAuthorization;
  },
): Promise<SendEmailResult> {
  const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
    id,
  });
  if (!pending || !options.allowedStatuses.includes(pending.status)) {
    return null;
  }
  await assertDraftSendAuthorization(ctx, pending, options.authorization);
  const sendability = getEmailDraftSendability(pending, {
    allowedStatuses: options.allowedStatuses,
    confirmationGranted: true,
  });
  if (sendability.status === "blocked") {
    if (
      sendability.blockers.some((blocker) =>
        ["missing_recipient", "missing_subject", "missing_body"].includes(
          blocker.code,
        ),
      )
    ) {
      throw new Error("Draft is missing required email fields.");
    }
    throw new Error(
      `Draft needs confirmation before sending: ${formatEmailDraftBlockers(sendability.blockers)}`,
    );
  }
  await assertSafeDraftAttachments(ctx, pending);

  try {
    const thread = pending.threadId
      ? await ctx.runQuery(internal.threads.getInternal, {
          id: pending.threadId,
        })
      : null;
    const outboundMessageId = outboundMessageIdForPending(id);
    const payload = buildPendingEmailResendPayload(pending, {
      outboundMessageId,
      threadEmail: thread?.threadEmail,
    });
    if (pending.attachments && pending.attachments.length > 0) {
      payload.attachments = await toResendAttachments(ctx, pending.attachments);
    }
    const result = await sendTrackedResendEmail(ctx, {
      source: "pending_email",
      orgId: pending.orgId,
      pendingEmailId: id,
      threadId: pending.threadId,
      threadMessageId: pending.threadMessageId,
      recipientEmail: pending.recipientEmail,
      ccAddresses: pending.ccAddresses,
      bccAddresses: pending.bccAddresses,
      subject: pending.subject,
      messageId: outboundMessageId,
      payload,
    });
    if (!result.ok) throw new Error(`Failed to send email: ${result.error}`);
    const sentMessageId = result.id;

    await ctx.runMutation(internal.pendingEmails.markSent, {
      id,
      sentMessageId,
    });

    if (options.updateChatMessage && pending.chatMessageId) {
      const ccNote =
        pending.ccAddresses && pending.ccAddresses.length > 0
          ? ` (CC: ${pending.ccAddresses.join(", ")})`
          : "";
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: pending.chatMessageId,
        content: `Email sent to ${pending.recipientEmail}${ccNote}.`,
      });
    }

    if (pending.threadId) {
      if (pending.threadMessageId) {
        await ctx.runMutation(internal.threads.updateEmailMessage, {
          id: pending.threadMessageId,
          content: pending.emailBody,
          toAddresses: [pending.recipientEmail],
          ccAddresses: pending.ccAddresses,
          bccAddresses: pending.bccAddresses,
          subject: pending.subject,
          messageId: outboundMessageId,
          responseMessageId: sentMessageId,
          resendEmailId: sentMessageId,
          attachments: pending.attachments,
          clearStatus: true,
        });
      } else {
        await ctx.runMutation(internal.threads.insertEmailMessage, {
          threadId: pending.threadId,
          orgId: pending.orgId,
          role: "agent",
          content: pending.emailBody,
          toAddresses: [pending.recipientEmail],
          ccAddresses: pending.ccAddresses,
          bccAddresses: pending.bccAddresses,
          subject: pending.subject,
          messageId: outboundMessageId,
          responseMessageId: sentMessageId,
          resendEmailId: sentMessageId,
          attachments: pending.attachments,
          pendingEmailId: id,
        });
      }

      if (options.notifyImessage && thread?.threadPhone) {
        const ccNote =
          pending.ccAddresses && pending.ccAddresses.length > 0
            ? ` CC ${pending.ccAddresses.join(", ")}`
            : "";
        const confirmation = `Email sent to ${pending.recipientEmail}.${ccNote}`;
        const sent = await sendOutboundImessage({
          toPhone: thread.threadPhone,
          chatGuid: thread.imessageChatGuid,
          message: confirmation,
          logPrefix: "sendPendingEmail",
        });
        if (sent) {
          await ctx.runMutation(internal.threads.insertImessageMessage, {
            threadId: pending.threadId,
            orgId: pending.orgId,
            role: "agent",
            content: confirmation,
            responseMessageId: `${id}:sent-confirmation`,
            pendingEmailId: id,
          });
        }
      }
    }

    return { recipientEmail: pending.recipientEmail };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("Failed to send pending email:", errMsg);

    if (options.updateChatMessage && pending.chatMessageId) {
      await ctx.runMutation(internal.threads.updateAgentMessage, {
        id: pending.chatMessageId,
        content: `_Failed to send email: ${errMsg}_`,
      });
    }
    if (pending.threadMessageId) {
      await ctx.runMutation(internal.threads.updateEmailMessage, {
        id: pending.threadMessageId,
        error: errMsg,
      });
    }
    throw err;
  }
}

export const sendPending = internalAction({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args) => {
    await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["pending"],
      updateChatMessage: true,
      notifyImessage: true,
      authorization: { kind: "scheduled" },
    });
  },
});

export const sendDraftInternal = internalAction({
  args: {
    id: v.id("pendingEmails"),
    authorization: draftSendAuthorizationValidator,
  },
  handler: async (ctx, args) => {
    await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["draft"],
      updateChatMessage: false,
      notifyImessage: false,
      authorization: args.authorization,
    });
  },
});

export const sendDraftNow = action({
  args: { id: v.id("pendingEmails") },
  handler: async (ctx, args): Promise<{ recipientEmail: string }> => {
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {});
    if (!orgData?.membership?.orgId) {
      throwUserFacingError(userFacingErrorCodes.authRequired);
    }
    const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
      id: args.id,
    });
    if (!pending || pending.orgId !== orgData.membership.orgId) {
      throw new Error("Not found");
    }
    await authorizeExplicitCoiBatches(ctx, [pending], orgData.membership.userId);
    const sent = await sendPendingEmailById(ctx, args.id, {
      allowedStatuses: ["draft"],
      updateChatMessage: false,
      notifyImessage: false,
      authorization: { kind: "authenticated_user_action" },
    });
    if (!sent) throw new Error("Draft is no longer available to send.");
    return sent;
  },
});

export const sendDraftsNow = action({
  args: { ids: v.array(v.id("pendingEmails")) },
  handler: async (ctx, args): Promise<BulkDraftSendResult> => {
    const orgData = await ctx.runQuery(api.orgs.viewerOrg, {});
    if (!orgData?.membership?.orgId) {
      throwUserFacingError(userFacingErrorCodes.authRequired);
    }

    const uniqueIds = [...new Set(args.ids)];
    if (uniqueIds.length === 0) {
      throw new Error("No email drafts selected.");
    }

    const drafts: Array<Doc<"pendingEmails">> = [];
    for (const id of uniqueIds) {
      const pending = await ctx.runQuery(internal.pendingEmails.getInternal, {
        id,
      });
      if (!pending || pending.orgId !== orgData.membership.orgId) {
        throw new Error("Not found");
      }
      if (pending.status !== "draft") {
        throw new Error("Only draft emails can be sent together.");
      }
      drafts.push(pending);
    }

    await authorizeExplicitCoiBatches(
      ctx,
      drafts,
      orgData.membership.userId,
    );

    const result: BulkDraftSendResult = { sent: [], failed: [] };
    for (const draft of drafts) {
      try {
        const sent = await sendPendingEmailById(ctx, draft._id, {
          allowedStatuses: ["draft"],
          updateChatMessage: false,
          notifyImessage: false,
          authorization: { kind: "authenticated_user_action" },
        });
        if (!sent) throw new Error("Draft is no longer available to send.");
        result.sent.push({
          id: draft._id,
          recipientEmail: sent.recipientEmail,
        });
      } catch (err) {
        result.failed.push({
          id: draft._id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  },
});
