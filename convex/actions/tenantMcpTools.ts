"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { buildAgentToolExecutors } from "../lib/agentToolExecutors";
import { resolveTenantMcpToolCall } from "../lib/tenantMcpToolCatalog";

export const execute = internalAction({
  args: {
    orgId: v.id("organizations"),
    userId: v.id("users"),
    name: v.string(),
    input: v.any(),
    canWrite: v.boolean(),
  },
  handler: async (ctx, args) => {
    const call = resolveTenantMcpToolCall(args.name, args.input, args.canWrite);
    if (call.compatibility || !call.sharedName) {
      throw new Error(`Unknown shared tenant tool: ${args.name}`);
    }
    const scope = await ctx.runQuery(internal.lib.agentScope.resolveForAction, {
      orgId: args.orgId,
      userId: args.userId,
      surface: "mcp",
    });
    const tools = buildAgentToolExecutors(ctx, {
      surface: "mcp",
      orgId: args.orgId,
      userId: args.userId,
      scope,
      canWrite: args.canWrite,
      mailboxCoordinator: { routingParentId: crypto.randomUUID() },
      webResearch: true,
    });
    const selected = tools[call.sharedName as keyof typeof tools];
    if (!selected?.execute)
      throw new Error(`Unknown shared tenant tool: ${args.name}`);
    const parsed = (
      selected.inputSchema as { parse: (value: unknown) => unknown }
    ).parse(call.input);
    return selected.execute(parsed as never);
  },
});
