"use node";
import { internal } from "./_generated/api";

// Channel-aware send: tries Linq first, then iMessage bridge, falls back to OpenPhone
export async function sendAndLog(
  ctx: any,
  userId: any,
  phone: string,
  body: string,
  linqChatId?: string,
  imessageSender?: string
) {
  let usedChannel = "openphone";

  if (linqChatId) {
    try {
      await ctx.runAction(internal.sendLinq.sendLinqMessage, {
        chatId: linqChatId,
        body,
      });
      usedChannel = "linq";
    } catch (err) {
      console.error("Linq send failed, falling back to OpenPhone:", err);
      await ctx.runAction(internal.send.sendSms, { to: phone, body });
    }
  } else if (imessageSender) {
    try {
      await ctx.runAction(internal.sendBridge.sendBridgeMessage, {
        to: imessageSender,
        body,
      });
      usedChannel = "imessage_bridge";
    } catch (err) {
      console.error("iMessage bridge failed, falling back to OpenPhone:", err);
      await ctx.runAction(internal.send.sendSms, { to: phone, body });
    }
  } else {
    await ctx.runAction(internal.send.sendSms, { to: phone, body });
  }

  await ctx.runMutation(internal.messages.log, {
    userId,
    direction: "outbound" as const,
    body,
    hasAttachment: false,
    channel: usedChannel,
  });
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendBurst(
  ctx: any,
  userId: any,
  phone: string,
  messages: string[],
  linqChatId?: string,
  imessageSender?: string
) {
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await sleep(800 + Math.random() * 700);
    await sendAndLog(ctx, userId, phone, messages[i], linqChatId, imessageSender);
  }
}

export function getUploadLink(uploadToken: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://spot.claritylabs.inc";
  return `${baseUrl}/app/${uploadToken}`;
}
