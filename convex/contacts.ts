import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Get all contacts for a user, sorted by most recently used. */
export const getByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return contacts.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  },
});

/** Find a contact by email for a specific user. */
export const findByEmail = internalQuery({
  args: {
    userId: v.id("users"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contacts")
      .withIndex("by_user_email", (q) =>
        q.eq("userId", args.userId).eq("email", args.email.toLowerCase())
      )
      .first();
  },
});

/** Search contacts by name (case-insensitive substring match). */
export const searchByName = internalQuery({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const query = args.name.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.label && c.label.toLowerCase().includes(query))
    );
  },
});

/**
 * Save or update a contact. If a contact with the same email already exists
 * for this user, update the name/label and lastUsedAt. Otherwise create new.
 */
export const upsert = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    email: v.string(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const emailLower = args.email.toLowerCase();
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_user_email", (q) =>
        q.eq("userId", args.userId).eq("email", emailLower)
      )
      .first();

    if (existing) {
      // Update name if a real name was provided (not just the email)
      const patch: any = { lastUsedAt: Date.now() };
      if (args.name && args.name !== emailLower && args.name !== existing.name) {
        patch.name = args.name;
      }
      if (args.label && args.label !== existing.label) {
        patch.label = args.label;
      }
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("contacts", {
      userId: args.userId,
      name: args.name,
      email: emailLower,
      label: args.label,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

/** Delete a contact. */
export const remove = internalMutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.contactId);
  },
});
