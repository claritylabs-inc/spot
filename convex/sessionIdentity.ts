import dayjs from "dayjs";
import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
export const lookup = internalQuery({
  args: {
    userId: v.id("users"),
    sessionId: v.union(v.string(), v.null()),
    allowRestricted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || (user.intakeRestricted && !args.allowRestricted)) return null;
    const sessionId = args.sessionId
      ? ctx.db.normalizeId("authSessions", args.sessionId)
      : null;
    if (sessionId) {
      const session = await ctx.db.get(sessionId);
      if (
        !session ||
        session.userId !== user._id ||
        session.expirationTime <= dayjs().valueOf()
      )
        return null;
    }
    return user._id;
  },
});
