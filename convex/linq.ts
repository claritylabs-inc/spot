import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// Per Linq V3 docs: HMAC-SHA256(secret, "{timestamp}.{payload}"), hex-encoded
// Secret is used as raw UTF-8 string, NOT base64-decoded
async function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
  timestamp: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const message = `${timestamp}.${rawBody}`;
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (computed.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

export const webhook = httpAction(async (ctx, request) => {
  const rawBody = await request.text();

  // Filter events early — only handle inbound messages
  const event = request.headers.get("X-Webhook-Event");
  if (event !== "message.received") {
    return new Response("ignored", { status: 200 });
  }

  // Verify HMAC signature
  const webhookSecret = process.env.LINQ_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = request.headers.get("X-Webhook-Signature") || "";
    const timestamp = request.headers.get("X-Webhook-Timestamp") || "";
    const valid = await verifySignature(rawBody, signature, webhookSecret, timestamp);
    if (!valid) {
      console.error("Linq webhook signature verification failed");
      return new Response("unauthorized", { status: 401 });
    }
  }

  const body = JSON.parse(rawBody);

  const data = body.data;
  if (!data) {
    console.error("Linq webhook missing data:", body);
    return new Response("bad request", { status: 400 });
  }

  const eventId: string = body.event_id || "";
  const chatId: string = data.chat?.id || "";
  const messageId: string = data.id || eventId;

  if (!chatId) {
    console.error("Linq webhook missing chat_id:", body);
    return new Response("bad request", { status: 400 });
  }

  const senderHandle: string = data.sender_handle?.handle || "";

  if (!senderHandle) {
    console.error("Linq webhook missing sender:", body);
    return new Response("bad request", { status: 400 });
  }

  const phone = senderHandle.startsWith("+")
    ? senderHandle
    : `+1${senderHandle.replace(/\D/g, "")}`;

  const parts: Array<{ type: string; value?: string; url?: string; mime_type?: string }> =
    data.parts || [];

  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => p.value || "")
    .join(" ")
    .trim();

  const mediaParts = parts.filter((p) => p.type === "media");
  const hasAttachment = mediaParts.length > 0;

  // Phase 1: Claim webhook for dedup
  const dedupeId = `linq_${eventId || messageId}`;
  const { claimed } = await ctx.runMutation(internal.ingest.claimWebhook, {
    openPhoneId: dedupeId,
  });
  if (!claimed) {
    return new Response("duplicate", { status: 200 });
  }

  // Send read receipt — scheduled to avoid dangling promise in httpAction
  await ctx.scheduler.runAfter(0, internal.sendLinq.markRead, { chatId });

  // Phase 2: Ingest message
  const result = await ctx.runMutation(internal.ingest.ingestLinqMessage, {
    messageId: dedupeId,
    from: phone,
    text,
    hasAttachment,
    linqChatId: chatId,
  });

  if (!result) {
    return new Response("ok", { status: 200 });
  }

  const { userId, state, uploadToken, linqChatId, isNewUser } = result;

  // Route based on state machine
  if (isNewUser) {
    await ctx.scheduler.runAfter(0, internal.process.sendWelcome, {
      userId,
      phone,
      uploadToken,
      linqChatId,
    });
  } else if (state === "awaiting_category") {
    await ctx.scheduler.runAfter(
      0,
      internal.process.handleCategorySelection,
      {
        userId,
        phone,
        input: text,
        uploadToken,
        hasAttachment,
        mediaUrl: hasAttachment ? mediaParts[0].url : undefined,
        mediaType: hasAttachment ? mediaParts[0].mime_type : undefined,
        linqChatId,
      }
    );
  } else if (state === "awaiting_email") {
    // User is providing their email address
    await ctx.scheduler.runAfter(0, internal.process.handleEmailCollection, {
      userId,
      phone,
      input: text,
      linqChatId,
    });
  } else if (state === "awaiting_email_confirm") {
    // User is confirming/cancelling/undoing an email
    await ctx.scheduler.runAfter(0, internal.process.handleEmailConfirmation, {
      userId,
      phone,
      input: text,
      linqChatId,
    });
  } else if (state === "awaiting_insurance_slip") {
    if (hasAttachment) {
      for (const attachment of mediaParts) {
        await ctx.scheduler.runAfter(0, internal.process.processInsuranceSlip, {
          userId,
          mediaUrl: attachment.url || "",
          mediaType: attachment.mime_type || "application/pdf",
          phone,
          linqChatId,
        });
      }
    } else {
      await ctx.scheduler.runAfter(0, internal.process.handleInsuranceSlipResponse, {
        userId,
        phone,
        input: text,
        uploadToken,
        linqChatId,
      });
    }
  } else if (state === "awaiting_policy") {
    if (hasAttachment) {
      for (const attachment of mediaParts) {
        await ctx.scheduler.runAfter(0, internal.process.processMedia, {
          userId,
          mediaUrl: attachment.url || "",
          mediaType: attachment.mime_type || "application/pdf",
          phone,
          userText: text,
          linqChatId,
        });
      }
    } else {
      await ctx.scheduler.runAfter(0, internal.process.nudgeForPolicy, {
        userId,
        phone,
        input: text,
        uploadToken,
        linqChatId,
      });
    }
  } else {
    // active state (or any other)
    if (hasAttachment) {
      for (const attachment of mediaParts) {
        await ctx.scheduler.runAfter(0, internal.process.processMedia, {
          userId,
          mediaUrl: attachment.url || "",
          mediaType: attachment.mime_type || "application/pdf",
          phone,
          userText: text,
          linqChatId,
        });
      }
    } else {
      await ctx.scheduler.runAfter(0, internal.process.handleQuestion, {
        userId,
        question: text,
        phone,
        uploadToken,
        linqChatId,
      });
    }
  }

  return new Response("ok", { status: 200 });
});
