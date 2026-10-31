"use client";

import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import type { AgentDockSubtask } from "./types";

const STACK_MARKS = 4;

/** One 16-unit circle family: ring states for work in flight, filled states for outcomes. */
const STATUS_ICON: Record<
  AgentDockSubtask["status"],
  { label: string; color: string }
> = {
  working: { label: "Working", color: "text-primary" },
  approval: { label: "Needs approval", color: "text-amber-500" },
  done: { label: "Done", color: "text-emerald-500" },
  failed: { label: "Failed", color: "text-destructive" },
  stopped: { label: "Stopped", color: "text-muted-foreground/50" },
};

/**
 * A subtask's state as one mark from a single circle family: a spinning arc
 * while it works; filled discs for needs approval (pause), done (check),
 * failed (cross) and stopped (square).
 */
export function SubtaskStatusGlyph({
  status,
  className,
}: {
  status: AgentDockSubtask["status"];
  className?: string;
}) {
  const { label, color } = STATUS_ICON[status];
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      className={cn(
        "size-3.5 shrink-0",
        color,
        // The ring is uniform, so the whole mark turns with its arc.
        status === "working" && "motion-safe:animate-spin",
        className,
      )}
    >
      {status === "working" ? (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.25"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.2"
            strokeWidth="1.75"
          />
          <path
            d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          {status === "approval" ? (
            <path
              d="M6.25 5.5v5M9.75 5.5v5"
              stroke="white"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ) : status === "done" ? (
            <path
              d="m5.25 8.25 1.9 1.9 3.6-3.9"
              fill="none"
              stroke="white"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : status === "failed" ? (
            <path
              d="m5.75 5.75 4.5 4.5m0-4.5-4.5 4.5"
              stroke="white"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          ) : (
            <rect x="5.5" y="5.5" width="5" height="5" rx="1" fill="white" />
          )}
        </>
      )}
    </svg>
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
