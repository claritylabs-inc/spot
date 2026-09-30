"use node";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import dayjs from "dayjs";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { mcpEventIdentityValidator } from "../lib/mcpEventIdentity";
import { validateMcpEventFilters } from "../lib/mcpEventCatalog";
import { mcpEventRefreshBefore, mcpEventSubscriptionIdentity, parseMcpEventRequest } from "../lib/mcpEventProtocol";
import { McpCallbackError, sendMcpWebhookEvent, validateMcpWebhookSecret, validateMcpWebhookUrl, verifyMcpWebhookCallback } from "../lib/mcpEventWebhook";

function encryptionKey() {
  const encoded = process.env.MCP_EVENTS_ENCRYPTION_KEY;
  if (!encoded) throw new Error("MCP Events encryption is not configured");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("Invalid MCP Events encryption configuration");
  return key;
}

export function encryptMcpEventSecret(secret: string, subscriptionId: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(subscriptionId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptMcpEventSecret(encrypted: string, subscriptionId: string) {
  const bytes = Buffer.from(encrypted, "base64");
  if (bytes.length < 29 || bytes.toString("base64") !== encrypted) throw new Error("Invalid MCP Events secret");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  cipher.setAAD(Buffer.from(subscriptionId, "utf8"));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
}

export const subscribe = internalAction({
  args: { identity: mcpEventIdentityValidator, params: v.any() },
  handler: async (ctx, args): Promise<{ id: string; refreshBefore: string; cursor: null; truncated: boolean }> => {
    const request = parseMcpEventRequest(args.params, "subscribe");
    const filters = validateMcpEventFilters(request.name, request.arguments);
    await ctx.runQuery(internal.mcpEvents.authorizeInternal, { identity: args.identity, name: request.name, filters });
    let callbackUrl: string;
    const secret = request.delivery.secret;
    if (!secret) throw new Error("Missing callback secret");
    try {
      callbackUrl = validateMcpWebhookUrl(request.delivery.url);
      validateMcpWebhookSecret(secret);
    } catch (error) {
      if (error instanceof McpCallbackError) throw new ConvexError({ code: -32015, reason: error.reason });
      throw error;
    }
    const secretFingerprint = createHash("sha256").update(secret).digest("hex");
    const principal = await ctx.runQuery(internal.mcpEvents.authorizeInternal, {
      identity: args.identity, name: request.name, filters, callbackUrl, secretFingerprint,
    });
    const id = await mcpEventSubscriptionIdentity({ principalKey: principal.principalKey, name: request.name, arguments: filters, url: callbackUrl });
    const expiresAt = mcpEventRefreshBefore(request.ttlMs, dayjs().valueOf());
    const encryptedSecret = encryptMcpEventSecret(secret, id);
    let callbackVerifiedAt = principal.callbackVerifiedAt;
    if (callbackVerifiedAt === undefined) {
      try {
        await verifyMcpWebhookCallback({ url: callbackUrl, secret, subscriptionId: id });
      } catch (error) {
        if (error instanceof McpCallbackError) throw new ConvexError({ code: -32015, reason: error.reason });
        throw error;
      }
      callbackVerifiedAt = dayjs().valueOf();
    }
    return await ctx.runMutation(internal.mcpEvents.saveSubscriptionInternal, {
      identity: args.identity, id, name: request.name, filters, callbackUrl, encryptedSecret,
      expiresAt, secretFingerprint, callbackVerifiedAt,
    });
  },
});

export const deliver = internalAction({
  args: { deliveryId: v.id("mcpEventDeliveries") },
  handler: async (ctx, args): Promise<void> => {
    const lease = randomUUID();
    const claim = await ctx.runMutation(internal.mcpEvents.claimDeliveryInternal, { deliveryId: args.deliveryId, lease });
    if (!claim) return;
    const { delivery, subscription } = claim;
    let statusCode = 0;
    let permanent = false;
    try {
      const secret = decryptMcpEventSecret(subscription.encryptedSecret, subscription.id);
      const previousSecret = subscription.previousEncryptedSecret && (subscription.previousSecretUntil ?? 0) > dayjs().valueOf()
        ? decryptMcpEventSecret(subscription.previousEncryptedSecret, subscription.id) : undefined;
      const authorized = await ctx.runQuery(internal.mcpEvents.checkDeliveryInternal, { deliveryId: delivery._id, lease, generation: subscription.generation });
      if (!authorized) {
        await ctx.runMutation(internal.mcpEvents.finishDeliveryInternal, { deliveryId: delivery._id, lease, generation: subscription.generation, statusCode: 0 });
        return;
      }
      const result = await sendMcpWebhookEvent({
        url: subscription.callbackUrl, secret, previousSecret, subscriptionId: subscription.id,
        event: { eventId: delivery.eventId, name: delivery.name, timestamp: delivery.timestamp, data: delivery.data, cursor: null },
      });
      statusCode = result.status;
    } catch (error) {
      permanent = !(error instanceof McpCallbackError) ||
        !["dns_failed", "network_error", "timeout"].includes(error.reason);
    }
    await ctx.runMutation(internal.mcpEvents.finishDeliveryInternal, { deliveryId: delivery._id, lease, generation: subscription.generation, statusCode, permanent });
  },
});
