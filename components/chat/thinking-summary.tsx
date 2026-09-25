"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { toolActivityIcon } from "@/lib/tool-activity-icons";
import { typeStyle } from "@/lib/typography";
import { ChatDisclosure } from "./disclosure";

type ActivityCall = { name: string; input?: string };

function mcpInput(
  call: ActivityCall,
): { serverId: string; toolName: string } | undefined {
  if (call.name !== "call_mcp_tool") return;
  try {
    const value: unknown = JSON.parse(call.input ?? "");
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

function McpToolActivityIcon({ serverId }: { serverId: string }) {
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

function activityContext(input: string | undefined): string | undefined {
  if (!input) return;
  try {
    const value: unknown = JSON.parse(input);
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of ["query", "title", "filename", "fileName", "name"]) {
      const detail = (value as Record<string, unknown>)[key];
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    }
  } catch {
    // Stored audit previews can be truncated JSON.
  }
}

export function ThinkingSummary({
  tools = [],
  toolCalls,
  working,
}: {
  tools?: string[];
  toolCalls?: ActivityCall[];
  working: boolean;
}) {
  const hasCalls = Boolean(toolCalls?.length);
  const activities: ActivityCall[] = toolCalls?.length
    ? toolCalls
    : [...new Set(tools)].map((name) => ({ name }));
  if (activities.length === 0) return null;

  const mcpServerIds = [
    ...new Set(activities.flatMap((call) => mcpInput(call)?.serverId ?? [])),
  ];
  const icons = [
    ...new Set(
      activities
        .filter((call) => !mcpInput(call))
        .map((call) => toolActivityIcon(call.name)),
    ),
  ];
  const noun = hasCalls ? "tool call" : "tool";
  return (
    <ChatDisclosure
      key={working ? "working" : "finished"}
      className={`mb-3 text-muted-foreground/50 ${typeStyle("caption.default")}`}
      summaryClassName="hover:text-muted-foreground"
      summary={
        <>
          <span>
            {activities.length} {noun}
            {activities.length === 1 ? "" : "s"}
          </span>
          <span className="flex flex-wrap items-center gap-1.5" aria-hidden>
            {mcpServerIds.map((serverId) => (
              <McpToolActivityIcon key={serverId} serverId={serverId} />
            ))}
            {icons.map((Icon, index) => (
              <Icon key={index} className="size-3.5 shrink-0" />
            ))}
          </span>
        </>
      }
    >
      <ul className="space-y-1.5 py-1.5">
        {activities.map((call, index) => {
          const mcp = mcpInput(call);
          const label =
            mcp?.toolName ??
            call.name.charAt(0).toUpperCase() +
              call.name.slice(1).replaceAll("_", " ");
          const context = activityContext(call.input);
          const Icon = toolActivityIcon(call.name);
          return (
            <li
              key={`${call.name}-${index}`}
              className="flex min-w-0 items-start gap-1.5"
            >
              {mcp ? (
                <McpToolActivityIcon serverId={mcp.serverId} />
              ) : (
                <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              )}
              <div
                className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 ${typeStyle("body.default")}`}
              >
                <span className="break-words text-foreground">{label}</span>
                {context ? (
                  <span className="min-w-0 break-words">{context}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </ChatDisclosure>
  );
}
