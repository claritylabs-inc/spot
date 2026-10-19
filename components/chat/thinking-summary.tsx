"use client";

import type { ReactNode } from "react";
import {
  Cpu,
  Globe,
  Layers,
  ListChecks,
  Route,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useQuery } from "convex/react";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@claritylabs-inc/ui/components/tooltip";
import { api } from "@/convex/_generated/api";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { toolActivityIcon } from "@/lib/tool-activity-icons";
import {
  isWebActivityTool,
  toolActivityContext,
  type ToolActivityContext,
} from "@/lib/tool-activity-context";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { ChatDisclosure } from "./disclosure";

type ActivityCall = {
  name: string;
  input?: string;
  status?: ActivityStatus;
  context?: ToolActivityContext;
};

export type ActivityStatus =
  | "requested"
  | "running"
  | "returned"
  | "completed"
  | "failed"
  | "awaiting_approval"
  | "skipped";

export type StageName =
  | "assessing_workflow"
  | "planning"
  | "preparing_context"
  | "screening_request"
  | "selecting_tools"
  | "selecting_model";

type StageStatus = "running" | "completed" | "failed";

/** Status observed by the app for a message; retained after the turn settles. */
export type ChatActivity = {
  phase: "model" | "tools";
  tools: {
    toolCallId: string;
    toolName: string;
    status: ActivityStatus;
    context?: ToolActivityContext;
  }[];
  stages?: {
    stageId: string;
    stage: StageName;
    status: StageStatus;
    /** Concise factual outcome; absent on older messages. */
    detail?: string;
  }[];
};

const STAGE_LABELS: Record<
  StageName,
  { running: string; completed: string; icon: typeof Route }
> = {
  assessing_workflow: {
    running: "Checking workflow",
    completed: "Workflow checked",
    icon: ListChecks,
  },
  planning: { running: "Creating plan", completed: "Plan ready", icon: Route },
  preparing_context: {
    running: "Preparing context",
    completed: "Context ready",
    icon: Layers,
  },
  screening_request: {
    running: "Checking request",
    completed: "Request checked",
    icon: ShieldCheck,
  },
  selecting_tools: {
    running: "Loading tools",
    completed: "Tools loaded",
    icon: Wrench,
  },
  selecting_model: {
    running: "Selecting model",
    completed: "Model selected",
    icon: Cpu,
  },
};

export function stageLabel(stage: StageName) {
  return STAGE_LABELS[stage].running;
}

type StageEntry = NonNullable<ChatActivity["stages"]>[number];

/**
 * Display-only grouping: identical completed stages with the same outcome
 * collapse into one counted row. Running, failed, and differing outcomes are
 * never merged, and the stored data is untouched.
 */
function groupStages(stages: readonly StageEntry[]) {
  const rows: { entry: StageEntry; count: number }[] = [];
  for (const entry of stages) {
    const match =
      entry.status === "completed"
        ? rows.find(
            (row) =>
              row.entry.status === "completed" &&
              row.entry.stage === entry.stage &&
              (row.entry.detail ?? "") === (entry.detail ?? ""),
          )
        : undefined;
    if (match) match.count += 1;
    else rows.push({ entry, count: 1 });
  }
  return rows;
}

type RowStatus = ActivityStatus | StageStatus;

/**
 * Accessible status text plus whether it is worth showing. Ordinary success is
 * screen-reader only; failures, approvals, and a turn that ended while an item
 * was open are explicit.
 */
function rowStatus(status: RowStatus, working: boolean) {
  if (!working && status === "running")
    return { text: "Interrupted", visible: true };
  if (!working && status === "requested")
    return { text: "Not run", visible: true };
  if (status === "running") return { text: "Running", visible: false };
  if (status === "completed")
    return { text: working ? "Completed" : "Done", visible: false };
  if (status === "returned") return { text: "Finished", visible: false };
  const text =
    status in STATUS_LABELS ? STATUS_LABELS[status as ActivityStatus] : status;
  return { text, visible: true };
}

/** True when a visible row already shows what the turn is doing right now. */
export function hasActiveActivity(activity?: ChatActivity): boolean {
  return Boolean(
    activity?.stages?.some((entry) => entry.status === "running") ||
    activity?.tools.some(
      (tool) => tool.status === "running" || tool.status === "requested",
    ),
  );
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
  const stage = activity.stages?.findLast(
    (entry) => entry.status === "running",
  );
  if (stage) return `${STAGE_LABELS[stage.stage].running}…`;
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

/** Observed context first; stored audit previews cover older messages. */
function callContext(call: ActivityCall): ToolActivityContext | undefined {
  if (call.context) return call.context;
  if (!call.input) return;
  try {
    const value: unknown = JSON.parse(call.input);
    const web = toolActivityContext(call.name, value);
    if (web) return web;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of ["query", "title", "filename", "fileName", "name"]) {
      const detail = (value as Record<string, unknown>)[key];
      if (typeof detail === "string" && detail.trim())
        return { label: detail.trim().replace(/\s+/g, " ").slice(0, 160) };
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
      return { ...call, status: match.status, context: match.context };
    });
    return [
      ...merged,
      ...pool.map((tool) => ({
        name: tool.toolName,
        status: tool.status,
        context: tool.context,
      })),
    ];
  }
  const seen = new Set(observed.map((tool) => tool.toolName));
  return [
    ...observed.map((tool) => ({
      name: tool.toolName,
      status: tool.status,
      context: tool.context,
    })),
    ...[...new Set(tools)]
      .filter((name) => !seen.has(name))
      .map((name) => ({ name })),
  ];
}

function hostOf(website: string) {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

/** Several targets: overlapping favicons, a count, and every domain on focus. */
function WebsiteTargets({ websites }: { websites: string[] }) {
  const hosts = websites.map(hostOf);
  const summary = `${hosts.length} website${hosts.length === 1 ? "" : "s"}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={`${summary}: ${hosts.join(", ")}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <span className="flex items-center" aria-hidden>
          {websites.slice(0, 3).map((website, index) => (
            <OrgBrandIcon
              key={website}
              name={hosts[index]}
              website={website}
              size="xs"
              className={cn(
                "size-4 rounded-full ring-2 ring-background",
                index > 0 && "-ml-1.5",
              )}
            />
          ))}
        </span>
        <span
          aria-hidden
          className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground/80"
        >
          {summary}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5">
          {hosts.map((host) => (
            <li key={host} className="break-all">
              {host}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function ActivityRow({
  icon,
  label,
  context,
  count = 1,
  status,
  working,
}: {
  icon: ReactNode;
  label: string;
  context?: ToolActivityContext;
  /** Identical completed rows merged for display. */
  count?: number;
  status?: RowStatus;
  working: boolean;
}) {
  const shown = status ? rowStatus(status, working) : undefined;
  const active = working && status === "running";
  return (
    <li className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1",
          typeStyle("body.default"),
        )}
      >
        <span className="break-words text-foreground">{label}</span>
        {count > 1 ? (
          <span className="text-muted-foreground/70">×{count}</span>
        ) : null}
        {context?.websites?.length ? (
          <WebsiteTargets websites={context.websites} />
        ) : context ? (
          context.website ? (
            <span
              title={context.label}
              className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-muted-foreground/80"
            >
              {context.label}
            </span>
          ) : (
            <span
              title={context.label}
              className="line-clamp-2 min-w-0 break-words text-muted-foreground/70"
            >
              {context.label}
            </span>
          )
        ) : null}
        {shown ? (
          <span
            className={cn(
              shown.visible
                ? status === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground/70"
                : "sr-only",
            )}
          >
            {shown.text}
          </span>
        ) : null}
        {active ? (
          <Spinner
            aria-hidden="true"
            role="presentation"
            aria-label={undefined}
            className="size-3.5 shrink-0 motion-reduce:animate-none"
          />
        ) : null}
      </div>
    </li>
  );
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
  const hasCalls =
    Boolean(toolCalls?.length) || Boolean(activity?.tools.length);

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
      <ul className="space-y-2.5 py-2.5">
        {groupStages(stages).map(({ entry, count }) => {
          const meta = STAGE_LABELS[entry.stage];
          const Icon = meta.icon;
          return (
            <ActivityRow
              key={entry.stageId}
              icon={<Icon aria-hidden className="size-4" />}
              label={
                entry.status === "completed" ? meta.completed : meta.running
              }
              context={entry.detail ? { label: entry.detail } : undefined}
              count={count}
              status={entry.status}
              working={working}
            />
          );
        })}
        {activities.map((call, index) => {
          const mcp = mcpInput(call);
          const context = callContext(call);
          const Icon = toolActivityIcon(call.name);
          return (
            <ActivityRow
              key={`${call.name}-${index}`}
              icon={
                mcp ? (
                  <McpToolActivityIcon serverId={mcp.serverId} />
                ) : context?.website ? (
                  <OrgBrandIcon
                    name={context.label}
                    website={context.website}
                    size="xs"
                    className="size-4 rounded-full"
                  />
                ) : isWebActivityTool(call.name) ? (
                  <Globe aria-hidden className="size-4" />
                ) : (
                  <Icon aria-hidden className="size-4" />
                )
              }
              label={mcp?.toolName ?? toolLabel(call.name)}
              context={context}
              status={call.status}
              working={working}
            />
          );
        })}
      </ul>
    </ChatDisclosure>
  );
}
