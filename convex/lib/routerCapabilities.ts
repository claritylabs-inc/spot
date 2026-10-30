import type { ModelProvider } from "./modelCatalog";

/**
 * GET /v1/capabilities is the only source of provider and model identifiers.
 * Parsing validates each entry's shape, never membership in a Spot-owned list,
 * so router catalog changes never invalidate the whole response.
 */

export type RouterModelCapabilities = {
  vision: boolean;
  tools: boolean;
  structuredOutput: boolean;
  embedding: boolean;
  audioInput: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  defaultOutputTokens?: number;
  longListOutputTokens?: number;
};

export type RouterModelEntry = {
  provider: ModelProvider;
  model: string;
  primitives: string[];
  configured: boolean;
  capabilities: RouterModelCapabilities;
};

export type RouterProviderLogo = {
  viewBox: string;
  paths: Array<{ d: string; fillRule?: "evenodd" | "nonzero" }>;
};

/**
 * Display fields are optional: older routers omit them and malformed values
 * are dropped, so display metadata never invalidates the catalog.
 */
export type RouterProviderEntry = {
  provider: string;
  configured: boolean;
  label?: string;
  brandColor?: string;
  monogram?: string;
  logo?: RouterProviderLogo | null;
};

export type RouterCapabilities = {
  apiVersion: "v1";
  credentialMode: "router";
  providers: RouterProviderEntry[];
  models?: RouterModelEntry[];
  webRetrieval: { providers: RouterProviderEntry[] };
  /** Structured research providers; older routers omit it and do not support research. */
  research?: { providers: RouterProviderEntry[] };
  /**
   * Optional request fields this router accepts. Older routers omit the list
   * and reject the fields, so callers send a field only when it is listed.
   */
  features?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function parseModelCapabilities(value: unknown): RouterModelCapabilities | null {
  if (
    !isRecord(value) ||
    typeof value.vision !== "boolean" ||
    typeof value.tools !== "boolean" ||
    typeof value.structuredOutput !== "boolean" ||
    typeof value.embedding !== "boolean" ||
    typeof value.audioInput !== "boolean"
  ) {
    return null;
  }
  return {
    vision: value.vision,
    tools: value.tools,
    structuredOutput: value.structuredOutput,
    embedding: value.embedding,
    audioInput: value.audioInput,
    ...(optionalTokenCount(value.maxInputTokens) !== undefined
      ? { maxInputTokens: optionalTokenCount(value.maxInputTokens) }
      : {}),
    ...(optionalTokenCount(value.maxOutputTokens) !== undefined
      ? { maxOutputTokens: optionalTokenCount(value.maxOutputTokens) }
      : {}),
    ...(optionalTokenCount(value.defaultOutputTokens) !== undefined
      ? { defaultOutputTokens: optionalTokenCount(value.defaultOutputTokens) }
      : {}),
    ...(optionalTokenCount(value.longListOutputTokens) !== undefined
      ? { longListOutputTokens: optionalTokenCount(value.longListOutputTokens) }
      : {}),
  };
}

function parseLogo(value: unknown): RouterProviderLogo | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !isIdentifier(value.viewBox) ||
    !Array.isArray(value.paths) ||
    !value.paths.every(
      (path) =>
        isRecord(path) &&
        isIdentifier(path.d) &&
        (path.fillRule === undefined ||
          path.fillRule === "evenodd" ||
          path.fillRule === "nonzero"),
    )
  ) {
    return undefined;
  }
  return {
    viewBox: value.viewBox,
    paths: value.paths.map(({ d, fillRule }) => ({
      d,
      ...(fillRule ? { fillRule } : {}),
    })),
  };
}

function parseProviders(value: unknown): RouterProviderEntry[] | null {
  if (!Array.isArray(value)) return null;
  const providers: RouterProviderEntry[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isIdentifier(item.provider) ||
      typeof item.configured !== "boolean"
    ) {
      return null;
    }
    const logo = parseLogo(item.logo);
    providers.push({
      provider: item.provider,
      configured: item.configured,
      ...(isIdentifier(item.label) ? { label: item.label } : {}),
      ...(isIdentifier(item.brandColor) ? { brandColor: item.brandColor } : {}),
      ...(isIdentifier(item.monogram) ? { monogram: item.monogram } : {}),
      ...(logo !== undefined ? { logo } : {}),
    });
  }
  return providers;
}

/**
 * Parse the optional `models` array. Missing `models` (older router) returns
 * null; a malformed entry returns undefined.
 */
function parseRouterModels(
  value: unknown,
): RouterModelEntry[] | null | undefined {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return undefined;
  const models: RouterModelEntry[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isIdentifier(item.provider) ||
      !isIdentifier(item.model) ||
      !Array.isArray(item.primitives) ||
      item.primitives.length === 0 ||
      !item.primitives.every(isIdentifier) ||
      typeof item.configured !== "boolean"
    ) {
      return undefined;
    }
    const capabilities = parseModelCapabilities(item.capabilities);
    if (!capabilities) return undefined;
    models.push({
      provider: item.provider,
      model: item.model,
      primitives: item.primitives,
      configured: item.configured,
      capabilities,
    });
  }
  return models;
}

/** Returns null when the response is not a valid v1 capabilities payload. */
export function parseRouterCapabilities(
  value: unknown,
): RouterCapabilities | null {
  if (
    !isRecord(value) ||
    value.apiVersion !== "v1" ||
    value.credentialMode !== "router" ||
    !isRecord(value.webRetrieval)
  ) {
    return null;
  }
  const providers = parseProviders(value.providers);
  const webRetrievalProviders = parseProviders(value.webRetrieval.providers);
  const models = parseRouterModels(value.models);
  if (!providers || !webRetrievalProviders || models === undefined) return null;
  // A malformed optional section advertises nothing rather than invalidating the catalog.
  const researchProviders = isRecord(value.research)
    ? parseProviders(value.research.providers)
    : null;
  return {
    apiVersion: "v1",
    credentialMode: "router",
    providers,
    webRetrieval: { providers: webRetrievalProviders },
    ...(models ? { models } : {}),
    ...(researchProviders ? { research: { providers: researchProviders } } : {}),
    // A malformed list advertises nothing rather than invalidating the catalog.
    ...(Array.isArray(value.features) && value.features.every(isIdentifier)
      ? { features: value.features }
      : {}),
  };
}

/** Research runs only when the router advertises a configured research provider. */
export function routerResearchConfigured(
  capabilities: RouterCapabilities,
): boolean {
  return (
    capabilities.research?.providers.some((entry) => entry.configured) ?? false
  );
}
