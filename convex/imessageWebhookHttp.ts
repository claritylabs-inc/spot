import type { PublicHttpAction } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getSpectrumWebhookSecret,
  isImessageWebhookTransportEnabled,
  type ImessageChannelRole,
} from "./lib/imessageConfig";
import {
  SPECTRUM_SIGNATURE_HEADER,
  SPECTRUM_TIMESTAMP_HEADER,
  verifySpectrumWebhookSignature,
} from "./lib/spectrumWebhookSignature";

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Photon Spectrum webhook ingress. Verifies the signature over the raw bytes,
 * dedupes on `message.id`, and acknowledges once processing is scheduled; the
 * Node action does the Spectrum work. While the role's cutover flag is off the
 * route answers 503 so Photon retries briefly instead of dropping the event.
 */
function spectrumImessageWebhook(role: ImessageChannelRole): PublicHttpAction {
  return httpAction(async (ctx, request) => {
    if (!isImessageWebhookTransportEnabled(role)) {
      return textResponse("webhook transport disabled", 503);
    }
    const secret = getSpectrumWebhookSecret(role);
    if (!secret) {
      console.error("[imessage-webhook] Spectrum webhook secret is missing", {
        role,
      });
      return textResponse("not configured", 503);
    }

    const rawBody = await request.arrayBuffer();
    const body = new Uint8Array(rawBody);
    const verification = await verifySpectrumWebhookSignature({
      secret,
      body,
      signature: request.headers.get(SPECTRUM_SIGNATURE_HEADER),
      timestamp: request.headers.get(SPECTRUM_TIMESTAMP_HEADER),
    });
    if (verification !== "ok") {
      console.warn("[imessage-webhook] Rejected delivery", {
        role,
        verification,
      });
      return textResponse(
        verification,
        verification === "missing-headers" ? 400 : 401,
      );
    }

    let payload: Record<string, unknown> | undefined;
    try {
      payload = objectRecord(JSON.parse(new TextDecoder().decode(body)));
    } catch {
      payload = undefined;
    }
    if (!payload) return textResponse("malformed payload", 400);
    if (payload.event !== "messages") return textResponse("ignored", 200);

    const message = objectRecord(payload.message);
    const messageId = message?.id;
    if (typeof messageId !== "string" || !messageId) {
      return textResponse("malformed payload", 400);
    }
    const platform =
      message?.platform ?? objectRecord(message?.space)?.platform;
    if (platform !== "iMessage") return textResponse("ignored", 200);

    const { accepted }: { accepted: boolean } = await ctx.runMutation(
      internal.imessageTransportClaims.acceptWebhookMessage,
      { role, messageId, body: rawBody },
    );
    return textResponse(accepted ? "ok" : "duplicate", 200);
  });
}

export const customerImessageWebhook = spectrumImessageWebhook("customer");
export const operatorImessageWebhook = spectrumImessageWebhook("operator");
