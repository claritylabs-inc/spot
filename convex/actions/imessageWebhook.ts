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
import { isImessageWebhookTransportEnabled } from "../lib/imessageConfig";
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

const MAX_SETUP_RETRIES = 2;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function processingFallbackMessage(error: unknown): string {
  return /timed out|timeout/i.test(errorMessage(error))
    ? "I'm still working on that. If I don't follow up here, check Spot for the draft."
    : "Sorry, something went wrong. Please try again.";
}

/** Calls the same internal handler the worker reached via `/imessage-inbound`. */
async function runInboundHandler(
  ctx: ActionCtx,
  request: ImessageRequest,
): Promise<ImessageResponse> {
  return await ctx.runAction(
    internal.actions.handleInboundImessage.processInbound,
    request,
  );
}

async function handleInboundTurn(
  ctx: ActionCtx,
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
      return await runInboundHandler(ctx, {
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
    if (result.sendContactCard) {
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
      await recordImessageAttachmentDeliveryFailures(ctx, {
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
    body: v.bytes(),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!isImessageWebhookTransportEnabled()) {
      console.warn(
        "[imessage-webhook] Dropping delivery accepted before the webhook transport was disabled",
      );
      return null;
    }
    try {
      await withSpectrumApp(async (app, webhookSecret) => {
        const turn = await resolveWebhookTurn(
          app,
          webhookSecret,
          new Uint8Array(args.body),
        );
        if (!turn) {
          console.warn("[imessage-webhook] Delivery produced no message");
          return;
        }
        await handleInboundTurn(ctx, app, turn.space, turn.message);
      });
    } catch (error) {
      const attempt = args.attempt ?? 0;
      if (attempt >= MAX_SETUP_RETRIES) throw error;
      console.warn("[imessage-webhook] Spectrum setup failed; retrying", {
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
