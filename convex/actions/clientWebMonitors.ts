"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import {
  ClRouterRequestError,
  clRouterCancelMonitor,
  clRouterCapabilities,
  clRouterCreateMonitor,
} from "../lib/clRouterClient";
import {
  CLIENT_WEB_MONITOR_CALLBACK_PATH,
  CLIENT_WEB_MONITOR_FIELDS,
  CLIENT_WEB_MONITOR_QUERY,
  DEFAULT_CLIENT_WEB_MONITOR_FREQUENCY,
  clientWebMonitorPublicWebsite,
  isClientWebMonitorFrequency,
  newClientWebMonitorToken,
} from "../lib/clientWebMonitors";
import { NoWriteInputError } from "../lib/noWriteInputError";
import { getSessionUserId as getAuthUserId } from "../lib/sessionIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";
import { routerSupportsMonitors } from "../lib/routerCapabilities";
import { callbackSiteUrl } from "../lib/routerJobClient";
import { routerJobTokenHash } from "../routerJobs";

async function assertRouterSupportsMonitors() {
  const supported = await clRouterCapabilities().then(
    routerSupportsMonitors,
    () => false,
  );
  if (!supported)
    throw new NoWriteInputError(
      "web_monitoring_unavailable",
      "Web monitoring is unavailable: the connected cl-router does not advertise a configured monitor provider.",
    );
}

type CreatedMonitor = {
  orgId: Id<"organizations">;
  monitorId: Id<"clientWebMonitors">;
  status: "active";
  frequency: string;
};
type CancelledMonitor = {
  orgId: Id<"organizations">;
  monitorId: Id<"clientWebMonitors">;
  status: "cancelled";
};

async function clientOrgId(
  ctx: ActionCtx,
  orgId: string,
): Promise<Id<"organizations">> {
  const normalized = await ctx.runQuery(
    internal.clientWebMonitors.normalizeOrgIdInternal,
    { orgId },
  );
  if (!normalized)
    throw new NoWriteInputError("invalid_identifier", "Invalid organization ID");
  return normalized;
}

/** Starts the client's router monitor; the raw callback token never leaves this action. */
export async function createClientWebMonitor(
  ctx: ActionCtx,
  args: { orgId: string; userId: Id<"users">; frequency?: string },
): Promise<CreatedMonitor> {
  const orgId = await clientOrgId(ctx, args.orgId);
  const frequency = args.frequency ?? DEFAULT_CLIENT_WEB_MONITOR_FREQUENCY;
  if (!isClientWebMonitorFrequency(frequency))
    throw new NoWriteInputError(
      "invalid_frequency",
      "Frequency must be between 1h and 30d, such as 6h, 1d or 1w.",
    );
  await assertRouterSupportsMonitors();
  const token = newClientWebMonitorToken();
  const pending: {
    monitorId: Id<"clientWebMonitors">;
    name: string;
    website?: string;
  } = await ctx.runMutation(internal.clientWebMonitors.beginCreateInternal, {
    orgId,
    userId: args.userId,
    frequency,
    tokenHash: await routerJobTokenHash(token),
  });
  const website = clientWebMonitorPublicWebsite(pending.website);
  try {
    const created = await clRouterCreateMonitor({
      orgId,
      input: {
        entity: { name: pending.name, ...(website ? { website } : {}) },
        query: CLIENT_WEB_MONITOR_QUERY,
        fields: CLIENT_WEB_MONITOR_FIELDS,
        frequency,
      },
      callbackUrl: `${callbackSiteUrl()}${CLIENT_WEB_MONITOR_CALLBACK_PATH}?token=${token}`,
      config: { depth: "fast" },
    });
    if (created.status !== "active") throw new Error("Monitor is not active");
    await ctx.runMutation(internal.clientWebMonitors.markActiveInternal, {
      monitorId: pending.monitorId,
      routerMonitorId: created.monitorId,
    });
  } catch {
    await ctx.runMutation(internal.clientWebMonitors.markFailedInternal, {
      monitorId: pending.monitorId,
      error: "The router could not create the monitor.",
    });
    throw new Error(
      "The web monitor could not be created: the router did not accept it.",
    );
  }
  return { orgId, monitorId: pending.monitorId, status: "active", frequency };
}

export async function cancelClientWebMonitor(
  ctx: ActionCtx,
  args: { orgId: string },
): Promise<CancelledMonitor> {
  const orgId = await clientOrgId(ctx, args.orgId);
  const monitor: {
    monitorId: Id<"clientWebMonitors">;
    routerMonitorId: string;
  } = await ctx.runMutation(internal.clientWebMonitors.beginCancelInternal, {
    orgId,
  });
  // A monitor the router no longer knows can't deliver callbacks, so the row
  // is cancelled either way.
  await clRouterCancelMonitor(monitor.routerMonitorId).catch((error) => {
    if (!(error instanceof ClRouterRequestError) || error.status !== 404)
      throw error;
  });
  await ctx.runMutation(internal.clientWebMonitors.markCancelledInternal, {
    monitorId: monitor.monitorId,
  });
  return { orgId, monitorId: monitor.monitorId, status: "cancelled" };
}

export const create = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    frequency: v.optional(v.string()),
  },
  handler: (ctx, args): Promise<CreatedMonitor> =>
    createClientWebMonitor(ctx, args),
});

export const cancel = internalAction({
  args: { orgId: v.id("organizations") },
  handler: (ctx, args): Promise<CancelledMonitor> =>
    cancelClientWebMonitor(ctx, args),
});

async function authorizeOperator(ctx: ActionCtx, orgId: Id<"organizations">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
  await ctx.runQuery(
    internal.clientWebMonitors.authorizeOperatorWriteInternal,
    { userId, orgId },
  );
  return userId;
}

/** The operator UI shows a ConvexError's string data, not the wrapped stack text. */
async function forOperatorUi<T>(work: Promise<T>) {
  try {
    return await work;
  } catch (error) {
    if (error instanceof NoWriteInputError)
      throw new ConvexError(error.data.message);
    throw error;
  }
}

export const start = action({
  args: { orgId: v.id("organizations"), frequency: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "active"; frequency: string }> => {
    const userId = await authorizeOperator(ctx, args.orgId);
    const { status, frequency } = await forOperatorUi(
      createClientWebMonitor(ctx, { ...args, userId }),
    );
    return { status, frequency };
  },
});

export const stop = action({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args): Promise<{ status: "cancelled" }> => {
    await authorizeOperator(ctx, args.orgId);
    const { status } = await forOperatorUi(cancelClientWebMonitor(ctx, args));
    return { status };
  },
});
