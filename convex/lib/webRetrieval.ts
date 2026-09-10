"use node";

import { isIP } from "node:net";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_DEFAULT_ROUTES,
  isNativeWebRetrievalProvider,
  isWebRetrievalApiProvider,
  type ModelRoute,
  type NativeWebRetrievalProvider,
  type WebRetrievalProvider,
  type WebRetrievalRoute,
} from "./modelCatalog";

const MAX_QUERY_LENGTH = 500;
const MAX_GOAL_LENGTH = 500;
const MAX_OUTPUT_CHARS = 12_000;
const MAX_SOURCE_COUNT = 5;
const USER_AGENT = "Mozilla/5.0 (compatible; SpotBot/1.0)";

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
  provider: WebRetrievalProvider | "raw_html";
  attempts: Array<{ provider: WebRetrievalProvider | "raw_html"; ok: boolean; error?: string }>;
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

type ProviderResult = {
  text: string;
  sources: WebRetrievalSource[];
};

type ParallelResult = {
  url?: string;
  title?: string;
  excerpts?: string[];
  full_content?: string;
};

function hasProviderAccess(
  provider: NativeWebRetrievalProvider,
  providerKey?: string,
) {
  if (providerKey) return true;
  switch (provider) {
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "google":
      return !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY);
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "xai":
      return !!process.env.XAI_API_KEY;
  }
}

function normalizeRoute(config: WebRetrievalRoute | undefined): WebRetrievalRoute {
  if (!config) return WEB_RETRIEVAL_DEFAULT;
  if (isWebRetrievalApiProvider(config.primary)) return { primary: config.primary };
  return { primary: "model_default" };
}

function normalizeAnthropicModel(model: string) {
  if (model === "claude-3-haiku") return "claude-3-haiku-20240307";
  return model.replace(/\.(\d+)/g, "-$1");
}

function isPrivateIPv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
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
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only public http(s) URLs can be retrieved");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Local and metadata URLs cannot be retrieved");
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && isPrivateIPv4(hostname)) {
    throw new Error("Private network URLs cannot be retrieved");
  }
  if (ipVersion === 6 && isPrivateIPv6(hostname)) {
    throw new Error("Private network URLs cannot be retrieved");
  }
  return parsed.toString();
}

function normalizeInput(input: WebRetrievalInput): NormalizedInput {
  const query = input.query?.trim().slice(0, MAX_QUERY_LENGTH) || undefined;
  const url = normalizePublicUrl(input.url);
  if (!query && !url) throw new Error("Provide either a public URL or a search query");
  const allowedDomains = (input.allowedDomains ?? [])
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_SOURCE_COUNT);
  return {
    query,
    url,
    goal: input.goal?.trim().slice(0, MAX_GOAL_LENGTH) || undefined,
    allowedDomains,
    maxResults: Math.min(Math.max(input.maxResults ?? 5, 1), MAX_SOURCE_COUNT),
  };
}

function truncateText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_OUTPUT_CHARS);
}

function normalizeSources(sources: WebRetrievalSource[]) {
  const seen = new Set<string>();
  return sources
    .filter((source) => {
      if (!source.url || seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    })
    .slice(0, MAX_SOURCE_COUNT);
}

async function fetchRawHtml(url: string): Promise<ProviderResult | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) return null;
  let html = await response.text();
  html = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
  const text = truncateText(html);
  if (text.length < 200) return null;
  return { text, sources: [{ url }] };
}

async function retrieveWithExa(input: NormalizedInput): Promise<ProviderResult | null> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return null;

  if (input.url) {
    const response = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        urls: [input.url],
        text: { maxCharacters: MAX_OUTPUT_CHARS },
        maxAgeHours: 0,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      results?: Array<{ text?: string; title?: string; url?: string }>;
    };
    const first = data.results?.[0];
    if (!first?.text) return null;
    return {
      text: truncateText([first.title, first.text].filter(Boolean).join("\n\n")),
      sources: [{ title: first.title, url: first.url ?? input.url }],
    };
  }

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: [input.query, input.goal].filter(Boolean).join("\n"),
      numResults: input.maxResults,
      includeDomains: input.allowedDomains.length ? input.allowedDomains : undefined,
      contents: { text: { maxCharacters: Math.floor(MAX_OUTPUT_CHARS / input.maxResults) } },
      maxAgeHours: 0,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    results?: Array<{ text?: string; title?: string; url?: string; id?: string }>;
  };
  const results = data.results ?? [];
  const blocks = results
    .filter((result) => result.text)
    .map((result) => [result.title, result.url, result.text].filter(Boolean).join("\n"))
    .join("\n\n---\n\n");
  if (!blocks) return null;
  return {
    text: truncateText(blocks),
    sources: normalizeSources(
      results.flatMap((result) =>
        result.url ? [{ title: result.title, url: result.url }] : [],
      ),
    ),
  };
}

function parallelResultContent(result: ParallelResult) {
  return result.excerpts?.filter(Boolean).join("\n\n") || result.full_content;
}

function parallelResultSnippet(result: ParallelResult) {
  const content = parallelResultContent(result);
  return content ? truncateText(content).slice(0, 2_400) : undefined;
}

async function retrieveWithParallel(
  input: NormalizedInput,
): Promise<ProviderResult | null> {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) return null;

  if (input.url) {
    const response = await fetch("https://api.parallel.ai/v1/extract", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        urls: [input.url],
        objective: input.goal ?? `Retrieve the public content at ${input.url}`,
        max_chars_total: MAX_OUTPUT_CHARS,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { results?: ParallelResult[] };
    const first = data.results?.[0];
    const content = first ? parallelResultContent(first) : undefined;
    if (!first || !content) return null;
    return {
      text: truncateText([first.title, content].filter(Boolean).join("\n\n")),
      sources: [{
        title: first.title,
        url: first.url ?? input.url,
        snippet: parallelResultSnippet(first),
      }],
    };
  }

  const query = input.query;
  if (!query) return null;
  const response = await fetch("https://api.parallel.ai/v1/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      objective: [query, input.goal].filter(Boolean).join("\n"),
      search_queries: [query],
      mode: "advanced",
      max_chars_total: MAX_OUTPUT_CHARS,
      advanced_settings: input.allowedDomains.length
        ? {
            source_policy: {
              include_domains: input.allowedDomains,
            },
          }
        : undefined,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { results?: ParallelResult[] };
  const results = (data.results ?? []).slice(0, input.maxResults);
  const blocks = results
    .flatMap((result) => {
      const content = parallelResultContent(result);
      return content
        ? [[result.title, result.url, content].filter(Boolean).join("\n")]
        : [];
    })
    .join("\n\n---\n\n");
  if (!blocks) return null;
  return {
    text: truncateText(blocks),
    sources: normalizeSources(
      results.flatMap((result) =>
        result.url
          ? [{
              title: result.title,
              url: result.url,
              snippet: parallelResultSnippet(result),
            }]
          : [],
      ),
    ),
  };
}

function nativePrompt(input: NormalizedInput, provider: NativeWebRetrievalProvider) {
  const target = input.url
    ? `Retrieve and summarize this public URL: ${input.url}`
    : `Search the public web for: ${input.query}`;
  return [
    target,
    input.goal ? `Goal: ${input.goal}` : null,
    input.allowedDomains.length
      ? `Restrict sources to these domains when possible: ${input.allowedDomains.join(", ")}`
      : null,
    `Use ${provider}'s native web retrieval. Return concise source-grounded facts and include source URLs.`,
    "Do not use private user data. If the web retrieval cannot find useful public evidence, say so plainly.",
  ].filter(Boolean).join("\n");
}

function providerModel(
  provider: NativeWebRetrievalProvider,
  route: ModelRoute,
  providerKey?: string,
) {
  const options = providerKey ? { apiKey: providerKey } : undefined;
  switch (provider) {
    case "openai":
      return createOpenAI(options)(route.model);
    case "google":
      return createGoogleGenerativeAI(options)(route.model);
    case "anthropic":
      return createAnthropic(options)(normalizeAnthropicModel(route.model));
    case "xai":
      return createXai(options).responses(route.model);
  }
}

function providerTools(
  provider: NativeWebRetrievalProvider,
  input: NormalizedInput,
  providerKey?: string,
): Record<string, unknown> {
  const options = providerKey ? { apiKey: providerKey } : undefined;
  switch (provider) {
    case "openai": {
      const openai = createOpenAI(options);
      return {
        web_search: openai.tools.webSearch({
          externalWebAccess: true,
          searchContextSize: "medium",
          filters: input.allowedDomains.length
            ? { allowedDomains: input.allowedDomains }
            : undefined,
        }),
      };
    }
    case "google": {
      const google = createGoogleGenerativeAI(options);
      return input.url
        ? {
            google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
            url_context: google.tools.urlContext({}),
          }
        : {
            google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
          };
    }
    case "anthropic": {
      const anthropic = createAnthropic(options);
      return input.url
        ? { web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 1 }) }
        : {
            web_search: anthropic.tools.webSearch_20250305({
              maxUses: 3,
              allowedDomains: input.allowedDomains.length ? input.allowedDomains : undefined,
            }),
          };
    }
    case "xai": {
      const xai = createXai(options);
      return {
        web_search: xai.tools.webSearch({
          allowedDomains: input.allowedDomains.length ? input.allowedDomains : undefined,
        }),
      };
    }
  }
}

async function retrieveWithNativeProvider(
  provider: NativeWebRetrievalProvider,
  route: ModelRoute,
  input: NormalizedInput,
  providerKey?: string,
): Promise<ProviderResult | null> {
  if (!hasProviderAccess(provider, providerKey)) return null;
  const result = await generateText({
    model: providerModel(provider, route, providerKey),
    maxOutputTokens: 2048,
    prompt: nativePrompt(input, provider),
    tools: providerTools(provider, input, providerKey) as any,
  });
  const text = truncateText(result.text);
  if (!text) return null;
  const sources = normalizeSources(
    (result.sources ?? []).flatMap((source) => {
      const item = source as { sourceType?: string; type?: string; url?: string; title?: string };
      if ((item.sourceType === "url" || item.type === "url") && item.url) {
        return [{ url: item.url, title: item.title }];
      }
      return [];
    }),
  );
  return {
    text,
    sources: sources.length ? sources : input.url ? [{ url: input.url }] : [],
  };
}

async function attemptProvider(
  provider: WebRetrievalProvider,
  route: ModelRoute | undefined,
  input: NormalizedInput,
  providerKey?: string,
) {
  if (provider === "parallel") return await retrieveWithParallel(input);
  if (provider === "exa") return await retrieveWithExa(input);
  if (provider === "model_default") {
    if (!route || !isNativeWebRetrievalProvider(route.provider)) return null;
    return await retrieveWithNativeProvider(
      route.provider,
      route,
      input,
      providerKey,
    );
  }
  const effectiveRoute = route ?? WEB_RETRIEVAL_DEFAULT_ROUTES[provider];
  return await retrieveWithNativeProvider(provider, effectiveRoute, input);
}

type ResolvedWebRetrievalRoute = WebRetrievalRoute & {
  providerKey?: string;
};

export async function resolveWebRetrievalForOrg(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
): Promise<ResolvedWebRetrievalRoute> {
  const settings = await ctx.runQuery(internal.modelSettings.resolveForOrg, { orgId });
  const config = normalizeRoute(settings?.webRetrieval);
  if (config.primary !== "model_default") return config;

  const route = settings?.routes.chat;
  const providerKey =
    route && isNativeWebRetrievalProvider(route.provider)
      ? settings?.providerKeys?.[route.provider]
      : undefined;
  return { ...config, route, providerKey };
}

export async function runWebRetrieval(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  rawInput: WebRetrievalInput,
): Promise<WebRetrievalResult> {
  const config = await resolveWebRetrievalForOrg(ctx, orgId);
  return runWebRetrievalWithConfig(config, rawInput);
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
): Promise<WebRetrievalResult> {
  const input = normalizeInput(rawInput);
  const attempts: WebRetrievalResult["attempts"] = [];
  const fallbackProviders: Array<{
    provider: WebRetrievalProvider;
    route?: ModelRoute;
    providerKey?: string;
  }> = [
    {
      provider: config.primary,
      route: config.route,
      providerKey: config.providerKey,
    },
  ];

  for (const provider of ["parallel", "exa"] as const) {
    if (provider !== config.primary) fallbackProviders.push({ provider });
  }

  for (const fallback of fallbackProviders) {
    try {
      const result = await attemptProvider(
        fallback.provider,
        fallback.route,
        input,
        fallback.providerKey,
      );
      if (result?.text) {
        attempts.push({ provider: fallback.provider, ok: true });
        return {
          provider: fallback.provider,
          attempts,
          text: result.text,
          sources: normalizeSources(result.sources),
        };
      }
      attempts.push({ provider: fallback.provider, ok: false, error: "No useful content" });
    } catch (error) {
      attempts.push({
        provider: fallback.provider,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (input.url) {
    try {
      const result = await fetchRawHtml(input.url);
      if (result?.text) {
        attempts.push({ provider: "raw_html", ok: true });
        return {
          provider: "raw_html",
          attempts,
          text: result.text,
          sources: result.sources,
          warnings: ["Used raw HTML fallback."],
        };
      }
      attempts.push({ provider: "raw_html", ok: false, error: "No useful content" });
    } catch (error) {
      attempts.push({
        provider: "raw_html",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    provider: config.primary,
    attempts,
    text: "",
    sources: [],
    warnings: ["No configured web retrieval provider returned useful content."],
  };
}
