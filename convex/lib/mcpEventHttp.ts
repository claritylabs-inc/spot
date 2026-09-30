import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import type { McpEventIdentity } from "./mcpEventIdentity";
import { validateMcpEventFilters } from "./mcpEventCatalog";
import { mcpEventSubscriptionIdentity, parseMcpEventRequest } from "./mcpEventProtocol";

export type { McpEventIdentity } from "./mcpEventIdentity";
export const MCP_EVENT_CAPABILITIES = { events: {} };

function invalidParams() {
  return Object.assign(new Error("Invalid MCP Events parameters"), { code: -32602 });
}

export async function handleMcpEventRequest(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation" | "runAction" | "storage">,
  identity: McpEventIdentity,
  method: string,
  params: unknown,
): Promise<unknown | null> {
  if (!["events/list", "events/subscribe", "events/unsubscribe"].includes(method)) return null;
  if (method === "events/list") {
    if (params !== undefined && params !== null && (typeof params !== "object" || Array.isArray(params) || Object.keys(params).some((key) => key !== "_meta"))) throw invalidParams();
    return await ctx.runQuery(internal.mcpEvents.listEventsInternal, { identity });
  }
  let request;
  let filters;
  try {
    request = parseMcpEventRequest(params, method === "events/subscribe" ? "subscribe" : "unsubscribe");
    filters = validateMcpEventFilters(request.name, request.arguments);
  } catch {
    throw invalidParams();
  }
  try {
    if (method === "events/subscribe") return await ctx.runAction(internal.actions.mcpEvents.subscribe, { identity, params });
    const principal = await ctx.runQuery(internal.mcpEvents.authorizeInternal, { identity, filters: {} });
    const id = await mcpEventSubscriptionIdentity({ principalKey: principal.principalKey, name: request.name, arguments: filters, url: new URL(request.delivery.url).toString() });
    return await ctx.runMutation(internal.mcpEvents.unsubscribeInternal, { identity, id });
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "object" && error.data !== null &&
      "code" in error.data && error.data.code === -32015 && "reason" in error.data &&
      typeof error.data.reason === "string" && ["invalid_secret", "invalid_url", "dns_failed", "private_address",
        "network_error", "timeout", "redirect", "request_too_large", "response_too_large", "challenge_failed", "invalid_event"].includes(error.data.reason)) {
      throw Object.assign(new Error("MCP callback verification failed"), {
        code: -32015, data: { kind: "callback", reason: error.data.reason },
      });
    }
    throw Object.assign(new Error("MCP Events request could not be authorized or completed"), { code: -32000 });
  }
}
