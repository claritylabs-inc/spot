"use client";

import { useId, type ReactNode } from "react";
import { Check, ChevronRight, Globe } from "lucide-react";
import { useQuery } from "convex/react";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@claritylabs-inc/ui/components/tooltip";
import { api } from "@/convex/_generated/api";
import { LogoIcon } from "@/components/ui/logo-icon";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import type { OperatorExecutionPlan } from "@/convex/lib/operatorRunPlan";
import {
  toolActivityCategory,
  toolActivityIcon,
} from "@/lib/tool-activity-icons";
import { toolActivityLabel } from "@/lib/tool-activity-label";
import {
  isWebActivityTool,
  toolActivityContext,
  type ToolActivityContext,
} from "@/lib/tool-activity-context";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import {
  ChatDisclosure,
  DisclosurePanel,
  useActivityDisclosure,
} from "./disclosure";

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
  { running: string; completed: string }
> = {
  assessing_workflow: {
    running: "Checking workflow",
    completed: "Workflow checked",
  },
  planning: { running: "Creating plan", completed: "Plan ready" },
  preparing_context: {
    running: "Preparing context",
    completed: "Context ready",
  },
  screening_request: {
    running: "Checking request",
    completed: "Request checked",
  },
  selecting_tools: {
    running: "Loading tools",
    completed: "Tools loaded",
  },
  selecting_model: {
    running: "Selecting model",
    completed: "Model selected",
  },
};

export function stageLabel(stage: StageName) {
  return STAGE_LABELS[stage].running;
}

type StageEntry = NonNullable<ChatActivity["stages"]>[number];

/**
 * Display-only grouping: identical completed stages with the same outcome
 * collapse into one counted row, and detail-less completed rows are hidden
 * when the same stage has a stated outcome. Running, failed, and differing
 * outcomes are never merged or hidden, and the stored data is untouched.
 */
function groupStages(stages: readonly StageEntry[]) {
  const rows: { entry: StageEntry; count: number }[] = [];
  // A workflow check only matters when it calls for a plan; a check that
  // found none (or predates outcomes) is noise once it has completed.
  stages = stages.filter(
    (entry) =>
      entry.stage !== "assessing_workflow" ||
      entry.status !== "completed" ||
      entry.detail?.startsWith("Plan "),
  );
  // A generic completed row adds nothing once another completed entry of the
  // same stage states its outcome. It is hidden, not merged: it is not
  // identical to the detailed outcome.
  const detailed = new Set(
    stages.flatMap((entry) =>
      entry.status === "completed" && entry.detail?.trim() ? [entry.stage] : [],
    ),
  );
  for (const entry of stages) {
    if (
      entry.status === "completed" &&
      !entry.detail?.trim() &&
      detailed.has(entry.stage)
    )
      continue;
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

/** True when a visible row already shows what the turn is doing right now. */
export function hasActiveActivity(activity?: ChatActivity): boolean {
  return Boolean(
    activity?.stages?.some((entry) => entry.status === "running") ||
    activity?.tools.some(
      (tool) => tool.status === "running" || tool.status === "requested",
    ),
  );
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
      return `${toolActivityLabel(active[0].toolName, "progressive")}${more}…`;
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
      className={BRAND_ICON}
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


/** Brand marks render as 16px circles with a hairline edge. */
const BRAND_ICON = "size-4 shrink-0 rounded-full ring-1 ring-border-subtle";
/* Marks drawn edge to edge on a transparent canvas are inset so the circle
   does not clip them; marks that already fill a circle render full size. */
const PADDED_BRAND_ICON = `${BRAND_ICON} p-[2px]`;

type ToolBrand = { key: string; icon: ReactNode };

/**
 * The mark of what a call touched: the MCP server, the website, Slack, or
 * Spot for platform records. A category glyph remains only where no brand
 * is known (mail provider, unscoped web search, client-side tools).
 */
function toolBrand(call: ActivityCall): ToolBrand {
  const mcp = mcpInput(call);
  if (mcp)
    return {
      key: `mcp:${mcp.serverId}`,
      icon: <McpToolActivityIcon serverId={mcp.serverId} />,
    };
  const context = callContext(call);
  if (context?.website)
    return {
      key: `site:${hostOf(context.website)}`,
      icon: (
        <OrgBrandIcon
          name={context.label}
          website={context.website}
          size="xs"
          className={BRAND_ICON}
        />
      ),
    };
  if (call.name === "send_operator_slack_message")
    return {
      key: "slack",
      icon: (
        <OrgBrandIcon
          name="Slack"
          website="slack.com"
          size="xs"
          className={PADDED_BRAND_ICON}
        />
      ),
    };
  const category = toolActivityCategory(call.name);
  if (category === "web" || isWebActivityTool(call.name))
    return { key: "web", icon: <GlyphIcon icon={Globe} /> };
  if (!category || category === "email" || category === "send")
    return {
      key: `glyph:${category ?? call.name}`,
      icon: <GlyphIcon icon={toolActivityIcon(call.name)} />,
    };
  return {
    key: "spot",
    icon: (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-background">
        <LogoIcon size={16} />
      </span>
    ),
  };
}

function GlyphIcon({ icon: Icon }: { icon: typeof Globe }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Icon aria-hidden className="size-2.5" strokeWidth={2} />
    </span>
  );
}

/** Overlapping marks for every distinct brand a turn touched. */
function BrandStack({ brands }: { brands: ToolBrand[] }) {
  return (
    <span className="flex shrink-0 items-center" aria-hidden>
      {brands.slice(0, 5).map((brand, index) => (
        <span
          key={brand.key}
          className={cn(
            "flex rounded-full ring-2 ring-card",
            index > 0 && "-ml-1.5",
          )}
        >
          {brand.icon}
        </span>
      ))}
    </span>
  );
}

/**
 * Non-success states get a status tag; ordinary success is a check. A turn
 * that ended while a call was open says so explicitly.
 */
function callStatus(
  status: ActivityStatus | undefined,
  working: boolean,
): ({ label: string } & StatusPresentation) | "done" | "running" | undefined {
  if (!status) return working ? undefined : "done";
  if (status === "running" || status === "requested") {
    if (working) return "running";
    return status === "running"
      ? { label: "Interrupted", tone: "neutral", indicator: "cancelled" }
      : { label: "Not run", tone: "neutral", indicator: "inactive" };
  }
  if (status === "failed") return { label: "Failed", tone: "danger" };
  if (status === "awaiting_approval")
    return { label: "Needs approval", tone: "warning", indicator: "waiting" };
  if (status === "skipped")
    return { label: "Not run", tone: "neutral", indicator: "inactive" };
  return "done";
}

function CallStatus({
  status,
  working,
}: {
  status?: ActivityStatus;
  working: boolean;
}) {
  const shown = callStatus(status, working);
  if (shown === "running")
    return (
      <>
        <span className="sr-only">Running</span>
        <Spinner
          aria-hidden="true"
          role="presentation"
          aria-label={undefined}
          className="size-3.5 shrink-0 text-muted-foreground motion-reduce:animate-none"
        />
      </>
    );
  if (shown === "done")
    return (
      <>
        <span className="sr-only">Done</span>
        <Check aria-hidden className="size-3.5 shrink-0 text-success" />
      </>
    );
  if (!shown) return null;
  const { label, ...presentation } = shown;
  return (
    <StatusTag {...presentation} className="shrink-0">
      {label}
    </StatusTag>
  );
}

function CallRow({ call, working }: { call: ActivityCall; working: boolean }) {
  const mcp = mcpInput(call);
  const context = callContext(call);
  const running = working && call.status === "running";
  const label = toolActivityLabel(
    mcp?.toolName ?? call.name,
    running ? "progressive" : "past",
  );
  return (
    <li className="flex min-w-0 items-start gap-2.5 px-3.5 py-2">
      <span className="flex h-6 shrink-0 items-center">
        {toolBrand(call).icon}
      </span>
      <div
        className={cn(
          "flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1",
          typeStyle("body.default"),
        )}
      >
        <span
          className={cn(
            "break-words",
            running ? "text-shimmer" : "text-foreground",
          )}
        >
          {label}
        </span>
        {context?.websites?.length ? (
          <WebsiteTargets websites={context.websites} />
        ) : context && !context.website ? (
          <span
            title={context.label}
            className="line-clamp-2 min-w-0 break-words text-muted-foreground/70"
          >
            {context.label}
          </span>
        ) : context ? (
          <span
            title={context.label}
            className="max-w-full truncate text-muted-foreground/70"
          >
            {context.label}
          </span>
        ) : null}
      </div>
      <span className="flex h-6 shrink-0 items-center">
        <CallStatus status={call.status} working={working} />
      </span>
    </li>
  );
}

/** Lowercases a label's first letter for use mid-sentence. */
function midSentence(label: string) {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** One sentence naming what the turn did, from its distinct call labels. */
function callsSentence(calls: ActivityCall[]) {
  const labels = [
    ...new Set(
      calls.map((call) =>
        toolActivityLabel(mcpInput(call)?.toolName ?? call.name, "past"),
      ),
    ),
  ];
  const shown = labels.slice(0, 3);
  const more = labels.length - shown.length;
  const sentence = shown
    .map((label, index) => (index === 0 ? label : midSentence(label)))
    .join(", ");
  return more > 0 ? `${sentence} and ${more} more` : sentence;
}

/**
 * Tool calls only: what the turn did in real systems. Collapsed it is one
 * line of brand marks and a sentence; expanded, one row per call with its
 * outcome. Internal decisions belong to `ThinkingTrace`.
 */
export function ToolActivityCard({
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
  const contentId = useId();
  const { open, toggle } = useActivityDisclosure(working);
  const calls = mergeCalls(tools, toolCalls, activity);
  if (calls.length === 0) return null;

  const brands = [
    ...new Map(
      calls.map((call) => {
        const brand = toolBrand(call);
        return [brand.key, brand] as const;
      }),
    ).values(),
  ];
  const active = working
    ? calls.findLast((call) => call.status === "running")
    : undefined;
  const needsApproval = calls.some(
    (call) => call.status === "awaiting_approval",
  );
  const summary = active
    ? `${toolActivityLabel(mcpInput(active)?.toolName ?? active.name, "progressive")}…`
    : needsApproval
      ? "Needs your approval"
      : callsSentence(calls);

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        aria-disabled={working}
        onClick={toggle}
        className={cn(
          "flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          working ? "cursor-default" : "cursor-pointer",
          typeStyle("body.default"),
        )}
      >
        <BrandStack brands={brands} />
        <span
          className={cn(
            "min-w-0 truncate",
            active ? "text-shimmer" : "text-muted-foreground",
          )}
        >
          {summary}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "-ml-1 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <span className="sr-only">
          {calls.length} tool call{calls.length === 1 ? "" : "s"}
        </span>
      </button>
      <DisclosurePanel id={contentId} open={open}>
        <ul className="border-t border-border py-1">
          {calls.map((call, index) => (
            <CallRow
              key={`${call.name}-${index}`}
              call={call}
              working={working}
            />
          ))}
        </ul>
      </DisclosurePanel>
    </div>
  );
}

/**
 * Internal decisions, not tool calls: context, tool loading, model choice,
 * request and workflow checks, and the plan when one was made. Prose with a
 * left rule, without brand marks or per-row status.
 */
export function ThinkingTrace({
  activity,
  executionPlan,
  working,
}: {
  activity?: ChatActivity;
  executionPlan?: OperatorExecutionPlan;
  working: boolean;
}) {
  const stages = groupStages(activity?.stages ?? []);
  if (stages.length === 0 && !executionPlan) return null;
  const running = working
    ? stages.findLast(({ entry }) => entry.status === "running")
    : undefined;
  const steps = executionPlan?.steps.length ?? 0;
  return (
    <ChatDisclosure
      working={Boolean(running)}
      compact
      trailingCaret
      collapseWhenDone
      className={`mb-2 text-muted-foreground/70 ${typeStyle("caption.default")}`}
      summaryClassName="hover:text-muted-foreground"
      summary={
        running ? (
          <span className="text-shimmer">
            {STAGE_LABELS[running.entry.stage].running}…
          </span>
        ) : (
          <span>
            Thought process
            {steps ? ` · ${steps}-step plan` : ""}
          </span>
        )
      }
    >
      <div
        className={`mt-1 mb-1 ml-1 space-y-2 border-l-2 border-border pl-3.5 text-muted-foreground ${typeStyle("caption.default")}`}
      >
        {stages.length > 0 ? (
          <ul className="space-y-1">
            {stages.map(({ entry, count }) => {
              const meta = STAGE_LABELS[entry.stage];
              const label =
                entry.status === "completed"
                  ? meta.completed
                  : entry.status === "failed"
                    ? `${meta.running} failed`
                    : `${meta.running}…`;
              return (
                <li
                  key={entry.stageId}
                  className={cn(
                    "break-words",
                    entry.status === "failed" && "text-destructive",
                  )}
                >
                  {label}
                  {entry.detail ? `: ${entry.detail}` : ""}
                  {count > 1 ? ` (×${count})` : ""}
                </li>
              );
            })}
          </ul>
        ) : null}
        {executionPlan ? (
          <div className="space-y-1">
            <p className="break-words text-foreground">
              {executionPlan.summary}
            </p>
            {executionPlan.targets.length ? (
              <p className="break-words">
                Targets: {executionPlan.targets.join(", ")}
              </p>
            ) : null}
            <ol className="list-outside list-decimal space-y-1 pl-5">
              {executionPlan.steps.map((step, index) => (
                <li key={index} className="break-words pl-0.5">
                  <span className="text-foreground">{step.title}</span>
                  <span> — {step.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </ChatDisclosure>
  );
}
