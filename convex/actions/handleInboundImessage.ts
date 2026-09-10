"use node";

import { createHash } from "node:crypto";
import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { stepCountIs } from "ai";
import {
  createImessageGroupChat,
  coordinateMailboxTask,
  webResearch,
} from "../lib/chatTools";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import {
  buildSystemPromptForContext,
  buildChannelInstructions,
  buildPolicyToolInstructions,
} from "../lib/aiUtils";
import { classifyPromptInjection, enforceInputLimits } from "../lib/security";
import type { Doc, Id } from "../_generated/dataModel";
import { isImessageInboundEnabled } from "../lib/imessageConfig";
import { sendOutboundImessage } from "../lib/imessageOutbound";
import { getClientPortalUrl } from "../lib/domains";
import {
  anonymousParticipantLabel,
  buildImessageGroupMemberTitle,
  buildImessageRosterContext,
  normalizeImessageAddress,
  resolveImessageConversationScope,
  type ResolvedImessageParticipant,
} from "../lib/imessageGroupResolution";
import {
  buildEmailExpertTool,
  resolveEmailAgentIdentity,
} from "../lib/emailSubagent";
import { FATAL_ACTION_FAILED_MESSAGE } from "../lib/actionFailures";
import { buildPendingEmailConfirmation } from "../lib/actionConfirmationFingerprint";
import { buildEmailDraftTextSummary } from "../lib/emailDraftSummary";
import { runWebRetrieval, type WebRetrievalInput } from "../lib/webRetrieval";
import {
  buildImessageModelMessages,
  buildRecentImessageTextContext,
  imessageAgentTaskForAttachments,
  isImessageStatusCue,
  prepareInboundImessageTurn,
  type ImessageHistoryMessage,
} from "../lib/imessageAgentContext";
import {
  formatPolicyFocusHints,
  selectPolicyFocusIds,
  validatePolicyFocusIds,
} from "../lib/agentPolicyFocus";
import {
  mintImessageAppCards,
  mintImessageEmailDraftReviewCard,
  type ImessageAppCard,
} from "../lib/imessageAppCards";
import { runImessageDeterministicControls } from "../lib/imessageDeterministicControls";
import {
  buildThreadContinuityPrompt,
  buildThreadHistoryToolInstructions,
} from "../lib/agentMessageHistory";
import { cleanAgentMarkdownForTransport } from "../lib/transportRenderers";
import {
  loadBoundedAgentHistory,
  scheduleThreadHistoryCompaction,
} from "../lib/agentHistoryLoader";
import { createImessageAgentRunState } from "../lib/imessageAgentRunState";
import {
  AGENT_MAX_OUTPUT_TOKENS,
  runAgentTurn,
} from "../lib/channelAgentRunner";
import {
  buildFallbackImessageChatGuid,
  buildImessageParticipantInputs,
  buildInboundImessageEventKey,
  normalizeInboundImessageSender,
  storeImessageAttachments,
} from "../lib/imessageIngress";
import {
  buildRequirementImportConfirmation,
  decideRequirementAttachmentImport,
  requiredRequirementImportStep,
} from "../lib/requirementAttachmentIntent";
import { sendClRouterFeedback } from "../lib/clRouterClient";

export { buildFallbackImessageChatGuid } from "../lib/imessageIngress";

type ImessageResponse = {
  response: string;
  attachments?: Array<{ url: string; filename: string; mimeType: string }>;
  appCards?: ImessageAppCard[];
  leaveGroup?: boolean;
  chatGuid?: string;
  threadMessageId?: string;
  sendContactCard?: boolean;
};

async function sendImmediateImessage(params: {
  toPhone: string;
  chatGuid?: string;
  message: string;
}): Promise<boolean> {
  return await sendOutboundImessage({
    toPhone: params.toPhone,
    chatGuid: params.chatGuid,
    message: params.message,
    logPrefix: "imessage",
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendAttachmentFailureNotice(responseText: string): string {
  const notice =
    'Heads up: the PDF did not attach. Say "resend" and I\'ll attach it again.';
  const trimmed = responseText.trim();
  if (!trimmed) return notice;
  if (trimmed.includes(notice)) return trimmed;
  return `${trimmed}\n\n${notice}`;
}

const internalApi = internal as any;
const IMESSAGE_RATING_PROMPT = "Was this helpful? Reply 👍 or 👎.";

function imessageRating(messageText: string): "positive" | "negative" | null {
  const normalized = messageText.trim();
  if (normalized === "👍") return "positive";
  if (normalized === "👎") return "negative";
  return null;
}

function shouldPromptForImessageRating(eventKey: string): boolean {
  return createHash("sha256").update(eventKey).digest()[0]! < 26;
}

export const processInbound = internalAction({
  args: {
    fromPhone: v.string(),
    messageText: v.string(),
    chatGuid: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
    chatTitle: v.optional(v.string()),
    participantsUnavailable: v.optional(v.boolean()),
    participants: v.optional(
      v.array(
        v.object({
          address: v.string(),
          displayName: v.optional(v.string()),
        }),
      ),
    ),
    sourceMessageId: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    recoveryFailure: v.optional(
      v.object({
        stage: v.union(
          v.literal("raw_message"),
          v.literal("attachment_download"),
        ),
        error: v.string(),
      }),
    ),
    attachments: v.optional(
      v.array(
        v.object({
          data: v.string(), // base64-encoded bytes
          mimeType: v.string(),
          name: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<ImessageResponse> => {
    if (!isImessageInboundEnabled()) {
      console.warn(
        "[imessage] Inbound message received while iMessage inbound is not enabled",
      );
      return { response: "" };
    }

    const fromPhone = normalizeInboundImessageSender(args.fromPhone);
    const senderAddress = normalizeImessageAddress(args.fromPhone);
    const isGroup = args.isGroup === true;
    const chatGuid =
      args.chatGuid?.trim() ||
      buildFallbackImessageChatGuid({
        fromPhone,
        isGroup,
        participants: args.participants,
      });
    const siteUrl = getClientPortalUrl();
    let shouldSendContactCard = false;
    const eventKey = buildInboundImessageEventKey({
      fromPhone,
      chatGuid,
      messageText: args.messageText,
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
      attachments: args.attachments,
    });

    const claim = await ctx.runMutation(internal.imessageInboundEvents.claim, {
      eventKey,
      fromPhone,
      chatGuid,
      isGroup,
      messageText: args.messageText,
      sourceMessageId: args.sourceMessageId,
      receivedAt: args.receivedAt,
      recoveryFailure: args.recoveryFailure,
    });
    if (claim.duplicate) {
      console.log("[imessage] Duplicate inbound event ignored", {
        fromPhone,
        sourceMessageId: args.sourceMessageId,
        status: claim.status,
      });
      return { response: "" };
    }

    const finish = async (
      response: string,
      attachments?: ImessageResponse["attachments"],
      options?: {
        leaveGroup?: boolean;
        appCards?: ImessageAppCard[];
        threadMessageId?: Id<"threadMessages">;
        sendContactCard?: boolean;
      },
    ) => {
      await ctx.runMutation(internal.imessageInboundEvents.complete, {
        eventKey,
        response,
      });
      return {
        response,
        attachments,
        appCards: options?.appCards,
        leaveGroup: options?.leaveGroup,
        chatGuid,
        threadMessageId: options?.threadMessageId
          ? String(options.threadMessageId)
          : undefined,
        sendContactCard:
          (options?.sendContactCard ?? shouldSendContactCard) || undefined,
      };
    };
    let privacyLeaseId: Id<"imessageAgentRunLeases"> | undefined;

    try {
      if (isGroup && args.participantsUnavailable) {
        return await finish(
          "I couldn't confirm who is in this group chat yet. Please try again in a moment.",
        );
      }

      const participantInputs = buildImessageParticipantInputs({
        senderAddress,
        participants: args.participants,
      });

      const phones = [...participantInputs.keys()].filter(
        (address) => !address.includes("@"),
      );
      const linkedUsers = await ctx.runQuery(internal.users.findManyByPhones, {
        phones,
      });
      const linkedUserRecords = linkedUsers.filter(
        (linkedUser) => linkedUser !== null,
      );
      const usersByPhone = new Map(
        linkedUserRecords.flatMap((linkedUser) =>
          linkedUser.phone
            ? [
                [
                  normalizeImessageAddress(linkedUser.phone),
                  linkedUser,
                ] as const,
              ]
            : [],
        ),
      );
      const memberships = await ctx.runQuery(internal.orgs.getUserMemberships, {
        userIds: linkedUserRecords.map((linkedUser) => linkedUser._id),
      });
      const membershipByUserId = new Map(
        memberships
          .filter((membership) => membership !== null)
          .map((membership) => [String(membership.userId), membership]),
      );

      const resolvedParticipants: ResolvedImessageParticipant[] = [
        ...participantInputs.values(),
      ].map((participant) => {
        const linkedUser = usersByPhone.get(participant.address);
        const membership = linkedUser
          ? membershipByUserId.get(String(linkedUser._id))
          : undefined;
        const role: "linked" | "anonymous" =
          linkedUser && membership ? "linked" : "anonymous";
        return {
          address: participant.address,
          displayName: participant.displayName,
          userId: linkedUser?._id,
          userName: linkedUser?.name,
          userEmail: linkedUser?.email,
          orgId: membership?.orgId,
          role,
        };
      });

      const scope = resolveImessageConversationScope({
        senderAddress,
        participants: resolvedParticipants,
      });
      const groupMemberTitle = isGroup
        ? buildImessageGroupMemberTitle(resolvedParticipants)
        : undefined;

      const chatSync = await ctx.runMutation(internal.imessageChats.syncChat, {
        chatGuid,
        isGroup,
        primaryOrgId: scope.primaryOrgId,
        title: groupMemberTitle ?? args.chatTitle,
        participants: resolvedParticipants.map((participant) => ({
          address: participant.address,
          displayName: participant.displayName,
          userId: participant.userId,
          orgId: participant.orgId,
          role: participant.role,
        })),
      });
      shouldSendContactCard = chatSync.shouldSendContactCard;

      const voiceMemoInput = await prepareInboundImessageTurn(ctx, {
        scope:
          scope.kind === "no_linked_users"
            ? { kind: "public" }
            : { kind: "organization", orgId: scope.primaryOrgId },
        messageText: args.messageText,
        attachments: args.attachments,
      });
      const inboundMessageText = enforceInputLimits(voiceMemoInput.messageText);

      if (scope.kind === "no_linked_users") {
        if (voiceMemoInput.failureResponse) {
          if (isGroup) {
            await ctx.runMutation(internal.imessageChats.markLeft, {
              chatGuid,
            });
          }
          return await finish(voiceMemoInput.failureResponse, undefined, {
            leaveGroup: isGroup,
            sendContactCard: chatSync.shouldSendContactCard,
          });
        }
        const demo = await ctx.runAction(
          internal.actions.publicDemoAgent.respond,
          {
            channel: "imessage",
            senderContact: fromPhone,
            messageText: inboundMessageText,
            sourceMessageId: args.sourceMessageId,
            chatGuid,
          },
        );
        if (isGroup) {
          await ctx.runMutation(internal.imessageChats.markLeft, { chatGuid });
        }
        return await finish(demo.text, undefined, {
          leaveGroup: isGroup,
          sendContactCard: chatSync.shouldSendContactCard,
        });
      }

      const orgId = scope.primaryOrgId;
      const user = linkedUsers.find(
        (candidate) => candidate?._id === scope.primaryUserId,
      );
      if (!user) {
        const demo = await ctx.runAction(
          internal.actions.publicDemoAgent.respond,
          {
            channel: "imessage",
            senderContact: fromPhone,
            messageText: inboundMessageText,
            sourceMessageId: args.sourceMessageId,
            chatGuid,
          },
        );
        return await finish(demo.text, undefined, {
          sendContactCard: chatSync.shouldSendContactCard,
        });
      }
      const currentParticipant = resolvedParticipants.find(
        (participant) =>
          normalizeImessageAddress(participant.address) === senderAddress,
      );
      const currentSenderIsLinked = Boolean(
        currentParticipant?.userId && currentParticipant.orgId,
      );

      const injectionCheck = await classifyPromptInjection(
        ctx,
        inboundMessageText,
        orgId,
      );
      if (!injectionCheck.safe) {
        console.warn("[security] iMessage prompt injection blocked", {
          audit: injectionCheck.audit,
        });
        return await finish("I can't process that request.");
      }

      const privacyRun = !isGroup
        ? await ctx.runMutation(internal.imessagePrivacy.claimAgentRun, {
            userId: user._id,
            leaseKey: eventKey,
          })
        : null;
      privacyLeaseId = privacyRun?.leaseId;

      const threadId = await ctx.runMutation(
        internal.threads.findOrCreateByImessageChat,
        {
          orgId,
          userId: user._id,
          chatGuid,
          isGroup,
          scope: scope.kind === "multi_org" ? "multi_org" : "single_org",
          title: groupMemberTitle ?? args.chatTitle,
          fallbackPhone: fromPhone.includes("@") ? undefined : fromPhone,
          userName: user.name,
          historyGeneration: privacyRun?.generation,
        },
      );
      if (privacyRun) {
        await ctx.runMutation(internal.imessagePrivacy.attachAgentRunThread, {
          leaseId: privacyRun.leaseId,
          threadId,
        });
        await ctx.runMutation(
          internal.imessageInboundEvents.attachPrivacyContext,
          {
            eventKey,
            threadId,
            historyGeneration: privacyRun.generation,
          },
        );
      }

      const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
      if (!org) return await finish("Unable to find your account.");
      const agentScope = await ctx.runQuery(
        internal.lib.agentScope.resolveForAction,
        {
          orgId,
          userId: user._id,
          surface: "imessage",
        },
      );
      const readOrgIds = agentScope.readOrgIds;
      const scopedOrgs = await Promise.all(
        readOrgIds.map((scopedOrgId) =>
          ctx.runQuery(internal.orgs.getInternal, { id: scopedOrgId }),
        ),
      );
      const orgNamesById = Object.fromEntries(
        scopedOrgs
          .filter((scopedOrg) => scopedOrg !== null)
          .map((scopedOrg) => [String(scopedOrg._id), scopedOrg.name]),
      );

      const userName = user.name?.split(/\s+/)[0];
      const emailIdentity = await resolveEmailAgentIdentity(org);

      const attachmentRecords = await storeImessageAttachments(
        ctx,
        voiceMemoInput.nonAudioAttachments,
      );

      const inboundThreadMessageId = await ctx.runMutation(
        internal.threads.insertImessageMessage,
        {
          threadId,
          orgId,
          role: "user",
          userId: currentParticipant?.userId,
          userName:
            currentParticipant?.userName ??
            currentParticipant?.displayName ??
            anonymousParticipantLabel(senderAddress, 1),
          imessageSenderAddress: senderAddress,
          imessageParticipantLabel:
            currentParticipant?.userName ??
            currentParticipant?.displayName ??
            anonymousParticipantLabel(senderAddress, 1),
          content: inboundMessageText,
          messageId: args.sourceMessageId ?? eventKey,
          attachments:
            attachmentRecords.length > 0
              ? attachmentRecords.map((a) => ({
                  filename: a.filename,
                  contentType: a.contentType,
                  size: a.size,
                  fileId: a.fileId,
                }))
              : undefined,
        },
      );
      const boundedHistory = await loadBoundedAgentHistory(ctx, {
        threadId,
        currentMessageId: inboundThreadMessageId,
        surface: "imessage",
      });

      if (voiceMemoInput.failureResponse) {
        const failureMessageId = await ctx.runMutation(
          internal.threads.insertImessageMessage,
          {
            threadId,
            orgId,
            role: "agent",
            content: voiceMemoInput.failureResponse,
            responseMessageId: `${eventKey}:voice-transcription-failed`,
          },
        );
        await scheduleThreadHistoryCompaction(ctx, threadId);
        return await finish(voiceMemoInput.failureResponse, undefined, {
          threadMessageId: failureMessageId,
        });
      }

      const history: ImessageHistoryMessage[] = boundedHistory.messages;
      const historyForContext = history.filter((msg) => {
        if (msg.status === "processing") return false;
        if (isImessageStatusCue(msg)) return false;
        return String(msg._id) !== String(inboundThreadMessageId);
      });
      const recentConversationContext =
        buildRecentImessageTextContext(historyForContext);

      const inboundRating = imessageRating(inboundMessageText);
      const ratingTarget = inboundRating ? historyForContext.at(-1) : undefined;
      if (
        inboundRating &&
        ratingTarget &&
        ratingTarget.role === "agent" &&
        ratingTarget.feedbackPromptedAt &&
        !isGroup &&
        currentSenderIsLinked
      ) {
        const feedback = await ctx.runMutation(
          internalApi.agentResponseFeedback.recordImessageInternal,
          {
            messageId: ratingTarget._id,
            senderAddress,
            rating: inboundRating,
          },
        );
        if (feedback.shouldSubmit && feedback.routerRequestId) {
          try {
            await sendClRouterFeedback({
              requestId: feedback.routerRequestId,
              idempotencyKey: `agent-response:${ratingTarget._id}:${createHash("sha256").update(senderAddress).digest("hex")}`,
              source: "imessage",
              signals: { rating: inboundRating === "positive" ? "up" : "down" },
              trace: {
                traceId: String(ratingTarget._id),
                channel: "imessage",
                taskKind: "query_reason",
              },
            });
            await ctx.runMutation(
              internalApi.agentResponseFeedback.markRouterSignalInternal,
              { feedbackId: feedback.id, status: "submitted" },
            );
          } catch (error) {
            console.warn(
              "Could not submit iMessage response rating to cl-router",
              error,
            );
            await ctx.runMutation(
              internalApi.agentResponseFeedback.markRouterSignalInternal,
              {
                feedbackId: feedback.id,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
        await scheduleThreadHistoryCompaction(ctx, threadId);
        return await finish("Thanks — that helps improve future responses.");
      }

      const draftEmails = await ctx.runQuery(
        internal.pendingEmails.listDraftsInternal,
        { threadId, orgId },
      );
      const pendingEmails = await ctx.runQuery(
        internal.pendingEmails.findPendingByThread,
        { threadId },
      );
      const latestCancelledEmail = await ctx.runQuery(
        internal.pendingEmails.findLatestCancelledByThread,
        { threadId, orgId },
      );
      const deterministicControlResult = await runImessageDeterministicControls(
        ctx,
        {
          messageText: inboundMessageText,
          orgId,
          userId: user._id,
          orgName: org.name,
          userName: user.name,
          userEmail: user.email,
          threadId,
          eventKey,
          chatGuid,
          isGroup,
          scopeMode: agentScope.mode,
          currentSenderIsLinked,
          draftEmails,
          pendingEmails,
          latestCancelledEmail,
          history: historyForContext,
          currentMessageId: inboundThreadMessageId,
        },
      );
      if (deterministicControlResult) {
        await scheduleThreadHistoryCompaction(ctx, threadId);
        return await finish(deterministicControlResult.response, undefined, {
          leaveGroup: deterministicControlResult.leaveGroup,
        });
      }

      const policyFocusIds = await validatePolicyFocusIds(
        ctx,
        agentScope,
        selectPolicyFocusIds(historyForContext),
      );
      const policyFocusBlock = formatPolicyFocusHints(policyFocusIds);
      const emailReferencedPolicyIds: Id<"policies">[] = [];

      const currentSpeakerLabel =
        currentParticipant?.userName ??
        currentParticipant?.displayName ??
        anonymousParticipantLabel(senderAddress, 1);
      const modelMessages = await buildImessageModelMessages({
        history,
        messageText: inboundMessageText,
        currentSpeakerLabel,
        attachmentRecords,
        currentMessageId: inboundThreadMessageId,
      });
      const chatTask = imessageAgentTaskForAttachments(attachmentRecords);

      const systemPrompt =
        buildSystemPromptForContext({
          org: {
            name: org.name,
            context: org.context,
          },
          mode: "direct",
          userName,
          siteUrl,
        }) +
        buildChannelInstructions({
          platform: "imessage",
          canSendEmail: emailIdentity.canSend,
          emailUnavailableReason: emailIdentity.reason,
        }) +
        "\n\n" +
        buildImessageRosterContext({
          senderAddress,
          participants: resolvedParticipants,
          orgNamesById,
          scopeKind: scope.kind,
        }) +
        buildPolicyToolInstructions(8) +
        buildThreadHistoryToolInstructions() +
        buildThreadContinuityPrompt(boundedHistory.summary) +
        (policyFocusBlock ? `\n\n${policyFocusBlock}` : "");

      const runState = createImessageAgentRunState();
      const onPolicyReferenced = (policyId: Id<"policies">) => {
        if (!emailReferencedPolicyIds.some((id) => id === policyId)) {
          emailReferencedPolicyIds.push(policyId);
        }
      };
      const orgMembers = await ctx.runQuery(internal.users.listByOrgInternal, {
        orgId,
      });
      const allowedRecipients = [
        ...new Set(
          [
            user.email,
            ...orgMembers.flatMap((member) =>
              member?.email ? [member.email] : [],
            ),
          ]
            .filter(Boolean)
            .map((email) => String(email).toLowerCase()),
        ),
      ];
      const availableEmailAttachments = attachmentRecords
        .filter(
          (att): att is typeof att & { fileId: Id<"_storage"> } => !!att.fileId,
        )
        .map((att) => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          fileId: att.fileId,
        }));
      const availableFileIds = new Set(
        availableEmailAttachments.map((attachment) =>
          String(attachment.fileId),
        ),
      );
      const requirementImportResolution =
        await decideRequirementAttachmentImport(ctx, {
          orgId,
          messageText: inboundMessageText,
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
      const imessageWritableOrgIds = agentScope.writableOrgIds;

      const imessageTools = {
        ...buildAgentToolExecutors(ctx, {
          surface: "imessage",
          orgId,
          userId: user._id,
          scope: agentScope,
          readOrgIds,
          writableOrgIds: imessageWritableOrgIds,
          threadId,
          canWrite: currentSenderIsLinked,
          writeUnavailableMessage:
            "Only a linked Spot user in this chat can do that.",
          availableFileIds,
          requirementImportAttachments,
          requirementImportDefaultScope,
          onPolicyPresented: runState.onPolicyPresented,
          onPolicyReferenced,
          onResponseAttachment: runState.onResponseAttachment,
          onToolArtifact: runState.onToolArtifact,
        }),
        create_imessage_group_chat: {
          ...createImessageGroupChat,
          execute: async (params: {
            recipients: string[];
            openingMessage: string;
            title?: string;
            confirmed: boolean;
          }) => {
            if (!currentSenderIsLinked) {
              return "Only a linked Spot user can start a new group chat.";
            }
            if (!params.confirmed) {
              return "Ask the user to confirm before creating a new iMessage group chat.";
            }
            return await ctx.runAction(
              internal.actions.createOutboundImessageGroup
                .createOutboundImessageGroupInternal,
              {
                orgId,
                userId: user._id,
                recipients: params.recipients,
                openingMessage: params.openingMessage,
                title: params.title,
              },
            );
          },
        },
        ...(currentSenderIsLinked
          ? {
              coordinate_mailbox_task: {
                ...coordinateMailboxTask,
                execute: async (params: { task: string }) =>
                  await ctx.runAction(
                    internal.actions.mailboxCoordinator.runInternal,
                    {
                      orgId,
                      userId: user._id,
                      task: params.task,
                      routingParentId: `${eventKey}:agent`,
                      statusToPhone: fromPhone,
                      statusChatGuid: chatGuid,
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
        ...(currentSenderIsLinked &&
        emailIdentity.canSend &&
        emailIdentity.agentAddress &&
        emailIdentity.fromHeader
          ? {
              email_expert: buildEmailExpertTool(ctx, {
                orgId,
                userId: user._id,
                threadId,
                sourceUserMessageId: inboundThreadMessageId,
                routingParentId: `${eventKey}:agent`,
                channel: "imessage",
                fromHeader: emailIdentity.fromHeader,
                agentAddress: emailIdentity.agentAddress,
                senderEmail: user.email,
                defaultTo: user.email,
                defaultRecipientName: user.name,
                defaultBcc:
                  org.bccRequesterOnAgentEmails !== false && user.email
                    ? [user.email]
                    : undefined,
                allowedRecipients,
                availableAttachments: availableEmailAttachments,
                referencedPolicyIds: emailReferencedPolicyIds,
                emailSendDelay: org.emailSendDelay,
                conversationContext:
                  recentConversationContext +
                  (draftEmails.length > 0
                    ? `\n\nCURRENT EMAIL DRAFTS:\n${buildEmailDraftTextSummary(
                        draftEmails,
                        {
                          sampleSize: Math.min(3, draftEmails.length),
                          commands: "chat",
                        },
                      )}`
                    : ""),
                onResult: runState.setEmailResult,
              }),
            }
          : {}),
      };

      const turn = await runAgentTurn(ctx, {
        orgId,
        task: chatTask,
        messageText: inboundMessageText,
        recentConversationContext,
        currentAttachmentNames: attachmentRecords.map(
          (attachment) => attachment.filename,
        ),
        options: {
          maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
          system: systemPrompt,
          messages: modelMessages,
          tools: imessageTools,
          stopWhen: stepCountIs(8),
          prepareStep: ({ stepNumber }) =>
            requiredRequirementImportStep(
              stepNumber,
              requirementImportAttachments.length > 0,
            ),
        },
        run: {
          taskKind: "query_reason",
          sessionKey: String(threadId),
          trace: {
            traceId: `${eventKey}:agent`,
            parentRequestId: args.sourceMessageId ?? eventKey,
            label: "convex.handleInboundImessage",
            phase: "query_reason",
            channel: "imessage",
          },
        },
      });

      const { usedTools, toolCalls, workflowOutcomes } = turn.audit;
      runState.appendWorkflowOutcomes(workflowOutcomes);
      const responseFileAttachments = runState.responseFileAttachments;
      const imessageToolArtifacts = runState.toolArtifacts;
      let responseText = turn.text;
      let responseAlreadySent = false;
      let pendingEmailIdForResponse: Id<"pendingEmails"> | undefined;
      let emailConfirmationPrompt:
        | {
            content: string;
            dedupeKey: string;
            pendingEmailId: Id<"pendingEmails">;
            payload: Doc<"threadActionConfirmations">["payload"];
          }
        | undefined;
      const emailResult = runState.getEmailResult();
      if (emailResult) {
        const visibleEmailResponseBody = cleanAgentMarkdownForTransport(
          emailResult.responseBody,
        );
        responseText = visibleEmailResponseBody;
        pendingEmailIdForResponse = emailResult.pendingEmailId;
        if (
          emailResult.status === "draft" ||
          emailResult.status === "needs_confirmation"
        ) {
          const draftsAfterEmailTool = await ctx.runQuery(
            internal.pendingEmails.listDraftsInternal,
            { threadId, orgId },
          );
          const draft = emailResult.pendingEmailId
            ? draftsAfterEmailTool.find(
                (candidate) => candidate._id === emailResult.pendingEmailId,
              )
            : draftsAfterEmailTool[0];
          if (draft) {
            pendingEmailIdForResponse = pendingEmailIdForResponse ?? draft._id;
            const confirmation = await buildPendingEmailConfirmation(draft);
            const statusText =
              confirmation.payload.kind === "coi_batch_delivery"
                ? `Confirm this exact COI batch for ${draft.recipientEmail}: ${(draft.attachments ?? []).map((attachment) => attachment.filename).join(", ")}. This authorizes the attachment set; use /send 1 after authorization.`
                : `Confirm this exact draft to ${draft.recipientEmail} with subject “${draft.subject}” to send it.`;
            emailConfirmationPrompt = {
              content: statusText,
              dedupeKey: `imessage-email-confirmation:${String(draft._id)}:${confirmation.fingerprint}`,
              pendingEmailId: draft._id,
              payload: confirmation.payload,
            };
          }
        }
        if (emailResult.status === "pending") {
          const sent = await sendImmediateImessage({
            toPhone: fromPhone,
            chatGuid,
            message: visibleEmailResponseBody,
          });
          if (sent) {
            responseAlreadySent = true;
            responseText = "";
            await ctx.runMutation(internal.threads.insertImessageMessage, {
              threadId,
              orgId,
              role: "agent",
              content: visibleEmailResponseBody,
              responseMessageId: `${eventKey}:pending-email`,
              pendingEmailId: emailResult.pendingEmailId,
              referencedPolicyIds:
                runState.presentedPolicyIds.length > 0
                  ? runState.presentedPolicyIds
                  : undefined,
              usedTools: usedTools.length > 0 ? usedTools : undefined,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
      }

      responseText = cleanAgentMarkdownForTransport(responseText);
      if (!responseText.trim() && !responseAlreadySent) {
        console.warn("[imessage] Model completed without response text", {
          fromPhone,
          orgId,
          threadId,
          usedTools,
          toolCallCount: toolCalls.length,
        });
        responseText =
          "I couldn't format that response. Please try again in a moment.";
      }

      const feedbackPromptedAt =
        !isGroup &&
        currentSenderIsLinked &&
        !responseAlreadySent &&
        !emailConfirmationPrompt &&
        requirementImportResolution.authorization !== "confirmation" &&
        Boolean(turn.routerRequestId) &&
        shouldPromptForImessageRating(eventKey)
          ? dayjs().valueOf()
          : undefined;
      if (feedbackPromptedAt) {
        responseText = `${responseText.trim()}\n\n${IMESSAGE_RATING_PROMPT}`;
      }

      const responseAttachments: Array<{
        url: string;
        filename: string;
        mimeType: string;
      }> = [];
      const resolvedFileAttachments: typeof responseFileAttachments = [];
      const attachmentResolutionFailures: Array<{
        filename: string;
        error: string;
      }> = [];
      for (const fileAttachment of responseFileAttachments) {
        try {
          const url = await ctx.storage.getUrl(fileAttachment.storageId);
          if (url) {
            responseAttachments.push({
              url,
              filename: fileAttachment.filename,
              mimeType: "application/pdf",
            });
            resolvedFileAttachments.push(fileAttachment);
          } else {
            attachmentResolutionFailures.push({
              filename: fileAttachment.filename,
              error: "Storage URL was unavailable.",
            });
          }
        } catch (err) {
          console.warn("[imessage] Failed to get attachment URL:", err);
          attachmentResolutionFailures.push({
            filename: fileAttachment.filename,
            error: errorText(err),
          });
        }
      }

      if (attachmentResolutionFailures.length > 0) {
        responseText = appendAttachmentFailureNotice(responseText);
        imessageToolArtifacts.push({
          type: "imessage_attachment_delivery",
          data: {
            status: "failed",
            stage: "url_resolution",
            failures: attachmentResolutionFailures,
          },
        });
      }

      const agentAttachments = resolvedFileAttachments.map((c) => ({
        filename: c.filename,
        contentType: "application/pdf",
        size: 0,
        fileId: c.storageId,
      }));
      let agentResponseMessageId: Id<"threadMessages"> | undefined;
      if (responseText.trim()) {
        agentResponseMessageId = await ctx.runMutation(
          internal.threads.insertImessageMessage,
          {
            threadId,
            orgId,
            role: "agent",
            content: responseText,
            routerRequestId: turn.routerRequestId,
            feedbackPromptedAt,
            responseMessageId: `${eventKey}:response`,
            referencedPolicyIds:
              runState.presentedPolicyIds.length > 0
                ? runState.presentedPolicyIds
                : undefined,
            pendingEmailId: pendingEmailIdForResponse,
            attachments:
              agentAttachments.length > 0 ? agentAttachments : undefined,
            usedTools: usedTools.length > 0 ? usedTools : undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            toolArtifacts:
              imessageToolArtifacts.length > 0
                ? imessageToolArtifacts
                : undefined,
          },
        );
      }

      if (emailConfirmationPrompt && agentResponseMessageId) {
        const statusMessageId = await ctx.runMutation(
          internal.threads.insertWorkflowStatusMessage,
          {
            orgId,
            threadId,
            channel: "imessage",
            sourceThreadMessageId: agentResponseMessageId,
            pendingEmailId: emailConfirmationPrompt.pendingEmailId,
            dedupeKey: emailConfirmationPrompt.dedupeKey,
            content: emailConfirmationPrompt.content,
          },
        );
        await ctx.runMutation(
          internal.threadActionConfirmations.createInternal,
          {
            orgId,
            threadId,
            actor: { kind: "user", userId: user._id },
            promptMessageId: statusMessageId,
            payload: emailConfirmationPrompt.payload,
          },
        );
        responseText = `${responseText.trim()}\n\n${emailConfirmationPrompt.content}`;
      }

      const requirementConfirmation = !emailResult
        ? buildRequirementImportConfirmation(requirementImportResolution)
        : undefined;
      if (requirementConfirmation && agentResponseMessageId) {
        const statusMessageId = await ctx.runMutation(
          internal.threads.insertWorkflowStatusMessage,
          {
            orgId,
            threadId,
            channel: "imessage",
            sourceThreadMessageId: agentResponseMessageId,
            dedupeKey: `imessage-requirement-import-confirmation:${eventKey}`,
            content: requirementConfirmation.message,
          },
        );
        await ctx.runMutation(
          internal.threadActionConfirmations.createInternal,
          {
            orgId,
            threadId,
            actor: { kind: "user", userId: user._id },
            promptMessageId: statusMessageId,
            payload: requirementConfirmation.payload,
          },
        );
        responseText = `${responseText.trim()}\n\n${requirementConfirmation.message}`;
      }

      const emailDraftCard =
        emailConfirmationPrompt && agentResponseMessageId
          ? await mintImessageEmailDraftReviewCard(ctx, {
              pendingEmailId: emailConfirmationPrompt.pendingEmailId,
              threadId,
              sourceThreadMessageId: agentResponseMessageId,
            })
          : null;
      const appCards = [
        ...(emailDraftCard ? [emailDraftCard] : []),
        ...(await mintImessageAppCards(ctx, {
          org,
          threadId,
          sourceThreadMessageId: agentResponseMessageId,
          createdByUserId: user._id,
          presentedPolicyIds: runState.presentedPolicyIds,
          artifacts: imessageToolArtifacts,
        })),
      ];
      await scheduleThreadHistoryCompaction(ctx, threadId);

      return await finish(
        responseText,
        responseAttachments.length > 0 ? responseAttachments : undefined,
        {
          appCards: appCards.length > 0 ? appCards : undefined,
          threadMessageId: agentResponseMessageId,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[imessage] Agent processing error:", message);
      return await finish(FATAL_ACTION_FAILED_MESSAGE);
    } finally {
      if (privacyLeaseId) {
        await ctx.runMutation(internal.imessagePrivacy.releaseAgentRun, {
          leaseId: privacyLeaseId,
        });
      }
    }
  },
});
