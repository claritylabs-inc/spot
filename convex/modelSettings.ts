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
  WEB_RETRIEVAL_DEFAULT,
  type ModelRoute,
  type ModelRouteId,
  type ModelTask,
  type WebRetrievalRoute,
} from "./lib/modelCatalog";

type GlobalRoutes = Partial<Record<ModelRouteId, ModelRoute>>;

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
 * Reads possibly-legacy stored web-retrieval config. A stored native provider
 * (for example "google", which cl-router no longer offers) and any stored
 * `route` are discarded: `model_default` picks a native provider from live
 * capabilities at call time.
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
    return explicitOperatorAgentRoute(settings);
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
    if (route) {
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

function stripRetiredRouteKeys(routes: Record<string, unknown> | undefined): {
  routes: Record<string, unknown> | undefined;
  strippedCount: number;
} {
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

    const page = await ctx.db.query("brokerModelSettings").paginate({
      numItems: STRIP_RETIRED_ROUTES_BATCH_SIZE,
      cursor: args.cursor ?? null,
    });

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
 * Sets an optional operator pin. Execution validates it against live capabilities.
 */
export const setOperatorAgentRouteInternal = internalMutation({
  args: { provider: v.string(), model: v.string() },
  handler: async (ctx, args) => {
    const route = {
      provider: args.provider.trim(),
      model: args.model.trim(),
    } as ModelRoute;
    if (!route.provider || !route.model)
      throw new Error("Provider and model are required for an explicit pin");
    const settings = await ctx.db
      .query("globalModelSettings")
      .withIndex("key", (q) => q.eq("key", "default"))
      .first();
    const explicit = new Set(settings?.explicitRouteOverrides ?? []);
    explicit.add(OPERATOR_AGENT_MODEL_ROUTE_ID);
    const patch = {
      routes: {
        ...((settings?.routes as GlobalRoutes | undefined) ?? {}),
        [OPERATOR_AGENT_MODEL_ROUTE_ID]: route,
      },
      explicitRouteOverrides: [...explicit],
    };
    if (!settings) {
      const operator = await ctx.db
        .query("operatorProfiles")
        .filter((q) => q.eq(q.field("status"), "active"))
        .first();
      if (!operator)
        throw new Error(
          "An active operator is required to initialize model settings",
        );
      await ctx.db.insert("globalModelSettings", {
        key: "default",
        updatedBy: operator.userId,
        ...patch,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(settings._id, { ...patch, updatedAt: Date.now() });
    }
    return route;
  },
});

/** Clears all global and broker pins, including operator_agent. Page until isDone. */
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

    const page = await ctx.db.query("brokerModelSettings").paginate({
      numItems: CLEAR_OVERRIDES_BATCH_SIZE,
      cursor: args.cursor ?? null,
    });

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
