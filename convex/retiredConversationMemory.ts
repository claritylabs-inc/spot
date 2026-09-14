import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const PAGE_SIZE = 100;
const PAGE_BYTES = 2 * 1024 * 1024;

export const audit = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("conversationTurns").paginate({
      cursor: args.cursor ?? null,
      numItems: PAGE_SIZE,
      maximumBytesRead: PAGE_BYTES,
    });
    return {
      count: page.page.length,
      complete: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const purgeBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const page = await ctx.db.query("conversationTurns").paginate({
      cursor: null,
      numItems: PAGE_SIZE,
      maximumBytesRead: PAGE_BYTES,
    });
    for (const row of page.page) await ctx.db.delete(row._id);
    return { deleted: page.page.length, complete: page.isDone };
  },
});

export const verify = internalQuery({
  args: {},
  handler: async (ctx) => ({
    complete: (await ctx.db.query("conversationTurns").first()) === null,
  }),
});
