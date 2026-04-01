import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

function generateToken(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let token = "";
  for (let i = 0; i < 24; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

// Phase 1: Claim the webhook lock. This is the ONLY dedup gate.
// Convex mutations are serialized per-document, so two concurrent
// calls writing to the same webhookLocks row will serialize.
export const claimWebhook = internalMutation({
  args: { openPhoneId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookLocks")
      .withIndex("by_openphone_id", (q) =>
        q.eq("openPhoneId", args.openPhoneId)
      )
      .first();
    if (existing) return { claimed: false };

    await ctx.db.insert("webhookLocks", {
      openPhoneId: args.openPhoneId,
      processedAt: Date.now(),
    });
    return { claimed: true };
  },
});

// Phase 2: Find or create user, log message, return routing info.
// Only called after claimWebhook succeeds.
export const ingestMessage = internalMutation({
  args: {
    openPhoneId: v.string(),
    from: v.string(),
    text: v.string(),
    hasAttachment: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Find or create user
    let user = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.from))
      .first();

    let isNewUser = false;
    if (!user) {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        phone: args.from,
        state: "awaiting_category",
        uploadToken: generateToken(),
        lastActiveAt: now,
        createdAt: now,
      });
      user = (await ctx.db.get(userId))!;
      isNewUser = true;
    } else {
      await ctx.db.patch(user._id, { lastActiveAt: Date.now() });
    }

    // Log inbound message
    await ctx.db.insert("messages", {
      userId: user._id,
      direction: "inbound",
      body: args.text,
      hasAttachment: args.hasAttachment,
      openPhoneId: args.openPhoneId,
      timestamp: Date.now(),
    });

    return {
      userId: user._id,
      state: user.state || "active",
      uploadToken: user.uploadToken || "",
      isNewUser,
    };
  },
});
