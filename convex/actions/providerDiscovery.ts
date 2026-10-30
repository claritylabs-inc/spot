"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import {
  clRouterCancelDiscovery,
  clRouterCapabilities,
  clRouterCreateDiscovery,
  type ClRouterDiscoveryGenerator,
} from "../lib/clRouterClient";
import { newClientWebMonitorToken } from "../lib/clientWebMonitors";
import {
  NoWriteInputError,
  rethrowNoWriteInput,
} from "../lib/noWriteInputError";
import {
  DEFAULT_PROVIDER_DISCOVERY_MATCH_LIMIT,
  MAX_PROVIDER_DISCOVERY_MATCH_LIMIT,
  PROVIDER_DISCOVERY_CALLBACK_PATH,
  providerDiscoveryInput,
  type ProviderDiscoveryCriteria,
} from "../lib/providerDiscovery";
import { routerDiscoveryConfigured } from "../lib/routerCapabilities";
import { callbackSiteUrl } from "../lib/routerJobClient";
import { getSessionUserId as getAuthUserId } from "../lib/sessionIdentity";
import {
  throwUserFacingError,
  userFacingErrorCodes,
} from "../lib/userFacingErrors";
import { routerJobTokenHash } from "../routerJobs";

type StartedDiscovery = {
  discoveryId: Id<"providerDiscoveries">;
  status: "running";
  criteria: ProviderDiscoveryCriteria;
  matchLimit: number;
  excludedProviders: number;
  note: string;
};

async function assertRouterSupportsDiscovery() {
  const supported = await clRouterCapabilities().then(
    routerDiscoveryConfigured,
    () => false,
  );
  if (!supported)
    throw new NoWriteInputError(
      "provider_discovery_unavailable",
      "Provider discovery is unavailable: the connected cl-router does not advertise a configured discovery provider.",
    );
}

/** Starts a paid router discovery; the raw callback token never leaves this action. */
export async function startProviderDiscovery(
  ctx: ActionCtx,
  args: {
    lines: string[];
    states: string[];
    industry?: string;
    userId: Id<"users">;
    matchLimit?: number;
    generator?: ClRouterDiscoveryGenerator;
  },
): Promise<StartedDiscovery> {
  const matchLimit = args.matchLimit ?? DEFAULT_PROVIDER_DISCOVERY_MATCH_LIMIT;
  if (
    !Number.isInteger(matchLimit) ||
    matchLimit < 5 ||
    matchLimit > MAX_PROVIDER_DISCOVERY_MATCH_LIMIT
  )
    throw new NoWriteInputError(
      "invalid_match_limit",
      `matchLimit must be a whole number from 5 to ${MAX_PROVIDER_DISCOVERY_MATCH_LIMIT}.`,
    );
  await assertRouterSupportsDiscovery();
  const token = newClientWebMonitorToken();
  const pending = await ctx
    .runMutation(internal.providerDiscovery.beginInternal, {
      userId: args.userId,
      tokenHash: await routerJobTokenHash(token),
      matchLimit,
      lines: args.lines,
      states: args.states,
      ...(args.industry ? { industry: args.industry } : {}),
    })
    .catch(rethrowNoWriteInput);
  let routerDiscoveryId: string | undefined;
  try {
    const created = await clRouterCreateDiscovery({
      input: providerDiscoveryInput(pending.criteria, {
        matchLimit,
        generator: args.generator ?? "core",
        exclude: pending.exclude,
      }),
      callbackUrl: `${callbackSiteUrl()}${PROVIDER_DISCOVERY_CALLBACK_PATH}?token=${token}`,
    });
    routerDiscoveryId = created.discoveryId;
    if (created.status !== "queued" && created.status !== "running")
      throw new Error("Discovery is not running");
    if (
      !(await ctx.runMutation(internal.providerDiscovery.markRunningInternal, {
        discoveryId: pending.discoveryId,
        routerDiscoveryId,
      }))
    )
      throw new Error("Discovery row is no longer pending");
  } catch {
    // Stop a paid run Spot will no longer accept results for.
    if (routerDiscoveryId)
      await clRouterCancelDiscovery(routerDiscoveryId).catch(() => undefined);
    await ctx.runMutation(internal.providerDiscovery.markFailedInternal, {
      discoveryId: pending.discoveryId,
      error: "The router could not start the discovery.",
    });
    throw new Error(
      "The provider discovery could not be started: the router did not accept it.",
    );
  }
  return {
    discoveryId: pending.discoveryId,
    status: "running",
    criteria: pending.criteria,
    matchLimit,
    excludedProviders: pending.exclude.length,
    note: "The discovery is running at the provider and can take many minutes; candidates arrive later. It is not complete: read list_provider_candidates for its status and results.",
  };
}

/** Watchdog for a discovery whose results never arrived. */
export const expireRunningInternal = internalAction({
  args: { discoveryId: v.id("providerDiscoveries") },
  handler: async (ctx, args) => {
    const routerDiscoveryId: string | null = await ctx.runMutation(
      internal.providerDiscovery.expireInternal,
      { discoveryId: args.discoveryId, status: "running" },
    );
    // Best effort: the run has usually ended already.
    if (routerDiscoveryId)
      await clRouterCancelDiscovery(routerDiscoveryId).catch(() => undefined);
  },
});

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
  args: {
    lines: v.array(v.string()),
    states: v.array(v.string()),
    industry: v.optional(v.string()),
    matchLimit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    discoveryId: Id<"providerDiscoveries">;
    status: "running";
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throwUserFacingError(userFacingErrorCodes.authRequired);
    await ctx.runQuery(
      internal.providerDiscovery.authorizeOperatorStartInternal,
      { userId },
    );
    const { discoveryId, status } = await forOperatorUi(
      startProviderDiscovery(ctx, { ...args, userId }),
    );
    return { discoveryId, status };
  },
});
