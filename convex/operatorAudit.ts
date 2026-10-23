import { v } from "convex/values";
import type { TableNames } from "./_generated/dataModel";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { operatorPeople } from "./lib/operatorAvatar";
import { requireOperator } from "./lib/operatorIdentity";
import { getOperatorAgentToolSpec } from "./lib/operatorAgentToolRegistry";

const MAX_ENTRIES = 500;
const MAX_AGENT_SCAN = 2_000;

// Patches and deletes written as `(id, …)` carry no table; these are the ones worth naming.
const NAMED_TABLES = [
  "organizations",
  "procurementRequests",
  "procurementProposals",
  "procurementFileItems",
  "procurementEmailThreads",
  "teamEmailThreads",
  "policies",
  "clientFiles",
  "brokerProfiles",
  "brokerContacts",
  "operatorAgentThreads",
  "operatorProfiles",
  "users",
] as const satisfies readonly TableNames[];

const sourceValidator = v.union(
  v.literal("console"),
  v.literal("agent"),
  v.literal("mcp"),
);

function humanize(identifier: string) {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function functionTitle(functionName: string) {
  const [module, name] = functionName.split(":");
  return name ? `${humanize(name)} · ${humanize(module)}` : functionName;
}

function agentDetail(row: Doc<"agentActionAuditEvents">) {
  if (!row.input) return null;
  try {
    return getOperatorAgentToolSpec(row.action).summarize(JSON.parse(row.input));
  } catch {
    // Unknown tools and truncated inputs fall back to the tool name alone.
    return null;
  }
}

function tableOf(ctx: QueryCtx, id: string) {
  return NAMED_TABLES.find((table) => ctx.db.normalizeId(table, id)) ?? null;
}

async function* newestAgentRows(
  ctx: QueryCtx,
  operatorUserId: Id<"users"> | undefined,
) {
  const rows = operatorUserId
    ? ctx.db
        .query("agentActionAuditEvents")
        .withIndex("operator_user_created", (q) =>
          q.eq("operatorUserId", operatorUserId),
        )
    : ctx.db
        .query("agentActionAuditEvents")
        .withIndex("actor_kind_created", (q) => q.eq("actorKind", "operator"));
  yield* rows.order("desc");
}

/** Merged feed of operator console writes, recorded events and agent/MCP tool calls. */
export const list = query({
  args: {
    operatorUserId: v.optional(v.id("users")),
    source: v.optional(sourceValidator),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOperator(ctx);
    const limit = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(args.limit)));

    const consoleRows =
      args.source === undefined || args.source === "console"
        ? await (args.operatorUserId
            ? ctx.db
                .query("operatorAuditEvents")
                .withIndex("operator_created", (q) =>
                  q.eq("operatorUserId", args.operatorUserId),
                )
            : ctx.db.query("operatorAuditEvents")
          )
            .order("desc")
            .take(limit)
        : [];

    const agentRows: Doc<"agentActionAuditEvents">[] = [];
    if (args.source !== "console") {
      let scanned = 0;
      for await (const row of newestAgentRows(ctx, args.operatorUserId)) {
        if (++scanned > MAX_AGENT_SCAN || agentRows.length >= limit) break;
        const isMcp = row.channel === "mcp";
        if (args.source === "mcp" && !isMcp) continue;
        if (args.source === "agent" && isMcp) continue;
        agentRows.push(row);
      }
    }

    const runs = new Map(
      await Promise.all(
        [...new Set(agentRows.flatMap((row) => (row.runId ? [row.runId] : [])))].map(
          async (runId) => [runId, await ctx.db.get(runId)] as const,
        ),
      ),
    );
    const clientIds = new Set(
      [...runs.values()].flatMap((run) => (run?.mcpClientId ? [run.mcpClientId] : [])),
    );
    const clientNames = new Map(
      await Promise.all(
        [...clientIds].map(async (clientId) => {
          const client = await ctx.db
            .query("oauthClients")
            .withIndex("client", (q) => q.eq("clientId", clientId))
            .unique();
          return [clientId, client?.clientName ?? "MCP client"] as const;
        }),
      ),
    );

    const orgIds = new Set<Id<"organizations">>();
    const requestIds = new Set<Id<"procurementRequests">>();
    const subjects = (ids: {
      orgId?: Id<"organizations">;
      requestId?: Id<"procurementRequests">;
      writes?: Doc<"operatorAuditEvents">["writes"];
      targetKind?: string;
      targetId?: string;
    }) => {
      let orgId = ids.orgId;
      let requestId = ids.requestId;
      if (ids.targetId && ids.targetKind === "organization") {
        orgId ??= ctx.db.normalizeId("organizations", ids.targetId) ?? undefined;
      }
      if (ids.targetId && ids.targetKind === "procurement_request") {
        requestId ??=
          ctx.db.normalizeId("procurementRequests", ids.targetId) ?? undefined;
      }
      const writes = (ids.writes ?? []).map((write) => {
        const table = write.table ?? tableOf(ctx, write.id);
        if (table === "organizations") {
          orgId ??= ctx.db.normalizeId("organizations", write.id) ?? undefined;
        }
        if (table === "procurementRequests") {
          requestId ??=
            ctx.db.normalizeId("procurementRequests", write.id) ?? undefined;
        }
        return { op: write.op, table, id: write.id };
      });
      if (orgId) orgIds.add(orgId);
      if (requestId) requestIds.add(requestId);
      return { orgId, requestId, writes };
    };

    const entries = [
      ...consoleRows.map((row) => {
        const subject = subjects({
          orgId: row.targetOrgId,
          requestId: row.requestId,
          writes: row.writes,
        });
        return {
          id: row._id as string,
          at: row.createdAt,
          source: row.functionName ? ("console" as const) : ("event" as const),
          actorUserId: row.operatorUserId ?? null,
          title:
            row.type === "console_write" && row.functionName
              ? functionTitle(row.functionName)
              : row.summary,
          detail:
            row.type !== "console_write" && row.functionName
              ? functionTitle(row.functionName)
              : null,
          functionName: row.functionName ?? null,
          client: null,
          channel: null,
          status: null,
          effect: null,
          error: null,
          threadId: null,
          ...subject,
        };
      }),
      ...agentRows.map((row) => {
        const run = row.runId ? runs.get(row.runId) : null;
        const subject = subjects({
          orgId: row.orgId,
          targetKind: row.targetKind,
          targetId: row.targetId,
        });
        return {
          id: row._id as string,
          at: row.createdAt,
          source: row.channel === "mcp" ? ("mcp" as const) : ("agent" as const),
          actorUserId: row.operatorUserId ?? null,
          title: humanize(row.action),
          detail: agentDetail(row),
          functionName: null,
          client: run?.mcpClientId
            ? (clientNames.get(run.mcpClientId) ?? null)
            : null,
          channel: row.channel ?? null,
          status: row.status,
          effect: row.effect ?? null,
          error: row.error ?? null,
          threadId: row.operatorThreadId ?? null,
          ...subject,
        };
      }),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);

    const [people, orgs, requests] = await Promise.all([
      operatorPeople(
        ctx,
        entries.flatMap((entry) =>
          entry.actorUserId ? [entry.actorUserId] : [],
        ),
      ),
      Promise.all([...orgIds].map((id) => ctx.db.get(id))),
      Promise.all([...requestIds].map((id) => ctx.db.get(id))),
    ]);
    const orgById = new Map(
      orgs.flatMap((org) =>
        org ? [[org._id, { id: org._id, name: org.name, type: org.type ?? null }]] : [],
      ),
    );
    const requestById = new Map(
      requests.flatMap((request) =>
        request
          ? [
              [
                request._id,
                {
                  id: request._id,
                  title: request.title,
                  clientOrgId: request.clientOrgId ?? null,
                },
              ],
            ]
          : [],
      ),
    );

    return {
      entries: entries.map(({ actorUserId, orgId, requestId, ...entry }) => ({
        ...entry,
        actor: actorUserId ? (people.get(actorUserId) ?? null) : null,
        org: orgId ? (orgById.get(orgId) ?? null) : null,
        request: requestId ? (requestById.get(requestId) ?? null) : null,
      })),
      hasMore:
        consoleRows.length === limit || agentRows.length === limit,
    };
  },
});

/** Active operators for the audit log's person filter. */
export const operators = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx);
    const profiles = await ctx.db
      .query("operatorProfiles")
      .withIndex("status", (q) => q.eq("status", "active"))
      .take(200);
    const people = await operatorPeople(
      ctx,
      profiles.map((profile) => profile.userId),
    );
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
});
