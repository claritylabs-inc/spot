"use node";

import dayjs from "dayjs";
import { getAuthUserId } from "@convex-dev/auth/server";
import { DIRECT_MODEL_PROVIDERS } from "@claritylabs/cl-router-policy";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const REQUEST_TIMEOUT_MS = 15_000;
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
