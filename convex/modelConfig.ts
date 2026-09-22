import { query } from "./_generated/server";
import {
  MODEL_ROUTE_LABELS,
  MODEL_TASKS,
  PROVIDER_LABELS,
} from "./lib/modelCatalog";
import { resolvePublicModelDefaults } from "./modelSettings";

/**
 * Public query exposing the current AI model routing table.
 * Used by the /weather page. No auth required — contains no secrets.
 * Tasks without an operator pin are routed per request by cl-router.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const config = await resolvePublicModelDefaults(ctx);
    return {
      routes: MODEL_TASKS.map((task) => {
        const route = config.routes[task];
        return {
          task,
          taskLabel: MODEL_ROUTE_LABELS[task],
          ...(route
            ? {
                model: route.model,
                provider: route.provider,
                providerLabel: PROVIDER_LABELS[route.provider],
              }
            : {}),
          routing: route ? ("manual" as const) : ("automatic" as const),
        };
      }),
    };
  },
});
