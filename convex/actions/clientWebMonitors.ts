"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
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

/** Starts the client's router monitor; the raw callback token never leaves this action. */
export const create = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    frequency: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    orgId: Id<"organizations">;
    monitorId: Id<"clientWebMonitors">;
    status: "active";
    frequency: string;
  }> => {
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
    } = await ctx.runMutation(
      internal.clientWebMonitors.beginCreateInternal,
      {
        orgId: args.orgId,
        userId: args.userId,
        frequency,
        tokenHash: await routerJobTokenHash(token),
      },
    );
    const website = clientWebMonitorPublicWebsite(pending.website);
    try {
      const created = await clRouterCreateMonitor({
        orgId: args.orgId,
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
    return {
      orgId: args.orgId,
      monitorId: pending.monitorId,
      status: "active",
      frequency,
    };
  },
});

export const cancel = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    orgId: Id<"organizations">;
    monitorId: Id<"clientWebMonitors">;
    status: "cancelled";
  }> => {
    const monitor: {
      monitorId: Id<"clientWebMonitors">;
      routerMonitorId: string;
    } = await ctx.runMutation(
      internal.clientWebMonitors.beginCancelInternal,
      { orgId: args.orgId },
    );
    // A monitor the router no longer knows can't deliver callbacks, so the
    // row is cancelled either way.
    await clRouterCancelMonitor(monitor.routerMonitorId).catch((error) => {
      if (!(error instanceof ClRouterRequestError) || error.status !== 404)
        throw error;
    });
    await ctx.runMutation(internal.clientWebMonitors.markCancelledInternal, {
      monitorId: monitor.monitorId,
    });
    return {
      orgId: args.orgId,
      monitorId: monitor.monitorId,
      status: "cancelled",
    };
  },
});
