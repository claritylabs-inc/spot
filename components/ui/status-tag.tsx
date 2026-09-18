import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusToneClasses = {
  neutral: "text-muted-foreground",
  info: "text-sky-700 dark:text-sky-400",
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-destructive",
} as const;

const statusTagVariants = cva("border [&>svg]:size-3.5!", {
  variants: {
    tone: {
      neutral:
        "border-border-emphasized bg-foreground/[0.04] text-muted-foreground",
      info: "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400",
      success:
        "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      warning:
        "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      danger:
        "border-destructive/20 bg-destructive/10 text-destructive dark:bg-destructive/15",
    },
  },
  defaultVariants: { tone: "neutral" },
});

type StatusTagTone = keyof typeof statusToneClasses;
type StatusIndicatorKind =
  | "draft"
  | "pending"
  | "progress"
  | "complete"
  | "cancelled"
  | "error"
  | "warning"
  | "waiting"
  | "inactive";

type StatusPresentation = {
  tone?: StatusTagTone;
  indicator?: StatusIndicatorKind;
  /** Position within a known workflow, not an elapsed-time estimate. */
  progress?: number;
};

const defaultIndicators: Record<StatusTagTone, StatusIndicatorKind> = {
  neutral: "pending",
  info: "progress",
  success: "complete",
  warning: "warning",
  danger: "error",
};

function StatusIndicator({
  tone = "neutral",
  indicator = defaultIndicators[tone],
  progress = 0.5,
  className,
}: StatusPresentation & { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-slot="status-indicator"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 shrink-0", statusToneClasses[tone], className)}
    >
      <circle
        cx="9"
        cy="9"
        r="6.6"
        strokeWidth={indicator === "progress" ? 2.4 : 1.8}
        strokeDasharray={indicator === "draft" ? "2 2.6" : undefined}
        opacity={indicator === "progress" ? 0.23 : undefined}
      />
      {indicator === "progress" && (
        <circle
          cx="9"
          cy="9"
          r="6.6"
          strokeWidth="2.4"
          pathLength="100"
          strokeDasharray={`${Math.max(0, Math.min(1, progress)) * 100} 100`}
          transform="rotate(-90 9 9)"
        />
      )}
      {indicator === "complete" && <path d="m5.8 9 2.1 2.1 4.4-4.4" />}
      {indicator === "cancelled" && <path d="m6.7 6.7 4.6 4.6m0-4.6-4.6 4.6" />}
      {(indicator === "error" || indicator === "warning") && (
        <path d="M9 5.7v4.1m0 2v.2" />
      )}
      {indicator === "waiting" && <path d="M9 5v4h3" />}
      {indicator === "inactive" && <path d="M6 9h6" />}
    </svg>
  );
}

type StatusTagProps = Omit<ComponentProps<typeof Badge>, "variant"> &
  VariantProps<typeof statusTagVariants> &
  Omit<StatusPresentation, "tone">;

function StatusTag({
  className,
  tone = "neutral",
  indicator,
  progress,
  children,
  ...props
}: StatusTagProps) {
  return (
    <Badge
      variant="outline"
      data-tone={tone}
      className={cn(statusTagVariants({ tone }), className)}
      {...props}
    >
      <StatusIndicator tone={tone ?? "neutral"} indicator={indicator} progress={progress} />
      {children}
    </Badge>
  );
}

/** Unboxed status content for menu options and their selected value. */
function StatusLabel({
  tone,
  indicator,
  progress,
  className,
  children,
  ...props
}: ComponentProps<"span"> & StatusPresentation) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} {...props}>
      <StatusIndicator tone={tone} indicator={indicator} progress={progress} />
      <span>{children}</span>
    </span>
  );
}

export { StatusTag, StatusIndicator, StatusLabel, statusTagVariants };
export type { StatusTagProps, StatusTagTone, StatusIndicatorKind, StatusPresentation };
