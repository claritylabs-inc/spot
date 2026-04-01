"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const LINQ_API_BASE = "https://api.linqapp.com/api/partner/v3";

function getLinqHeaders(): Record<string, string> {
  const apiKey = process.env.LINQ_API_KEY;
  if (!apiKey) throw new Error("Missing LINQ_API_KEY env var");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

// Send a message to an existing Linq chat
// V3: POST /v3/chats/{chatId}/messages with { message: { parts: [{ type: "text", value: "..." }] } }
export const sendLinqMessage = internalAction({
  args: {
    chatId: v.string(),
    body: v.string(),
  },
  handler: async (_ctx, args) => {
    const response = await fetch(
      `${LINQ_API_BASE}/chats/${args.chatId}/messages`,
      {
        method: "POST",
        headers: getLinqHeaders(),
        body: JSON.stringify({
          message: {
            parts: [{ type: "text", value: args.body }],
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("Linq send failed:", response.status, err);
      throw new Error(`Linq API error: ${response.status}`);
    }

    return await response.json();
  },
});

// Create a new Linq chat and send the first message — returns chatId
// V3: POST /v3/chats with { from, to: [...], message: { parts: [...] } }
export const createLinqChat = internalAction({
  args: {
    to: v.string(), // E.164 phone number
    body: v.string(),
  },
  handler: async (_ctx, args) => {
    const phoneNumber = process.env.LINQ_PHONE_NUMBER;
    if (!phoneNumber) throw new Error("Missing LINQ_PHONE_NUMBER env var");

    const response = await fetch(`${LINQ_API_BASE}/chats`, {
      method: "POST",
      headers: getLinqHeaders(),
      body: JSON.stringify({
        from: phoneNumber,
        to: [args.to],
        message: {
          parts: [{ type: "text", value: args.body }],
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Linq create chat failed:", response.status, err);
      throw new Error(`Linq API error: ${response.status}`);
    }

    const data = await response.json();
    return { chatId: data.data?.chat?.id || data.data?.id || data.id };
  },
});

// Start typing indicator — POST /v3/chats/{chatId}/typing
export const startTyping = internalAction({
  args: { chatId: v.string() },
  handler: async (_ctx, args) => {
    await fetch(`${LINQ_API_BASE}/chats/${args.chatId}/typing`, {
      method: "POST",
      headers: getLinqHeaders(),
    });
  },
});

// Stop typing indicator — DELETE /v3/chats/{chatId}/typing
// Note: typing indicators auto-stop when a message is sent
export const stopTyping = internalAction({
  args: { chatId: v.string() },
  handler: async (_ctx, args) => {
    await fetch(`${LINQ_API_BASE}/chats/${args.chatId}/typing`, {
      method: "DELETE",
      headers: getLinqHeaders(),
    });
  },
});
