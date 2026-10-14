"use node";

import { action } from "../_generated/server";
import { internal, components } from "../_generated/api";
import { v } from "convex/values";
import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
const limiter = new RateLimiter(components.rateLimiter, {
  intakeStarts: { kind: "token bucket", rate: 5, period: HOUR },
  intakeGlobal: { kind: "token bucket", rate: 500, period: HOUR },
});
export const create = action({
  args: {
    token: v.string(),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args): Promise<{ existingAccount: boolean }> => {
    await limiter.limit(ctx, "intakeStarts", {
      key: args.email.trim().toLowerCase(),
      throws: true,
    });
    await limiter.limit(ctx, "intakeGlobal", { throws: true });
    return ctx.runMutation(internal.requestIntake.createHandoff, args);
  },
});
