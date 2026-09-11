import dayjs from "dayjs";
import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOperator } from "./lib/operatorIdentity";
import {
  AUDIO_TRANSCRIPTION_MODEL_CATALOG,
  CONFIGURABLE_MODEL_PROVIDERS,
  EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID,
  EMBEDDING_MODEL_CATALOG,
  EXTRACTION_QUALITY_MODEL_ROUTE_ID,
  FALLBACK_MODEL_ROUTE_ID,
  LANGUAGE_MODEL_CATALOG,
  MODEL_ROUTE_DESCRIPTIONS,
  MODEL_ROUTE_IDS,
  MODEL_ROUTE_LABELS,
  MODEL_ROUTING,
  MODEL_TASKS,
  MODEL_TASK_LABELS,
  OPERATOR_MODEL_ROUTE_GROUPS,
  OPERATOR_AGENT_MODEL_ROUTE_ID,
  type RouterModelRouteId,
  OPERATOR_WEB_RETRIEVAL_PROVIDERS,
  MODEL_CAPABILITIES,
  PROVIDER_LABELS,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_LABELS,
  directProviderModelForRoute,
  isRetiredModelRoute,
  modelCapabilitiesForRoute,
  modelRouteSupportsTask,
  type ModelProvider,
  type ModelRoute,
  type ModelRouteId,
  type ModelTask,
  type WebRetrievalRoute,
  defaultModelRouteForId,
} from "./lib/modelCatalog";

type GlobalRoutes = Partial<Record<ModelRouteId, ModelRoute>>;
type RouteSource = "global" | "static";

const configurableProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("mistral"),
  v.literal("cohere"),
  v.literal("fireworks"),
  v.literal("deepseek"),
);

const routeValidator = v.object({
  provider: configurableProviderValidator,
  model: v.string(),
});

const routeUpdateValidator = v.union(routeValidator, v.null());

const webRetrievalProviderValidator = v.union(
  v.literal("parallel"),
  v.literal("exa"),
  v.literal("model_default"),
);

const webRetrievalValidator = v.object({
  primary: webRetrievalProviderValidator,
  route: v.optional(routeValidator),
});

const globalRoutesValidator = v.object({
  operator_agent: v.optional(routeUpdateValidator),
  chat: v.optional(routeUpdateValidator),
  chat_vision: v.optional(routeUpdateValidator),
  voice_transcription: v.optional(routeUpdateValidator),
  email_draft: v.optional(routeUpdateValidator),
  email_reply: v.optional(routeUpdateValidator),
  extraction: v.optional(routeUpdateValidator),
  extraction_preview: v.optional(routeUpdateValidator),
  extraction_coverage_recovery: v.optional(routeUpdateValidator),
  classification: v.optional(routeUpdateValidator),
  requirement_extraction: v.optional(routeUpdateValidator),
  org_memory_extraction: v.optional(routeUpdateValidator),
  analysis: v.optional(routeUpdateValidator),
  summary: v.optional(routeUpdateValidator),
  triage: v.optional(routeUpdateValidator),
  email_extraction: v.optional(routeUpdateValidator),
  document_extraction: v.optional(routeUpdateValidator),
  security: v.optional(routeUpdateValidator),
  mailbox_coordinator: v.optional(routeUpdateValidator),
  embeddings: v.optional(routeUpdateValidator),
  extraction_quality: v.optional(routeUpdateValidator),
  extraction_coverage_cleanup: v.optional(routeUpdateValidator),
  fallback: v.optional(routeUpdateValidator),
});

function isModelTask(value: string): value is ModelTask {
  return (MODEL_TASKS as string[]).includes(value);
}

function isModelRouteId(value: string): value is ModelRouteId {
  return (MODEL_ROUTE_IDS as string[]).includes(value);
}

function assertSupportedRoute(routeId: ModelRouteId, route: ModelRoute) {
  if (isRetiredModelRoute(route)) {
    throw new Error(`Retired model ${route.model} is no longer selectable`);
  }
  if (!directProviderModelForRoute(route)) {
    throw new Error(
      `${PROVIDER_LABELS[route.provider]} model ${route.model} is not available in the routing catalog`,
    );
  }
  const models =
    routeId === "embeddings"
      ? EMBEDDING_MODEL_CATALOG[route.provider]
      : routeId === "voice_transcription"
        ? AUDIO_TRANSCRIPTION_MODEL_CATALOG[route.provider]
        : LANGUAGE_MODEL_CATALOG[route.provider];
  if (!models?.includes(route.model)) {
    throw new Error(
      `Unsupported model ${route.model} for ${PROVIDER_LABELS[route.provider]}`,
    );
  }
  if (
    routeId === OPERATOR_AGENT_MODEL_ROUTE_ID &&
    !modelRouteSupportsTask("chat_vision", route)
  ) {
    throw new Error("Operator agent requires an image-capable language model");
  }
  if (isModelTask(routeId) && !modelRouteSupportsTask(routeId, route)) {
    throw new Error(
      routeId === "voice_transcription"
        ? `${MODEL_TASK_LABELS[routeId]} requires an audio transcription model`
        : `${MODEL_TASK_LABELS[routeId]} requires an image-capable model`,
    );
  }
}

function routeStaticallySupported(routeId: ModelRouteId, route: ModelRoute) {
  if (isRetiredModelRoute(route) || !directProviderModelForRoute(route)) {
    return false;
  }
  const models =
    routeId === "embeddings"
      ? EMBEDDING_MODEL_CATALOG[route.provider]
      : routeId === "voice_transcription"
        ? AUDIO_TRANSCRIPTION_MODEL_CATALOG[route.provider]
        : LANGUAGE_MODEL_CATALOG[route.provider];
  if (!models?.includes(route.model)) return false;
  if (
    routeId === OPERATOR_AGENT_MODEL_ROUTE_ID &&
    !modelRouteSupportsTask("chat_vision", route)
  ) {
    return false;
  }
  return !isModelTask(routeId) || modelRouteSupportsTask(routeId, route);
}

function nullableGlobalRoutes(routes: GlobalRoutes | undefined) {
  return Object.fromEntries(
    MODEL_ROUTE_IDS.map((id) => {
      const route = routes?.[id];
      return [id, route && routeStaticallySupported(id, route) ? route : null];
    }),
  ) as Record<ModelRouteId, ModelRoute | null>;
}

function sameRoute(left: ModelRoute | undefined, right: ModelRoute) {
  return left?.provider === right.provider && left.model === right.model;
}

export function isExplicitGlobalRouteOverride(
  id: ModelRouteId,
  route: ModelRoute | undefined,
  explicitRouteOverrides: readonly string[],
) {
  if (!route) return false;
  return (
    explicitRouteOverrides.includes(id) ||
    !sameRoute(route, defaultModelRouteForId(id))
  );
}

function explicitGlobalRoutes(
  settings: Doc<"globalModelSettings"> | null,
): GlobalRoutes {
  const storedRoutes = settings?.routes as GlobalRoutes | undefined;
  return Object.fromEntries(
    MODEL_ROUTE_IDS.flatMap((id) => {
      const route = storedRoutes?.[id];
      return isExplicitGlobalRouteOverride(
        id,
        route,
        settings?.explicitRouteOverrides ?? [],
      )
        ? [[id, route]]
        : [];
    }),
  ) as GlobalRoutes;
}

export function explicitOperatorAgentRoute(
  settings: Doc<"globalModelSettings"> | null,
): ModelRoute | null {
  const route = (settings?.routes as GlobalRoutes | undefined)?.[
    OPERATOR_AGENT_MODEL_ROUTE_ID
  ];
  return route &&
    settings?.explicitRouteOverrides?.includes(OPERATOR_AGENT_MODEL_ROUTE_ID)
    ? route
    : null;
}

function availableLanguageModels(provider: ModelProvider) {
  return (LANGUAGE_MODEL_CATALOG[provider] ?? []).filter((model) =>
    directProviderModelForRoute({ provider, model }),
  );
}

function availableEmbeddingModels(provider: ModelProvider) {
  return (EMBEDDING_MODEL_CATALOG[provider] ?? []).filter((model) =>
    directProviderModelForRoute({ provider, model }),
  );
}

function availableAudioModels(provider: ModelProvider) {
  return (AUDIO_TRANSCRIPTION_MODEL_CATALOG[provider] ?? []).filter((model) =>
    directProviderModelForRoute({ provider, model }),
  );
}

function normalizeWebRetrieval(
  config: WebRetrievalRoute | undefined,
): WebRetrievalRoute {
  if (!config) return WEB_RETRIEVAL_DEFAULT;
  if (
    config.primary === "parallel" ||
    config.primary === "exa" ||
    config.primary === "model_default"
  ) {
    return { primary: config.primary };
  }
  return { primary: "model_default" };
}

function assertSupportedWebRetrieval(config: WebRetrievalRoute) {
  if (config.route) {
    throw new Error(
      `${WEB_RETRIEVAL_LABELS[config.primary]} web retrieval does not use a model override`,
    );
  }
}

function modelCapabilityCatalog() {
  return Object.fromEntries(
    CONFIGURABLE_MODEL_PROVIDERS.flatMap((provider) =>
      [
        ...(LANGUAGE_MODEL_CATALOG[provider] ?? []),
        ...(AUDIO_TRANSCRIPTION_MODEL_CATALOG[provider] ?? []),
        ...(EMBEDDING_MODEL_CATALOG[provider] ?? []),
      ].map((model) => {
        const capabilities = modelCapabilitiesForRoute({ provider, model });
        return [
          `${provider}:${model}`,
          {
            ...capabilities,
            known: Object.prototype.hasOwnProperty.call(
              MODEL_CAPABILITIES,
              model,
            ),
          },
        ];
      }),
    ),
  );
}

export const getGlobal = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const settings = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (q) => q.eq("key", "default"))
      .first();

    return {
      providers: CONFIGURABLE_MODEL_PROVIDERS.map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
        languageModels: availableLanguageModels(id),
        audioModels: availableAudioModels(id),
        embeddingModels: availableEmbeddingModels(id),
      })),
      tasks: MODEL_ROUTE_IDS.map((id) => ({
        id,
        label: MODEL_ROUTE_LABELS[id],
        description: MODEL_ROUTE_DESCRIPTIONS[id],
        isEmbedding: id === "embeddings",
        isAudio: id === "voice_transcription",
        automatedRouting:
          id !== FALLBACK_MODEL_ROUTE_ID &&
          id !== OPERATOR_AGENT_MODEL_ROUTE_ID,
        manualRequired: id === OPERATOR_AGENT_MODEL_ROUTE_ID,
        defaultRoute: defaultModelRouteForId(id),
      })),
      groups: OPERATOR_MODEL_ROUTE_GROUPS,
      routes: nullableGlobalRoutes(explicitGlobalRoutes(settings)),
      webRetrieval: normalizeWebRetrieval(settings?.webRetrieval),
      webRetrievalProviders: OPERATOR_WEB_RETRIEVAL_PROVIDERS.map((id) => ({
        id,
        label: WEB_RETRIEVAL_LABELS[id],
      })),
      modelCapabilities: modelCapabilityCatalog(),
      updatedAt: settings?.updatedAt ?? null,
    };
  },
});

export const updateGlobalRoutes = mutation({
  args: { routes: globalRoutesValidator },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    const existing = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (q) => q.eq("key", "default"))
      .first();

    for (const [task, route] of Object.entries(args.routes)) {
      if (task === OPERATOR_AGENT_MODEL_ROUTE_ID && route === null) {
        throw new Error(
          "Operator agent model selection is required and cannot use automated routing",
        );
      }
      if (!route) continue;
      if (!isModelRouteId(task)) throw new Error(`Unknown model route ${task}`);
      assertSupportedRoute(task, route);
    }

    const now = dayjs().valueOf();
    const routes = { ...(existing?.routes ?? {}) } as GlobalRoutes;
    const explicitRouteOverrides = new Set(
      MODEL_ROUTE_IDS.filter((id) =>
        isExplicitGlobalRouteOverride(
          id,
          routes[id],
          existing?.explicitRouteOverrides ?? [],
        ),
      ),
    );
    for (const [task, route] of Object.entries(args.routes)) {
      if (!isModelRouteId(task)) continue;
      if (route === null) {
        delete routes[task];
        explicitRouteOverrides.delete(task);
      } else if (route) {
        routes[task] = route;
        explicitRouteOverrides.add(task);
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        routes,
        explicitRouteOverrides: [...explicitRouteOverrides],
        updatedBy: operator.userId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("globalModelSettings", {
        key: "default",
        routes,
        explicitRouteOverrides: [...explicitRouteOverrides],
        updatedBy: operator.userId,
        updatedAt: now,
      });
    }
  },
});

export const resolveOperatorAgentRoute = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (q) => q.eq("key", "default"))
      .first();
    const route = explicitOperatorAgentRoute(settings);
    if (!route) {
      throw new Error(
        "Operator agent model is not configured. Select a provider and image-capable model in Operator routing.",
      );
    }
    assertSupportedRoute(OPERATOR_AGENT_MODEL_ROUTE_ID, route);
    return route;
  },
});

export const updateGlobalWebRetrieval = mutation({
  args: { webRetrieval: webRetrievalValidator },
  handler: async (ctx, args) => {
    const operator = await requireOperator(ctx);
    assertSupportedWebRetrieval(args.webRetrieval);

    const existing = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (q) => q.eq("key", "default"))
      .first();
    const now = dayjs().valueOf();
    const webRetrieval = normalizeWebRetrieval(args.webRetrieval);

    if (existing) {
      await ctx.db.patch(existing._id, {
        webRetrieval,
        updatedBy: operator.userId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("globalModelSettings", {
        key: "default",
        webRetrieval,
        updatedBy: operator.userId,
        updatedAt: now,
      });
    }
  },
});

export const resolveForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.orgId))) return null;

    const globalSettings = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (q) => q.eq("key", "default"))
      .first();
    const globalRoutes = explicitGlobalRoutes(globalSettings);
    const routes = {} as Record<RouterModelRouteId, ModelRoute>;
    const routeSources = {} as Record<RouterModelRouteId, RouteSource>;
    for (const task of MODEL_TASKS) {
      const globalRoute = globalRoutes?.[task];
      if (
        globalRoute &&
        globalRoute.provider !== "moonshot" &&
        routeStaticallySupported(task, globalRoute)
      ) {
        routes[task] = globalRoute;
        routeSources[task] = "global";
        continue;
      }
      routes[task] = MODEL_ROUTING[task];
      routeSources[task] = "static";
    }
    for (const routeId of [
      EXTRACTION_QUALITY_MODEL_ROUTE_ID,
      EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID,
      FALLBACK_MODEL_ROUTE_ID,
    ]) {
      const globalRoute = globalRoutes?.[routeId];
      if (
        globalRoute &&
        globalRoute.provider !== "moonshot" &&
        routeStaticallySupported(routeId, globalRoute)
      ) {
        routes[routeId] = globalRoute;
        routeSources[routeId] = "global";
      } else {
        routes[routeId] = defaultModelRouteForId(routeId);
        routeSources[routeId] = "static";
      }
    }

    return {
      routes,
      routeSources,
      webRetrieval: normalizeWebRetrieval(globalSettings?.webRetrieval),
    };
  },
});

export async function resolvePublicModelDefaults(ctx: QueryCtx) {
  const globalSettings = await ctx.db
    .query("globalModelSettings")
    .withIndex("key", (q) => q.eq("key", "default"))
    .first();
  const globalRoutes = explicitGlobalRoutes(globalSettings);
  const routes = {} as Record<RouterModelRouteId, ModelRoute>;
  const routeSources = {} as Record<
    RouterModelRouteId,
    Extract<RouteSource, "global" | "static">
  >;
  for (const task of MODEL_TASKS) {
    const globalRoute = globalRoutes?.[task];
    if (
      globalRoute &&
      globalRoute.provider !== "moonshot" &&
      routeStaticallySupported(task, globalRoute)
    ) {
      routes[task] = globalRoute;
      routeSources[task] = "global";
    } else {
      routes[task] = MODEL_ROUTING[task];
      routeSources[task] = "static";
    }
  }
  for (const routeId of [
    EXTRACTION_QUALITY_MODEL_ROUTE_ID,
    EXTRACTION_COVERAGE_CLEANUP_MODEL_ROUTE_ID,
    FALLBACK_MODEL_ROUTE_ID,
  ]) {
    const globalRoute = globalRoutes?.[routeId];
    if (
      globalRoute &&
      globalRoute.provider !== "moonshot" &&
      routeStaticallySupported(routeId, globalRoute)
    ) {
      routes[routeId] = globalRoute;
      routeSources[routeId] = "global";
    } else {
      routes[routeId] = defaultModelRouteForId(routeId);
      routeSources[routeId] = "static";
    }
  }

  return {
    routes,
    routeSources,
    webRetrieval: normalizeWebRetrieval(globalSettings?.webRetrieval),
  };
}

export const resolvePublicDefaults = internalQuery({
  args: {},
  handler: resolvePublicModelDefaults,
});
