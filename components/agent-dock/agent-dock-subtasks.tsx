"use client";

import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Hourglass,
} from "lucide-react";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";

import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import type { AgentDockSubtask } from "./types";

const STACK_MARKS = 4;

/** A subtask's state as one small mark: working, approval, done, failed or stopped. */
export function SubtaskStatusGlyph({
  status,
  className,
}: {
  status: AgentDockSubtask["status"];
  className?: string;
}) {
  const size = cn("size-3.5 shrink-0", className);
  if (status === "working")
    return <Spinner aria-hidden className={cn(size, "text-muted-foreground")} />;
  if (status === "approval")
    return <Hourglass aria-hidden className={cn(size, "text-amber-600")} />;
  if (status === "done")
    return <CircleCheck aria-hidden className={cn(size, "text-emerald-600")} />;
  if (status === "failed")
    return <CircleAlert aria-hidden className={cn(size, "text-destructive")} />;
  return <CircleSlash aria-hidden className={cn(size, "text-muted-foreground/60")} />;
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
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-1.5 outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    >
      <span aria-hidden className="flex items-center">
        {marks.map((task, index) => (
          <span
            key={task.threadId}
            className={cn(
              "flex size-4 items-center justify-center rounded-full bg-muted ring-2 ring-background",
              index > 0 && "-ml-1.5",
            )}
          >
            <SubtaskStatusGlyph status={task.status} className="size-2.5" />
          </span>
        ))}
      </span>
      <span
        className={cn(
          "rounded-full bg-muted px-2 py-0.5 whitespace-nowrap",
          subtasks.some((task) => task.status === "approval")
            ? "text-amber-700"
            : "text-muted-foreground/80",
          typeStyle("caption.default"),
        )}
      >
        {subtasks.length} subtask{subtasks.length === 1 ? "" : "s"}
      </span>
    </button>
  );
}
