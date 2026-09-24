"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";

export function mcpActivityInput(
  input?: string,
): { serverId: string; toolName: string } | undefined {
  try {
    const value: unknown = JSON.parse(input ?? "");
    if (!value || typeof value !== "object") return;
    const fields = value as Record<string, unknown>;
    if (
      typeof fields.serverId === "string" &&
      typeof fields.toolName === "string"
    )
      return { serverId: fields.serverId, toolName: fields.toolName };
  } catch {
    /* Audit previews may be truncated. */
  }
}

export function McpToolActivityIcon({ serverId }: { serverId: string }) {
  const server = useQuery(api.operatorMcpServers.brand, { serverId });
  return (
    <OrgBrandIcon
      name={server?.name ?? "MCP"}
      iconUrl={server?.logoUrl}
      website={server?.url}
      size="xs"
      className="mt-0.5 shrink-0"
    />
  );
}
