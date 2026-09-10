"use node";

import { isIP } from "node:net";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterRetrieve } from "./clRouterClient";
import {
  WEB_RETRIEVAL_DEFAULT,
  isNativeWebRetrievalProvider,
  isWebRetrievalApiProvider,
  type ModelRoute,
  type WebRetrievalProvider,
  type WebRetrievalRoute,
} from "./modelCatalog";

const MAX_QUERY_LENGTH = 500;
const MAX_GOAL_LENGTH = 500;
const MAX_SOURCE_COUNT = 5;

export type WebRetrievalInput = {
  query?: string;
  url?: string;
  goal?: string;
  allowedDomains?: string[];
  maxResults?: number;
};

export type WebRetrievalSource = {
  title?: string;
  url: string;
  snippet?: string;
};
export type WebRetrievalResult = {
  provider: WebRetrievalProvider;
  attempts: Array<{
    provider: WebRetrievalProvider;
    ok: boolean;
    error?: string;
  }>;
  text: string;
  sources: WebRetrievalSource[];
  warnings?: string[];
};

type NormalizedInput = {
  query?: string;
  url?: string;
  goal?: string;
  allowedDomains: string[];
  maxResults: number;
};
type ResolvedWebRetrievalRoute = WebRetrievalRoute & { route?: ModelRoute };

function normalizeRoute(
  config: WebRetrievalRoute | undefined,
): WebRetrievalRoute {
  if (!config) return WEB_RETRIEVAL_DEFAULT;
  if (isWebRetrievalApiProvider(config.primary))
    return { primary: config.primary };
  return { primary: "model_default" };
}

function isPrivateIPv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isPrivateIPv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized === "::" ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function normalizePublicUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("Only public http(s) URLs can be retrieved");
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Local and metadata URLs cannot be retrieved");
  }
  const ipVersion = isIP(hostname);
  if (
    (ipVersion === 4 && isPrivateIPv4(hostname)) ||
    (ipVersion === 6 && isPrivateIPv6(hostname))
  ) {
    throw new Error("Private network URLs cannot be retrieved");
  }
  return parsed.toString();
}

function normalizeInput(input: WebRetrievalInput): NormalizedInput {
  const query = input.query?.trim().slice(0, MAX_QUERY_LENGTH) || undefined;
  const url = normalizePublicUrl(input.url);
  if (!query && !url)
    throw new Error("Provide either a public URL or a search query");
  return {
    query,
    url,
    goal: input.goal?.trim().slice(0, MAX_GOAL_LENGTH) || undefined,
    allowedDomains: (input.allowedDomains ?? [])
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, MAX_SOURCE_COUNT),
    maxResults: Math.min(Math.max(input.maxResults ?? 5, 1), MAX_SOURCE_COUNT),
  };
}

export async function resolveWebRetrievalForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<ResolvedWebRetrievalRoute> {
  const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, {
    orgId,
  });
  const config = normalizeRoute(settings?.webRetrieval);
  if (config.primary !== "model_default") return config;
  const route = settings?.routes.chat;
  return route && isNativeWebRetrievalProvider(route.provider)
    ? { ...config, route }
    : config;
}

export async function runWebRetrieval(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  rawInput: WebRetrievalInput,
): Promise<WebRetrievalResult> {
  const config = await resolveWebRetrievalForOrg(ctx, orgId);
  return runWebRetrievalWithConfig(config, rawInput, String(orgId));
}

export async function runOperatorWebRetrieval(
  ctx: ActionCtx,
  rawInput: WebRetrievalInput,
): Promise<WebRetrievalResult> {
  const settings = await ctx.runQuery(
    internal.modelSettings.resolvePublicDefaults,
    {},
  );
  const config = normalizeRoute(settings.webRetrieval);
  const route =
    config.primary === "model_default"
      ? await ctx.runQuery(internal.modelSettings.resolveOperatorAgentRoute, {})
      : undefined;
  return runWebRetrievalWithConfig({ ...config, route }, rawInput);
}

async function runWebRetrievalWithConfig(
  config: ResolvedWebRetrievalRoute,
  rawInput: WebRetrievalInput,
  orgId?: string,
): Promise<WebRetrievalResult> {
  const input = normalizeInput(rawInput);
  return clRouterRetrieve({
    ...(orgId ? { orgId } : {}),
    input,
    config: {
      primary: config.primary,
      ...(config.route ? { route: config.route } : {}),
    },
  });
}
