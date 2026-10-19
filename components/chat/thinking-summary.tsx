"use client";

import { Route } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { toolActivityIcon } from "@/lib/tool-activity-icons";
import { typeStyle } from "@/lib/typography";
import { ChatDisclosure } from "./disclosure";

type ActivityCall = { name: string; input?: string; status?: ActivityStatus };

export type ActivityStatus =
  | "requested"
  | "running"
  | "returned"
  | "completed"
  | "failed"
  | "awaiting_approval"
  | "skipped";

export type StageName =
  | "preparing_context"
  | "screening_request"
  | "selecting_tools"
  | "selecting_model";

type StageStatus = "running" | "completed" | "failed";

/** Status observed by the app for a message; retained after the turn settles. */
export type ChatActivity = {
  phase: "model" | "tools";
  tools: { toolCallId: string; toolName: string; status: ActivityStatus }[];
  stages?: { stageId: string; stage: StageName; status: StageStatus }[];
};

const STAGE_LABELS: Record<StageName, string> = {
  preparing_context: "Preparing context",
  screening_request: "Checking request",
  selecting_tools: "Deciding which tools to load",
  selecting_model: "Selecting model",
};

export function stageLabel(stage: StageName) {
  return STAGE_LABELS[stage];
}

/** A turn that ended while an item was open never finished it. */
function displayStatus(status: ActivityStatus | StageStatus, working: boolean) {
  if (!working && status === "running") return "Interrupted";
  if (!working && status === "requested") return "Not run";
  if (status === "completed" && !working) return "Done";
  return status in STATUS_LABELS
    ? STATUS_LABELS[status as ActivityStatus]
    : status;
}

const STATUS_LABELS: Record<ActivityStatus, string> = {
  requested: "Requested",
  running: "Running",
  returned: "Finished",
  completed: "Completed",
  failed: "Failed",
  awaiting_approval: "Awaiting approval",
  skipped: "Not run",
};

function toolLabel(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1).replaceAll("_", " ");
}

/**
 * One-line status for the working indicator, from observed activity only.
 * Returns the generic label when there is nothing real to report.
 */
export function activityStatusLabel(activity?: ChatActivity): string {
  if (!activity) return "Working…";
  const stage = activity.stages?.findLast((entry) => entry.status === "running");
  if (stage) return `${STAGE_LABELS[stage.stage]}…`;
  for (const status of ["running", "requested"] as const) {
    const active = activity.tools.filter((tool) => tool.status === status);
    if (active.length > 0) {
      const more = active.length > 1 ? ` +${active.length - 1} more` : "";
      return `${STATUS_LABELS[status]} ${toolLabel(active[0].toolName)}${more}…`;
    }
  }
  return activity.phase === "model" ? "Waiting for model…" : "Working…";
}

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

/**
 * Joins the stored tool audit with observed status. The audit stays
 * authoritative for what ran; observed entries add status and any call the
 * audit missed (for example one that failed or never started).
 */
function mergeCalls(
  tools: string[],
  toolCalls: ActivityCall[] | undefined,
  activity: ChatActivity | undefined,
): ActivityCall[] {
  const observed = activity?.tools ?? [];
  if (toolCalls?.length) {
    const pool = [...observed];
    const merged = toolCalls.map((call) => {
      const index = pool.findIndex((tool) => tool.toolName === call.name);
      if (index < 0) return call;
      const [match] = pool.splice(index, 1);
      return { ...call, status: match.status };
    });
    return [
      ...merged,
      ...pool.map((tool) => ({ name: tool.toolName, status: tool.status })),
    ];
  }
  const seen = new Set(observed.map((tool) => tool.toolName));
  return [
    ...observed.map((tool) => ({ name: tool.toolName, status: tool.status })),
    ...[...new Set(tools)]
      .filter((name) => !seen.has(name))
      .map((name) => ({ name })),
  ];
}

export function ThinkingSummary({
  tools = [],
  toolCalls,
  activity,
  working,
}: {
  tools?: string[];
  toolCalls?: ActivityCall[];
  activity?: ChatActivity;
  working: boolean;
}) {
  const activities = mergeCalls(tools, toolCalls, activity);
  const stages = activity?.stages ?? [];
  if (activities.length === 0 && stages.length === 0) return null;
  const hasCalls = Boolean(toolCalls?.length) || Boolean(activity?.tools.length);

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
      working={working}
      className={`mb-3 text-muted-foreground/50 ${typeStyle("caption.default")}`}
      summaryClassName="hover:text-muted-foreground"
      summary={
        <>
          <span>
            {[
              stages.length > 0
                ? `${stages.length} step${stages.length === 1 ? "" : "s"}`
                : undefined,
              activities.length > 0
                ? `${activities.length} ${noun}${activities.length === 1 ? "" : "s"}`
                : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
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
        {stages.map((entry) => (
          <li
            key={entry.stageId}
            className="flex min-w-0 items-start gap-1.5"
          >
            <Route aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <div
              className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 ${typeStyle("body.default")}`}
            >
              <span className="break-words text-foreground">
                {STAGE_LABELS[entry.stage]}
              </span>
              <span
                className={
                  entry.status === "failed" ? "text-destructive" : undefined
                }
              >
                {displayStatus(entry.status, working)}
              </span>
            </div>
          </li>
        ))}
        {activities.map((call, index) => {
          const mcp = mcpInput(call);
          const label = mcp?.toolName ?? toolLabel(call.name);
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
                {call.status ? (
                  <span
                    className={
                      call.status === "failed" ? "text-destructive" : undefined
                    }
                  >
                    {displayStatus(call.status, working)}
                  </span>
                ) : null}
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
