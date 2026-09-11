"use node";

import dayjs from "dayjs";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DIRECT_MODEL_PROVIDERS } from "@claritylabs/cl-router-policy";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const REQUEST_TIMEOUT_MS = 15_000;
const SPOT_ROUTER_TENANT_ID = "glass";
const ROUTER_MODEL_PROVIDERS = new Set<string>(DIRECT_MODEL_PROVIDERS);
const ROUTER_WEB_RETRIEVAL_PROVIDERS = new Set([
  "parallel",
  "exa",
  "openai",
  "google",
  "anthropic",
  "xai",
]);

function configuredEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function routerUrl() {
  return configuredEnv(process.env.CL_ROUTER_URL)?.replace(/\/+$/, "");
}

async function fetchJson(
  url: string,
  options: {
    secret?: string;
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<{ data: unknown | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.secret
          ? { Authorization: `Bearer ${options.secret}` }
          : {}),
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).trim();
      return {
        data: null,
        error: `HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
      };
    }
    return { data: await response.json(), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseConfiguredProviders(
  value: unknown,
  supported: ReadonlySet<string>,
) {
  if (!Array.isArray(value)) return null;
  const providers: Array<{ provider: string; configured: boolean }> = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.provider !== "string" ||
      !supported.has(item.provider) ||
      typeof item.configured !== "boolean"
    ) {
      return null;
    }
    providers.push({
      provider: item.provider,
      configured: item.configured,
    });
  }
  return providers;
}

export function parseRouterCapabilities(value: unknown) {
  if (
    !isRecord(value) ||
    value.apiVersion !== "v1" ||
    value.credentialMode !== "router" ||
    !isRecord(value.webRetrieval)
  ) {
    return null;
  }
  const providers = parseConfiguredProviders(
    value.providers,
    ROUTER_MODEL_PROVIDERS,
  );
  const webRetrievalProviders = parseConfiguredProviders(
    value.webRetrieval.providers,
    ROUTER_WEB_RETRIEVAL_PROVIDERS,
  );
  if (!providers || !webRetrievalProviders) return null;
  return {
    apiVersion: "v1" as const,
    credentialMode: "router" as const,
    providers,
    webRetrieval: { providers: webRetrievalProviders },
  };
}

function routerControlAvailability(
  health: unknown,
  adminSecret: string | undefined,
) {
  if (!adminSecret) {
    return {
      available: false,
      error: "CL_ROUTER_ADMIN_SECRET is not configured",
    };
  }
  if (!isRecord(health)) {
    return { available: false, error: "Router health is unavailable" };
  }
  if (health.status !== "ok" || health.database !== true) {
    return { available: false, error: "Router health is degraded" };
  }

  return { available: true, error: null };
}

function parseFreezeResponse(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.frozen !== "boolean" ||
    typeof value.policyVersion !== "string" ||
    typeof value.controlVersion !== "string"
  ) {
    throw new Error("cl-router returned an invalid freeze response");
  }
  return {
    frozen: value.frozen,
    policyVersion: value.policyVersion,
    controlVersion: value.controlVersion,
  };
}

export const getDashboard = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId,
    });

    const url = routerUrl();
    const adminSecret = configuredEnv(process.env.CL_ROUTER_ADMIN_SECRET);
    if (!url) {
      return {
        configured: false,
        fetchedAt: dayjs().valueOf(),
        health: { data: null, error: "CL_ROUTER_URL is not configured" },
        policy: { data: null, error: "CL_ROUTER_URL is not configured" },
        rollups: { data: null, error: "CL_ROUTER_URL is not configured" },
        controls: {
          available: false,
          error: "CL_ROUTER_URL is not configured",
        },
      };
    }

    const [health, policy, rollups] = await Promise.all([
      fetchJson(`${url}/health`),
      adminSecret
        ? fetchJson(`${url}/admin/policy?tenantId=${SPOT_ROUTER_TENANT_ID}`, {
            secret: adminSecret,
          })
        : Promise.resolve({
            data: null,
            error: "CL_ROUTER_ADMIN_SECRET is not configured",
          }),
      adminSecret
        ? fetchJson(`${url}/admin/rollups?tenantId=${SPOT_ROUTER_TENANT_ID}`, {
            secret: adminSecret,
          })
        : Promise.resolve({
            data: null,
            error: "CL_ROUTER_ADMIN_SECRET is not configured",
          }),
    ]);

    return {
      configured: true,
      fetchedAt: dayjs().valueOf(),
      health,
      policy,
      rollups,
      controls: routerControlAvailability(health.data, adminSecret),
    };
  },
});

export const getCapabilities = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId,
    });

    const fetchedAt = dayjs().valueOf();
    const url = routerUrl();
    const secret = configuredEnv(process.env.CL_ROUTER_SECRET);
    if (!url || !secret) {
      return {
        availability: "unavailable" as const,
        fetchedAt,
        message: "Router inference is not configured for this deployment.",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${url}/v1/capabilities`, {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          availability: "unavailable" as const,
          fetchedAt,
          message: `Router capabilities are temporarily unavailable (HTTP ${response.status}).`,
        };
      }
      const capabilities = parseRouterCapabilities(await response.json());
      if (!capabilities) {
        return {
          availability: "unavailable" as const,
          fetchedAt,
          message: "Router returned an invalid capabilities response.",
        };
      }
      return {
        availability: "available" as const,
        fetchedAt,
        ...capabilities,
      };
    } catch {
      return {
        availability: "unavailable" as const,
        fetchedAt,
        message: "Router capabilities are temporarily unavailable.",
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});

export const setGlobalFreeze = action({
  args: { frozen: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internal.operator.requireOperatorForUserInternal, {
      userId,
    });

    const url = routerUrl();
    if (!url) throw new Error("CL_ROUTER_URL is not configured");
    const adminSecret = configuredEnv(process.env.CL_ROUTER_ADMIN_SECRET);

    const healthBefore = await fetchJson(`${url}/health`);
    if (healthBefore.error) {
      throw new Error(
        `Could not verify cl-router health: ${healthBefore.error}`,
      );
    }
    const availability = routerControlAvailability(
      healthBefore.data,
      adminSecret,
    );
    if (!availability.available) {
      throw new Error(availability.error ?? "Router controls are unavailable");
    }

    const reason = `Spot operator ${String(userId)} ${
      args.frozen ? "enabled" : "disabled"
    } the global routing freeze`;
    const result = await fetchJson(`${url}/admin/freeze`, {
      secret: adminSecret,
      method: "POST",
      body: {
        tenantId: SPOT_ROUTER_TENANT_ID,
        frozen: args.frozen,
        reason,
      },
    });
    if (result.error) {
      throw new Error(`cl-router rejected the freeze change: ${result.error}`);
    }
    const freeze = parseFreezeResponse(result.data);
    if (freeze.frozen !== args.frozen) {
      throw new Error("cl-router did not apply the requested freeze state");
    }

    const healthAfter = await fetchJson(`${url}/health`);
    if (healthAfter.error || !isRecord(healthAfter.data)) {
      throw new Error(
        `cl-router accepted the change, but health verification failed${
          healthAfter.error ? `: ${healthAfter.error}` : ""
        }`,
      );
    }
    if (healthAfter.data.frozen !== args.frozen) {
      throw new Error(
        args.frozen
          ? "cl-router accepted the freeze but did not report the new state"
          : "cl-router remains frozen. Remove the CL_ROUTER_FROZEN environment panic switch before using the operator control",
      );
    }

    return freeze;
  },
});
