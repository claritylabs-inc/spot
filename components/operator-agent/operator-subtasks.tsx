"use client";

import { SubtaskStatusGlyph } from "@/components/agent-dock/agent-dock-subtasks";
import type { AgentDockSubtask } from "@/components/agent-dock/types";
import type { OperatorAgentSubtask } from "@/lib/operator-agent-api";
import { toolActivityLabel } from "@/lib/tool-activity-label";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

export const DOCK_SUBTASK_STATUS: Record<
  OperatorAgentSubtask["status"],
  AgentDockSubtask["status"]
> = {
  queued: "working",
  running: "working",
  waiting_confirmation: "approval",
  completed: "done",
  failed: "failed",
  cancelled: "stopped",
};

/** The one line that changes as a subtask works: its latest step, approval or answer. */
function subtaskDetail(task: OperatorAgentSubtask) {
  if (task.status === "waiting_confirmation") {
    const summary = task.approval?.split("\n")[0]?.trim();
    return summary ? summary.charAt(0).toUpperCase() + summary.slice(1) : "Needs approval";
  }
  if (task.status === "cancelled") return "Stopped";
  if (task.status === "completed" || task.status === "failed")
    return task.answer ?? (task.status === "failed" ? "Failed" : "Done");
  const tool = task.latestTool;
  if (!tool) return task.status === "queued" ? "Starting" : "Thinking";
  const running = tool.status === "running" || tool.status === "requested";
  const label = toolActivityLabel(tool.toolName, running ? "progressive" : "past");
  return tool.label ? `${label} · ${tool.label}` : label;
}

/**
 * The subtasks a reply started, one line each: name, then the latest step
 * (shimmering while it works), the action awaiting approval, or the answer.
 */
export function OperatorSubtaskList({
  subtasks,
  onOpen,
}: {
  subtasks: OperatorAgentSubtask[];
  onOpen: (threadId: string) => void;
}) {
  if (!subtasks.length) return null;
  return (
    <ul className="mt-2 w-full overflow-hidden rounded-xl border border-border bg-card">
      {subtasks.map((task) => {
        const working = task.status === "queued" || task.status === "running";
        const approval = task.status === "waiting_confirmation";
        const detail = subtaskDetail(task);
        return (
          <li key={task.threadId} className="border-t border-border first:border-t-0">
            <button
              type="button"
              onClick={() => onOpen(task.threadId)}
              className={cn(
                "flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40",
                typeStyle("body.default"),
              )}
            >
              <SubtaskStatusGlyph status={DOCK_SUBTASK_STATUS[task.status]} />
              <span
                className={cn("max-w-[45%] shrink-0 truncate", typeStyle("body.medium"))}
              >
                {task.title}
              </span>
              <span
                title={detail}
                className={cn(
                  "min-w-0 flex-1 truncate",
                  working ? "text-shimmer" : "text-muted-foreground",
                )}
              >
                {detail}
              </span>
              {approval ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700 ring-1 ring-amber-200",
                    typeStyle("caption.medium"),
                  )}
                >
                  Review
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
