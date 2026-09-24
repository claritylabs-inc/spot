"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { cancelDurableRouterRequest } from "../lib/routerJobClient";

export const cancel = internalAction({
  args: { invocationKey: v.string() },
  handler: (ctx, args) => cancelDurableRouterRequest(ctx, args.invocationKey),
});
