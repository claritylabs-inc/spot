"use node";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const sendSms = internalAction({
  args: {
    to: v.string(),
    body: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.OPENPHONE_API_KEY;
    const phoneNumberId = process.env.OPENPHONE_PHONE_NUMBER_ID;

    if (!apiKey || !phoneNumberId) {
      throw new Error("Missing OpenPhone env vars");
    }

    const response = await fetch("https://api.openphone.com/v1/messages", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: phoneNumberId,
        to: [args.to],
        content: args.body,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenPhone send failed:", err);
      throw new Error(`OpenPhone API error: ${response.status}`);
    }

    return await response.json();
  },
});
