import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { parseScopesFromToken } from "./lib/apiAuth";

const pageArgs = {
  table: v.union(v.literal("oauthAuthCodes"), v.literal("oauthTokens")),
  cursor: v.optional(v.string()),
};
const pageLimits = { numItems: 100, maximumBytesRead: 2 * 1024 * 1024 };

function needsMigration(row: { scope?: string; scopes?: string[] }) {
  return row.scope !== undefined || !row.scopes?.length;
}

export const audit = internalQuery({
  args: pageArgs,
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      ...pageLimits,
      cursor: args.cursor ?? null,
    });
    let conflictingRepresentations = 0;
    for (const row of page.page) {
      if (row.scopes?.length && row.scope !== undefined) {
        const canonical = new Set(parseScopesFromToken(row.scopes));
        const legacy = new Set(parseScopesFromToken(undefined, row.scope));
        if (
          canonical.size !== legacy.size ||
          [...canonical].some((scope) => !legacy.has(scope))
        ) {
          conflictingRepresentations += 1;
        }
      }
    }
    return {
      checked: page.page.length,
      pending: page.page.filter(needsMigration).length,
      conflictingRepresentations,
      isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const migrateBatch = internalMutation({
  args: pageArgs,
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      ...pageLimits,
      cursor: args.cursor ?? null,
    });
    let updated = 0;
    for (const row of page.page) {
      if (!needsMigration(row)) continue;
      await ctx.db.patch(row._id, {
        scopes: parseScopesFromToken(row.scopes, row.scope),
        scope: undefined,
      });
      updated += 1;
    }
    return {
      checked: page.page.length,
      updated,
      isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const verify = internalQuery({
  args: pageArgs,
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({
      ...pageLimits,
      cursor: args.cursor ?? null,
    });
    return {
      checked: page.page.length,
      remaining: page.page.filter(needsMigration).length,
      isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
