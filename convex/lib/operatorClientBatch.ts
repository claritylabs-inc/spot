import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { OPERATOR_AGENT_TOOL_REGISTRY } from "./operatorAgentToolRegistry";
import {
  assertFeatureFlagAllowedForOrg,
  isFeatureEnabled,
} from "./featureFlags";
import { clientAccessStatus } from "./clientAccess";
import { prepareOperatorBatch } from "./operatorBatch";

export type ClientBatchToolName =
  | "set_client_assignees"
  | "set_client_access_statuses"
  | "set_client_feature_flags";

export type ClientBatchResult = {
  results: Array<{
    orgId: Id<"organizations">;
    clientName: string;
    status: "updated" | "unchanged";
    previous: Id<"users"> | null | "limited" | "active" | "archived" | boolean;
    next: Id<"users"> | null | "limited" | "active" | "archived" | boolean;
  }>;
};

export function isClientBatchToolName(
  name: string,
): name is ClientBatchToolName {
  return (
    name === "set_client_assignees" ||
    name === "set_client_access_statuses" ||
    name === "set_client_feature_flags"
  );
}

type PreparedClientWrite = {
  organization: Doc<"organizations">;
  nextLabel: string;
} & (
  | { kind: "assignee"; previous: Id<"users"> | null; next: Id<"users"> | null }
  | {
      kind: "access_status";
      previous: "limited" | "active" | "archived";
      next: "limited" | "active" | "archived";
    }
  | {
      kind: "feature_flag";
      flagId: "connect_features";
      previous: boolean;
      next: boolean;
    }
);

async function requireClient(ctx: QueryCtx, value: string) {
  const orgId = ctx.db.normalizeId("organizations", value);
  const organization = orgId ? await ctx.db.get(orgId) : null;
  if (
    !organization ||
    organization.deletedAt !== undefined ||
    organization.type !== "client"
  ) {
    throw new Error(
      "Client organization not found; use an exact client ID from a read tool",
    );
  }
  return organization;
}

export async function prepareClientBatch(
  ctx: QueryCtx,
  toolName: ClientBatchToolName,
  input: Record<string, unknown>,
): Promise<PreparedClientWrite[]> {
  if (toolName === "set_client_assignees") {
    const { items } =
      OPERATOR_AGENT_TOOL_REGISTRY.set_client_assignees.inputSchema.parse(
        input,
      );
    return prepareOperatorBatch(
      items,
      (item) => item.orgId,
      async (item) => {
        const organization = await requireClient(ctx, item.orgId);
        const assigneeUserId =
          item.assigneeUserId === null
            ? null
            : ctx.db.normalizeId("users", item.assigneeUserId);
        let nextLabel = "Unassigned";
        if (item.assigneeUserId !== null) {
          const [user, profile] = assigneeUserId
            ? await Promise.all([
                ctx.db.get(assigneeUserId),
                ctx.db
                  .query("operatorProfiles")
                  .withIndex("user", (q) => q.eq("userId", assigneeUserId))
                  .first(),
              ])
            : [null, null];
          if (!user || profile?.status !== "active")
            throw new Error(
              "Assignee must be an active operator from list_operators",
            );
          nextLabel =
            user.name?.trim() ||
            user.email ||
            profile.email ||
            String(assigneeUserId);
        }
        return {
          organization,
          kind: "assignee" as const,
          previous: organization.assignedOperatorUserId ?? null,
          next: assigneeUserId,
          nextLabel,
        };
      },
    );
  }
  if (toolName === "set_client_access_statuses") {
    const { items } =
      OPERATOR_AGENT_TOOL_REGISTRY.set_client_access_statuses.inputSchema.parse(
        input,
      );
    return prepareOperatorBatch(
      items,
      (item) => item.orgId,
      async (item) => {
        const organization = await requireClient(ctx, item.orgId);
        return {
          organization,
          kind: "access_status" as const,
          previous: clientAccessStatus(organization),
          next: item.status,
          nextLabel: item.status,
        };
      },
    );
  }
  const { items } =
    OPERATOR_AGENT_TOOL_REGISTRY.set_client_feature_flags.inputSchema.parse(
      input,
    );
  return prepareOperatorBatch(
    items,
    (item) => item.orgId,
    async (item) => {
      const organization = await requireClient(ctx, item.orgId);
      assertFeatureFlagAllowedForOrg(item.flagId, organization);
      return {
        organization,
        kind: "feature_flag" as const,
        flagId: item.flagId,
        previous: isFeatureEnabled(organization, item.flagId),
        next: item.enabled,
        nextLabel: `${item.flagId} ${item.enabled ? "enabled" : "disabled"}`,
      };
    },
  );
}

export async function clientBatchConfirmationSummary(
  ctx: QueryCtx,
  toolName: ClientBatchToolName,
  input: Record<string, unknown>,
) {
  const items = await prepareClientBatch(ctx, toolName, input);
  const first = items[0];
  const count = `${items.length} client${items.length === 1 ? "" : "s"}`;
  const sameNext = items.every((item) => item.next === first.next);
  const display = (name: string) => name.replace(/\s+/g, " ").trim();
  const header =
    first.kind === "assignee"
      ? `Assign ${count}${sameNext ? ` to ${display(first.nextLabel)}` : ""}`
      : first.kind === "access_status"
        ? `Set access for ${count}${sameNext ? ` to ${first.next}` : ""}`
        : sameNext
          ? `${first.next ? "Enable" : "Disable"} ${first.flagId} for ${count}`
          : `Set feature flags for ${count}`;
  const summary = [
    header,
    ...items.map(
      (item) =>
        `- ${display(item.organization.name) || item.organization._id} → ${display(item.nextLabel)}`,
    ),
  ].join("\n");
  if (summary.length > 20_000)
    throw new Error(
      "The full batch approval exceeds 20,000 characters; split it into smaller batches",
    );
  return summary;
}
