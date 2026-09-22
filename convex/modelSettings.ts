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
  CONFIGURABLE_MODEL_PROVIDERS,
  MODEL_ROUTE_DESCRIPTIONS,
  MODEL_ROUTE_IDS,
  MODEL_ROUTE_LABELS,
  MODEL_TASKS,
  OPERATOR_MODEL_ROUTE_GROUPS,
  OPERATOR_AGENT_MODEL_ROUTE_ID,
  OPERATOR_WEB_RETRIEVAL_PROVIDERS,
  PROVIDER_LABELS,
  WEB_RETRIEVAL_DEFAULT,
  WEB_RETRIEVAL_LABELS,
  isConfigurableModelProvider,
  isRetiredModelRoute,
  type ModelRoute,
  type ModelRouteId,
  type ModelTask,
  type WebRetrievalRoute,
} from "./lib/modelCatalog";
import {
  routerModelSupportsTask,
  type RouterModelEntry,
} from "./lib/routerCapabilities";

type GlobalRoutes = Partial<Record<ModelRouteId, ModelRoute>>;

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
});

function isModelRouteId(value: string): value is ModelRouteId {
  return (MODEL_ROUTE_IDS as string[]).includes(value);
}

function assertSupportedRoute(
  routeId: ModelRouteId,
  route: ModelRoute,
  models: RouterModelEntry[] | null,
) {
  if (isRetiredModelRoute(route)) {
    throw new Error(`Retired model ${route.model} is no longer selectable`);
  }
  if (!isConfigurableModelProvider(route.provider) || route.model.length === 0) {
    throw new Error(
      `${PROVIDER_LABELS[route.provider] ?? route.provider} model ${route.model} is not available`,
    );
  }
  if (!models) return;
  const entry = models.find(
    (item) => item.provider === route.provider && item.model === route.model,
  );
  if (!entry) {
    throw new Error(
      `${PROVIDER_LABELS[route.provider]} model ${route.model} is not available in the router catalog`,
    );
  }
  if (!routerModelSupportsTask(routeId, entry)) {
    throw new Error(
      routeId === "voice_transcription"
        ? "Voice transcription requires an audio transcription model"
        : routeId === "embeddings"
          ? "Embeddings requires an embedding model"
          : routeId === OPERATOR_AGENT_MODEL_ROUTE_ID || routeId === "chat_vision"
            ? "This route requires an image-capable language model"
            : `${routeId} is not supported by ${route.model}`,
    );
  }
}

function routeStaticallySupported(route: ModelRoute) {
  return (
    !isRetiredModelRoute(route) &&
    isConfigurableModelProvider(route.provider) &&
    route.model.length > 0
  );
}

function nullableGlobalRoutes(routes: GlobalRoutes | undefined) {
  return Object.fromEntries(
    MODEL_ROUTE_IDS.map((id) => {
      const route = routes?.[id];
      return [id, route && routeStaticallySupported(route) ? route : null];
    }),
  ) as Record<ModelRouteId, ModelRoute | null>;
}

/**
 * Only routes an operator explicitly selected are pins. Legacy stored routes
 * without an explicit marker are ignored so cl-router chooses the model.
 */
function explicitGlobalRoutes(
  settings: Doc<"globalModelSettings"> | null,
): GlobalRoutes {
  const storedRoutes = settings?.routes as GlobalRoutes | undefined;
  const explicit = settings?.explicitRouteOverrides ?? [];
  return Object.fromEntries(
    MODEL_ROUTE_IDS.flatMap((id) => {
      const route = storedRoutes?.[id];
      return route && explicit.includes(id) ? [[id, route]] : [];
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
      })),
      tasks: MODEL_ROUTE_IDS.map((id) => ({
        id,
        label: MODEL_ROUTE_LABELS[id],
        description: MODEL_ROUTE_DESCRIPTIONS[id],
        isEmbedding: id === "embeddings",
        isAudio: id === "voice_transcription",
        manualRequired: id === OPERATOR_AGENT_MODEL_ROUTE_ID,
      })),
      groups: OPERATOR_MODEL_ROUTE_GROUPS,
      routes: nullableGlobalRoutes(explicitGlobalRoutes(settings)),
      webRetrieval: normalizeWebRetrieval(settings?.webRetrieval),
      webRetrievalProviders: OPERATOR_WEB_RETRIEVAL_PROVIDERS.map((id) => ({
        id,
        label: WEB_RETRIEVAL_LABELS[id],
      })),
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
      // Mutations cannot fetch the router. When GET /v1/capabilities includes
      // `models`, the operator UI fail-closes against that list. Older routers
      // omit `models`; pins remain unvalidated-but-allowed here and the router
      // rejects unknown /v1/manual routes.
      assertSupportedRoute(task, route, null);
    }

    const now = dayjs().valueOf();
    const routes = explicitGlobalRoutes(existing);
    const explicitRouteOverrides = new Set<string>(Object.keys(routes));
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
    assertSupportedRoute(OPERATOR_AGENT_MODEL_ROUTE_ID, route, null);
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
    return await resolvePublicModelDefaults(ctx);
  },
});

/**
 * Operator-pinned task routes. Unpinned tasks are absent and go to cl-router's
 * automatic primitive routing; pinned tasks are submitted through /v1/manual.
 */
export async function resolvePublicModelDefaults(ctx: QueryCtx) {
  const globalSettings = await ctx.db
    .query("globalModelSettings")
    .withIndex("key", (q) => q.eq("key", "default"))
    .first();
  const globalRoutes = explicitGlobalRoutes(globalSettings);
  const routes: Partial<Record<ModelTask, ModelRoute>> = {};
  const routeSources: Partial<Record<ModelTask, "global">> = {};
  for (const task of MODEL_TASKS) {
    const route = globalRoutes[task];
    if (
      route &&
      route.provider !== "moonshot" &&
      routeStaticallySupported(route)
    ) {
      routes[task] = route;
      routeSources[task] = "global";
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
