"use client";

import { ChevronRight } from "lucide-react";

import { toolActivityIcon } from "@/lib/tool-activity-icons";
import { McpToolActivityIcon, mcpActivityInput } from "./mcp-tool-activity";
import { typeStyle } from "@/lib/typography";

type ActivityCall = { name: string; input?: string };

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
    ...new Set(
      activities.flatMap((call) => {
        const input =
          call.name === "call_mcp_tool"
            ? mcpActivityInput(call.input)
            : undefined;
        return input ? [input.serverId] : [];
      }),
    ),
  ];
  const icons = [
    ...new Set(
      activities
        .filter(
          (call) =>
            !(call.name === "call_mcp_tool" && mcpActivityInput(call.input)),
        )
        .map((call) => toolActivityIcon(call.name)),
    ),
  ];
  const noun = hasCalls ? "tool call" : "tool";
  return (
    <details
      key={working ? "working" : "finished"}
      className={`group/thinking mb-3 min-w-0 text-muted-foreground/50 ${typeStyle("caption.default")}`}
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-md py-2 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 group-open/thinking:rotate-90"
        />
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
      </summary>
      <ul className="space-y-3 py-2">
        {activities.map((call, index) => {
          const mcp =
            call.name === "call_mcp_tool"
              ? mcpActivityInput(call.input)
              : undefined;
          const label =
            mcp?.toolName ??
            call.name.charAt(0).toUpperCase() +
              call.name.slice(1).replaceAll("_", " ");
          const context = activityContext(call.input);
          const Icon = toolActivityIcon(call.name);
          return (
            <li
              key={`${call.name}-${index}`}
              className="flex min-w-0 items-start gap-2"
            >
              {mcp ? (
                <McpToolActivityIcon serverId={mcp.serverId} />
              ) : (
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
              )}
              <div
                className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 ${typeStyle("body.large")}`}
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
    </details>
  );
}
