import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { checkSessionUser } from "./lib/sessionIdentity";

export const lookup = internalQuery({
  args: {
    userId: v.id("users"),
    sessionId: v.union(v.string(), v.null()),
    allowRestricted: v.boolean(),
    allowPendingSecondFactor: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await checkSessionUser(ctx, args.userId, args.sessionId, args);
    return user?._id ?? null;
  },
});
