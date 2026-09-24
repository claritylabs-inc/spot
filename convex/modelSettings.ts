import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  MODEL_ROUTE_IDS,
  MODEL_TASKS,
  OPERATOR_AGENT_MODEL_ROUTE_ID,
  PROVIDER_LABELS,
  WEB_RETRIEVAL_DEFAULT,
  isConfigurableModelProvider,
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

function assertSupportedRoute(
  routeId: ModelRouteId,
  route: ModelRoute,
  models: RouterModelEntry[] | null,
) {
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
  return isConfigurableModelProvider(route.provider) && route.model.length > 0;
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

/**
 * Reads possibly-legacy stored web-retrieval config, so the input type is
 * looser than WebRetrievalRoute: stored `route.provider` can still be the
 * retired "moonshot" literal (schema.ts keeps it for old documents). This
 * always discards `route`, so the mismatch never surfaces.
 */
function normalizeWebRetrieval(
  config: { primary: string; route?: unknown } | undefined,
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
        "Operator agent model is not configured. Set the operator_agent route on globalModelSettings.",
      );
    }
    assertSupportedRoute(OPERATOR_AGENT_MODEL_ROUTE_ID, route, null);
    return route;
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
    if (route && routeStaticallySupported(route)) {
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

/**
 * Route keys retired from the catalog (`convex/lib/modelCatalog.ts`) but
 * possibly still present on stored settings rows. Strip them so the schema
 * fields can eventually be narrowed.
 */
const RETIRED_ROUTE_KEYS = [
  "extraction_coverage_recovery",
  "classification",
  "security",
  "extraction_quality",
  "extraction_coverage_cleanup",
  "fallback",
] as const;

const STRIP_RETIRED_ROUTES_BATCH_SIZE = 50;

function stripRetiredRouteKeys(
  routes: Record<string, unknown> | undefined,
): { routes: Record<string, unknown> | undefined; strippedCount: number } {
  if (!routes) return { routes, strippedCount: 0 };
  let strippedCount = 0;
  const next = { ...routes };
  for (const key of RETIRED_ROUTE_KEYS) {
    if (key in next) {
      delete next[key];
      strippedCount += 1;
    }
  }
  return { routes: next, strippedCount };
}

/**
 * Unsets retired route keys on stored `globalModelSettings` /
 * `brokerModelSettings` rows. Bounded and batched: pass the returned
 * `continueCursor` back in until `isDone` to cover every broker row. Not run
 * automatically by this packet.
 */
export const stripRetiredRoutesInternal = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    let globalRowsUpdated = 0;
    let globalKeysStripped = 0;

    if (!args.cursor) {
      const globalSettings = await ctx.db
        .query("globalModelSettings")
        .withIndex("key", (q) => q.eq("key", "default"))
        .first();
      if (globalSettings) {
        const { routes, strippedCount } = stripRetiredRouteKeys(
          globalSettings.routes as Record<string, unknown> | undefined,
        );
        const explicitRouteOverrides = (
          globalSettings.explicitRouteOverrides ?? []
        ).filter(
          (key) => !(RETIRED_ROUTE_KEYS as readonly string[]).includes(key),
        );
        const overridesChanged =
          explicitRouteOverrides.length !==
          (globalSettings.explicitRouteOverrides ?? []).length;
        if (strippedCount > 0 || overridesChanged) {
          await ctx.db.patch(globalSettings._id, {
            routes,
            explicitRouteOverrides,
          });
          globalRowsUpdated = 1;
          globalKeysStripped = strippedCount;
        }
      }
    }

    const page = await ctx.db
      .query("brokerModelSettings")
      .paginate({ numItems: STRIP_RETIRED_ROUTES_BATCH_SIZE, cursor: args.cursor ?? null });

    let brokerRowsUpdated = 0;
    let brokerKeysStripped = 0;
    for (const row of page.page) {
      const { routes, strippedCount } = stripRetiredRouteKeys(
        row.routes as Record<string, unknown> | undefined,
      );
      if (strippedCount > 0) {
        await ctx.db.patch(row._id, { routes });
        brokerRowsUpdated += 1;
        brokerKeysStripped += strippedCount;
      }
    }

    return {
      globalRowsUpdated,
      globalKeysStripped,
      brokerRowsScanned: page.page.length,
      brokerRowsUpdated,
      brokerKeysStripped,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

const CLEAR_OVERRIDES_BATCH_SIZE = 50;

/**
 * Clears every stored operator model-route override: the operator settings
 * UI and its `getGlobal`/`updateGlobalRoutes`/`updateGlobalWebRetrieval`
 * mutations are removed, so `globalModelSettings.routes`,
 * `explicitRouteOverrides`, `webRetrieval`, and `brokerModelSettings.routes`
 * can no longer be edited and are frozen at whatever they last held.
 * Bounded and batched like stripRetiredRoutesInternal: pass the returned
 * `continueCursor` back in until `isDone` to cover every broker row. Not run
 * automatically by this packet.
 */
export const clearOperatorModelOverridesInternal = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    let globalRowCleared = false;

    if (!args.cursor) {
      const globalSettings = await ctx.db
        .query("globalModelSettings")
        .withIndex("key", (q) => q.eq("key", "default"))
        .first();
      if (
        globalSettings &&
        (globalSettings.routes ||
          globalSettings.explicitRouteOverrides?.length ||
          globalSettings.webRetrieval)
      ) {
        await ctx.db.patch(globalSettings._id, {
          routes: undefined,
          explicitRouteOverrides: undefined,
          webRetrieval: undefined,
        });
        globalRowCleared = true;
      }
    }

    const page = await ctx.db
      .query("brokerModelSettings")
      .paginate({ numItems: CLEAR_OVERRIDES_BATCH_SIZE, cursor: args.cursor ?? null });

    let brokerRowsCleared = 0;
    for (const row of page.page) {
      if (row.routes) {
        await ctx.db.patch(row._id, { routes: undefined });
        brokerRowsCleared += 1;
      }
    }

    return {
      globalRowCleared,
      brokerRowsScanned: page.page.length,
      brokerRowsCleared,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
