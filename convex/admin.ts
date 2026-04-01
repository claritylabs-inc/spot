import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const deleteUserByPhone = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();
    if (!user) return { deleted: false };

    // Delete messages
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const m of messages) {
      await ctx.db.delete(m._id);
    }

    // Delete policies
    const policies = await ctx.db
      .query("policies")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const p of policies) {
      await ctx.db.delete(p._id);
    }

    // Delete user
    await ctx.db.delete(user._id);
    return { deleted: true, messages: messages.length, policies: policies.length };
  },
});
