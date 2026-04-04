"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

function getBridgeConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.IMESSAGE_BRIDGE_URL;
  const apiKey = process.env.IMESSAGE_BRIDGE_API_KEY;
  if (!baseUrl) throw new Error("Missing IMESSAGE_BRIDGE_URL env var");
  if (!apiKey) throw new Error("Missing IMESSAGE_BRIDGE_API_KEY env var");
  return { baseUrl, apiKey };
}

// Send a message via the iMessage bridge
export const sendBridgeMessage = internalAction({
  args: {
    to: v.string(),
    body: v.string(),
  },
  handler: async (_ctx, args) => {
    const { baseUrl, apiKey } = getBridgeConfig();

    const response = await fetch(`${baseUrl}/api/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        to: args.to,
        text: args.body,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Bridge send failed:", response.status, err);
      throw new Error(`iMessage bridge API error: ${response.status}`);
    }

    return await response.json();
  },
});

// Start typing indicator via the iMessage bridge
export const startTyping = internalAction({
  args: {
    to: v.string(),
    duration: v.optional(v.number()), // seconds, defaults to 5 on bridge
  },
  handler: async (_ctx, args) => {
    const { baseUrl, apiKey } = getBridgeConfig();

    await fetch(`${baseUrl}/api/typing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        to: args.to,
        duration: args.duration || 5,
      }),
    });
  },
});

// Stop typing — no-op, typing auto-clears on the bridge when a message is sent
export const stopTyping = internalAction({
  args: { to: v.string() },
  handler: async (_ctx, _args) => {
    // Typing indicators auto-clear on the bridge side
  },
});
