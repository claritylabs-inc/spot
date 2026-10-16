"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import type { Message, Space } from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import { normalizeInboundTurn } from "../lib/imessageTransport/inboundNormalization";
import type {
  ImessageRequest,
  ImessageResponse,
} from "../lib/imessageTransport/convex";
import { MAX_OPERATOR_IMESSAGE_ACTION_BASE64_CHARS } from "../lib/agentAttachmentLimits";
import {
  isImessageWebhookTransportEnabled,
  type ImessageChannelRole,
} from "../lib/imessageConfig";
import { recordImessageAttachmentDeliveryFailures } from "../lib/imessageDeliveryEvents";
import { normalizeInboundImessageSender } from "../lib/imessageIngress";
import {
  getChatSnapshot,
  leaveImessageGroup,
  readWebhookAttachment,
  resolveReplyTarget,
  resolveWebhookTurn,
  sendOutboundAppCards,
  sendOutboundAttachments,
  sendResponseText,
  sendSpotContactCard,
  webhookRecoveryClient,
  withSpectrumApp,
  withTypingIndicator,
  type SpectrumApp,
} from "../lib/imessageSpectrum";

const roleValidator = v.union(v.literal("customer"), v.literal("operator"));
const MAX_SETUP_RETRIES = 2;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function processingFallbackMessage(error: unknown): string {
  return /timed out|timeout/i.test(errorMessage(error))
    ? "I'm still working on that. If I don't follow up here, check Spot for the draft."
    : "Sorry, something went wrong. Please try again.";
}

/** Calls the same internal handlers the worker reached via `/imessage-inbound`. */
async function runInboundHandler(
  ctx: ActionCtx,
  role: ImessageChannelRole,
  request: ImessageRequest,
): Promise<ImessageResponse> {
  if (role === "customer") {
    return await ctx.runAction(
      internal.actions.handleInboundImessage.processInbound,
      request,
    );
  }
  const encodedAttachmentChars = (request.attachments ?? []).reduce(
    (total, attachment) => total + attachment.data.length,
    0,
  );
  if (encodedAttachmentChars > MAX_OPERATOR_IMESSAGE_ACTION_BASE64_CHARS) {
    throw new Error(
      "Operator iMessage attachments exceed the 3.5 million-character encoded transport limit",
    );
  }
  return await ctx.runAction(
    internal.actions.handleInboundOperatorImessage.processInbound,
    request,
  );
}

async function handleInboundTurn(
  ctx: ActionCtx,
  role: ImessageChannelRole,
  app: SpectrumApp,
  space: Space,
  message: Message,
) {
  if (!imessage.is(message)) return;
  const rawSenderId = message.sender?.id;
  if (!rawSenderId) {
    console.warn("[imessage-webhook] Ignoring inbound message without sender");
    return;
  }
  if (
    message.content.type !== "text" &&
    message.content.type !== "attachment" &&
    message.content.type !== "group"
  ) {
    return;
  }
  const fromPhone = normalizeInboundImessageSender(rawSenderId);
  const chatSnapshot = await getChatSnapshot(app, space);
  console.log("[imessage-webhook] Received inbound message", {
    role,
    fromPhone,
    chatGuid: chatSnapshot.chatGuid,
    isGroup: chatSnapshot.isGroup,
    contentType: message.content.type,
  });

  try {
    let recoveredGuid: string | undefined;
    const normalizedTurn = await normalizeInboundTurn({
      message,
      recoverFromPhoton: true,
      client: webhookRecoveryClient(app, space, message, (guid) => {
        recoveredGuid = guid;
      }),
      readAttachment: readWebhookAttachment,
    });
    const sourceMessageId = normalizedTurn.sourceMessageId ?? message.id;
    const sentAt = dayjs(message.timestamp);
    if (normalizedTurn.recoveryFailure) {
      console.warn("[imessage-webhook] Inbound recovery degraded", {
        sourceMessageId,
        stage: normalizedTurn.recoveryFailure.stage,
        error: normalizedTurn.recoveryFailure.error,
        fallbackAttachmentCount: normalizedTurn.attachments.length,
      });
    }

    const result = await withTypingIndicator(space, async () => {
      return await runInboundHandler(ctx, role, {
        fromPhone,
        messageText: normalizedTurn.messageText,
        chatGuid: chatSnapshot.chatGuid,
        isGroup: chatSnapshot.isGroup,
        chatTitle: chatSnapshot.chatTitle,
        participantsUnavailable: chatSnapshot.participantsUnavailable,
        participants: [
          ...chatSnapshot.participants,
          ...(chatSnapshot.participants.some(
            (participant) =>
              normalizeInboundImessageSender(participant.address) === fromPhone,
          )
            ? []
            : [{ address: fromPhone }]),
        ],
        sourceMessageId,
        receivedAt: sentAt.isValid() ? sentAt.valueOf() : dayjs().valueOf(),
        recoveryFailure: normalizedTurn.recoveryFailure
          ? {
              stage: normalizedTurn.recoveryFailure.stage,
              error: normalizedTurn.recoveryFailure.error,
            }
          : undefined,
        attachments:
          normalizedTurn.attachments.length > 0
            ? normalizedTurn.attachments
            : undefined,
      });
    });

    if (result.response) {
      await sendResponseText(
        space,
        await resolveReplyTarget({
          ctx,
          app,
          space,
          message,
          recoveredGuid,
          incomingText: normalizedTurn.messageText,
          replyText: result.response,
        }),
        result.response,
      );
    }
    if (role === "customer" && result.sendContactCard) {
      try {
        await sendSpotContactCard(space);
      } catch (error) {
        console.warn(
          "[imessage-webhook] Contact card delivery failed; continuing with response:",
          error,
        );
      }
    }
    await sendOutboundAppCards(space, result.appCards);
    const attachmentFailures = await sendOutboundAttachments(
      space,
      result.attachments,
    );
    if (attachmentFailures.length > 0 && result.threadMessageId) {
      await recordImessageAttachmentDeliveryFailures(ctx, role, {
        threadMessageId: result.threadMessageId,
        attachmentFailures,
      });
    }
    if (result.leaveGroup && result.chatGuid) {
      await leaveImessageGroup(app, space, result.chatGuid);
    }
  } catch (error) {
    console.error("[imessage-webhook] Error processing message:", error);
    try {
      await space.send(processingFallbackMessage(error));
    } catch {
      // The fallback is best effort, as it was in the worker.
    }
  }
}

/**
 * Processes one Spectrum webhook delivery accepted by the HTTP route. Runs the
 * former worker loop body: normalize, keep typing while the inbound handler
 * runs, then deliver the reply, contact card, app cards, and attachments.
 * Photon has already been acknowledged, so a Spectrum setup failure (before
 * anything is sent; turn errors are answered in the chat) is retried here.
 */
export const processMessage = internalAction({
  args: {
    role: roleValidator,
    body: v.bytes(),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!isImessageWebhookTransportEnabled(args.role)) {
      console.warn(
        "[imessage-webhook] Dropping delivery accepted before the webhook transport was disabled",
        { role: args.role },
      );
      return null;
    }
    try {
      await withSpectrumApp(args.role, async (app, webhookSecret) => {
        const turn = await resolveWebhookTurn(
          app,
          webhookSecret,
          new Uint8Array(args.body),
        );
        if (!turn) {
          console.warn("[imessage-webhook] Delivery produced no message", {
            role: args.role,
          });
          return;
        }
        await handleInboundTurn(ctx, args.role, app, turn.space, turn.message);
      });
    } catch (error) {
      const attempt = args.attempt ?? 0;
      if (attempt >= MAX_SETUP_RETRIES) throw error;
      console.warn("[imessage-webhook] Spectrum setup failed; retrying", {
        role: args.role,
        attempt,
        error: errorMessage(error),
      });
      await ctx.scheduler.runAfter(
        5_000 * (attempt + 1),
        internal.actions.imessageWebhook.processMessage,
        { ...args, attempt: attempt + 1 },
      );
    }
    return null;
  },
});
