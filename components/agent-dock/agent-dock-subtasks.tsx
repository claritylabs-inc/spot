"use client";

import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import {
  StatusIndicator,
  type StatusIndicatorKind,
} from "@claritylabs-inc/ui/components/status-tag";

import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import type { AgentDockSubtask } from "./types";

const STACK_MARKS = 4;

const STATUS_ICON: Record<
  Exclude<AgentDockSubtask["status"], "working">,
  { label: string; indicator: StatusIndicatorKind }
> = {
  approval: { label: "Needs approval", indicator: "waiting" },
  done: { label: "Done", indicator: "complete" },
  failed: { label: "Failed", indicator: "error" },
  stopped: { label: "Stopped", indicator: "cancelled" },
};

/**
 * A subtask's state in the logo blue: the loading spinner while it works,
 * otherwise the status tag's indicator for that state.
 */
export function SubtaskStatusGlyph({
  status,
  className,
}: {
  status: AgentDockSubtask["status"];
  className?: string;
}) {
  const mark = cn("size-3.5 shrink-0 text-brand-blue", className);
  if (status === "working")
    return <Spinner aria-label="Working" className={mark} />;
  const { label, indicator } = STATUS_ICON[status];
  return (
    <span role="img" aria-label={label} className="flex shrink-0">
      <StatusIndicator indicator={indicator} className={mark} />
    </span>
  );
}

/** "3 subtasks · 1 needs approval" for labels and tooltips. */
export function subtaskSummary(subtasks: readonly AgentDockSubtask[]) {
  const count = `${subtasks.length} subtask${subtasks.length === 1 ? "" : "s"}`;
  const approvals = subtasks.filter((task) => task.status === "approval").length;
  return approvals ? `${count} · ${approvals} need${approvals === 1 ? "s" : ""} approval` : count;
}

/**
 * A chat's subtasks while neither it nor they are open: overlapping status
 * marks and a count, like the overlapping marks of a tool call's targets.
 */
export function SubtaskStack({
  subtasks,
  onSelect,
  className,
}: {
  subtasks: readonly AgentDockSubtask[];
  onSelect: () => void;
  className?: string;
}) {
  // What needs attention leads the stack.
  const order: AgentDockSubtask["status"][] = ["approval", "working", "failed", "done", "stopped"];
  const marks = [...subtasks]
    .sort((left, right) => order.indexOf(left.status) - order.indexOf(right.status))
    .slice(0, STACK_MARKS);
  const summary = subtaskSummary(subtasks);
  return (
    <button
      type="button"
      onClick={onSelect}
      title={[summary, ...subtasks.map((task) => task.title)].join("\n")}
      aria-label={summary}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
        typeStyle("control.buttonCompact"),
        className,
      )}
    >
      <span aria-hidden className="flex items-center">
        {marks.map((task, index) => (
          // A background disc keeps each mark whole where the next overlaps it.
          <span
            key={task.threadId}
            className={cn(
              "flex rounded-full bg-background ring-[1.5px] ring-background",
              index > 0 && "-ml-1",
            )}
          >
            <SubtaskStatusGlyph status={task.status} />
          </span>
        ))}
      </span>
      <span className="whitespace-nowrap">
        {subtasks.length} subtask{subtasks.length === 1 ? "" : "s"}
      </span>
    </button>
  );
}
