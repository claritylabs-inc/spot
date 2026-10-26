"use node";

import dayjs from "dayjs";
import { getSessionUserId as getAuthUserId } from "./lib/sessionIdentity";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  ClRouterRequestError,
  clRouterCapabilities,
} from "./lib/clRouterClient";

const REQUEST_TIMEOUT_MS = 15_000;

function unavailableMessage(error: unknown) {
  if (!(error instanceof ClRouterRequestError))
    return "Router capabilities are temporarily unavailable.";
  if (error.kind === "configuration")
    return "Router inference is not configured for this deployment.";
  if (error.kind === "invalid_response")
    return "Router returned an invalid capabilities response.";
  return error.status
    ? `Router capabilities are temporarily unavailable (HTTP ${error.status}).`
    : "Router capabilities are temporarily unavailable.";
}

export const getCapabilities = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId,
    });

    const fetchedAt = dayjs().valueOf();
    try {
      const capabilities = await clRouterCapabilities({
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return {
        availability: "available" as const,
        fetchedAt,
        ...capabilities,
      };
    } catch (error) {
      return {
        availability: "unavailable" as const,
        fetchedAt,
        message: unavailableMessage(error),
      };
    }
  },
});
