import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// HMAC-SHA256(secret, rawBody), hex-encoded
async function verifySignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
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

function isPhoneNumber(sender: string): boolean {
  // E.164 format or numeric-ish string
  return /^\+?\d[\d\s()-]{6,}$/.test(sender.trim());
}

function normalizePhone(sender: string): string {
  const digits = sender.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

export const webhook = httpAction(async (ctx, request) => {
  const rawBody = await request.text();

  // Verify HMAC signature
  const webhookSecret = process.env.IMESSAGE_BRIDGE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = request.headers.get("X-Webhook-Signature") || "";
    const valid = await verifySignature(rawBody, signature, webhookSecret);
    if (!valid) {
      console.error("iMessage bridge webhook signature verification failed");
      return new Response("unauthorized", { status: 401 });
    }
  }

  const body = JSON.parse(rawBody);

  // Bridge payload: { message: { id, sender, text, hasAttachments, attachments } }
  const message = body.message;
  if (!message) {
    console.error("iMessage bridge webhook missing message:", body);
    return new Response("bad request", { status: 400 });
  }

  const messageId: string = message.id || "";
  const sender: string = message.sender || "";
  const text: string = message.text || "";
  const hasAttachments: boolean = message.hasAttachments || false;

  if (!sender) {
    console.error("iMessage bridge webhook missing sender:", body);
    return new Response("bad request", { status: 400 });
  }

  if (!messageId) {
    console.error("iMessage bridge webhook missing message id:", body);
    return new Response("bad request", { status: 400 });
  }

  // Normalize phone if sender is a phone number
  const phone = isPhoneNumber(sender) ? normalizePhone(sender) : sender;

  // Phase 1: Claim webhook for dedup
  const dedupeId = `imbridge_${messageId}`;
  const { claimed } = await ctx.runMutation(internal.ingest.claimWebhook, {
    openPhoneId: dedupeId,
  });
  if (!claimed) {
    return new Response("duplicate", { status: 200 });
  }

  // Phase 2: Ingest message
  const result = await ctx.runMutation(internal.ingest.ingestBridgeMessage, {
    messageId: dedupeId,
    from: phone,
    text,
    hasAttachment: hasAttachments,
    imessageSender: sender,
  });

  if (!result) {
    return new Response("ok", { status: 200 });
  }

  const { userId, state, uploadToken, imessageSender, isNewUser } = result;

  // Route — same state machine as Linq, but pass imessageSender
  if (isNewUser) {
    await ctx.scheduler.runAfter(0, internal.process.sendWelcome, {
      userId,
      phone,
      uploadToken,
      imessageSender,
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
        hasAttachment: hasAttachments,
        // Phase 1: no media URL for bridge attachments
        imessageSender,
      }
    );
  } else if (state === "awaiting_merge_confirm") {
    await ctx.scheduler.runAfter(0, internal.process.handleMergeConfirmation, {
      userId,
      phone,
      input: text,
      imessageSender,
    });
  } else if (state === "awaiting_app_questions") {
    await ctx.scheduler.runAfter(0, internal.process.handleAppQuestions, {
      userId,
      phone,
      input: text,
      imessageSender,
    });
  } else if (state === "awaiting_app_confirm") {
    await ctx.scheduler.runAfter(0, internal.process.handleAppConfirmation, {
      userId,
      phone,
      input: text,
      imessageSender,
    });
  } else if (state === "awaiting_insurance_slip") {
    // Bridge doesn't support attachments yet — handle text only
    await ctx.scheduler.runAfter(0, internal.process.handleInsuranceSlipResponse, {
      userId,
      phone,
      input: text,
      uploadToken,
      imessageSender,
    });
  } else if (state === "awaiting_policy") {
    if (hasAttachments) {
      // Phase 1: text only — if there's text, process it; otherwise nudge
      if (text) {
        await ctx.scheduler.runAfter(0, internal.process.nudgeForPolicy, {
          userId,
          phone,
          input: text,
          uploadToken,
          imessageSender,
        });
      } else {
        await ctx.scheduler.runAfter(0, internal.process.nudgeForPolicy, {
          userId,
          phone,
          input: "",
          uploadToken,
          imessageSender,
        });
      }
    } else {
      await ctx.scheduler.runAfter(0, internal.process.nudgeForPolicy, {
        userId,
        phone,
        input: text,
        uploadToken,
        imessageSender,
      });
    }
  } else {
    // Active state — Q&A or new policy
    if (hasAttachments && !text) {
      // Attachment-only in active state — nudge to use upload link (phase 1: no attachment support)
      const user = await ctx.runQuery(internal.users.get, { userId });
      const token = user?.uploadToken || uploadToken;
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://secure.claritylabs.inc";
      const link = `${baseUrl}/upload/${token}`;
      // We can't process attachments yet, suggest the upload page
      await ctx.scheduler.runAfter(0, internal.process.nudgeForPolicy, {
        userId,
        phone,
        input: "",
        uploadToken: token,
        imessageSender,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.process.handleQuestion, {
        userId,
        question: text,
        phone,
        uploadToken,
        imessageSender,
      });
    }
  }

  return new Response("ok", { status: 200 });
});
