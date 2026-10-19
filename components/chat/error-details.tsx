"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import type { RouterJobFailure } from "@/convex/lib/routerJobFailure";
import { typeStyle } from "@/lib/typography";
import { ChatDisclosure } from "./disclosure";
import { stageLabel, type ChatActivity } from "./thinking-summary";

const STAGE_STATUS: Record<"running" | "completed" | "failed", string> = {
  running: "interrupted",
  completed: "completed",
  failed: "failed",
};

function lastObserved(activity: ChatActivity | undefined): string | undefined {
  const stage = activity?.stages?.at(-1);
  if (stage)
    return `${stageLabel(stage.stage)} (${STAGE_STATUS[stage.status]})`;
  if (!activity) return undefined;
  return activity.phase === "tools" ? "Running tools" : "Waiting for model";
}

/** Bounded, structured diagnostics only: never raw errors or provider text. */
function detailRows(
  failure: RouterJobFailure | undefined,
  requestReference: string | undefined,
  activity: ChatActivity | undefined,
): [string, string][] {
  const rows: [string, string][] = [];
  if (failure) rows.push(["Error code", failure.code]);
  const reference = failure?.requestId ?? requestReference;
  if (reference) rows.push(["Request reference", reference]);
  const stage = lastObserved(activity);
  if (stage) rows.push(["Last observed stage", stage]);
  if (failure) {
    rows.push([
      "Router retry",
      failure.retryable ? "Marked retryable" : "Not retryable",
    ]);
    rows.push([
      "Model execution started (router flag)",
      failure.executionStarted ? "Yes" : "No",
    ]);
    for (const attempt of failure.attempts ?? [])
      rows.push([
        `Attempt ${attempt.attempt}`,
        `${attempt.provider}/${attempt.model}: ${attempt.outcome}${attempt.errorCode ? ` (${attempt.errorCode})` : ""}`,
      ]);
  }
  return rows;
}

/** Collapsed operator-only diagnostics for a failed turn. */
export function ChatErrorDetails({
  failure,
  requestReference,
  activity,
}: {
  failure?: RouterJobFailure;
  requestReference?: string;
  activity?: ChatActivity;
}) {
  const [copied, setCopied] = useState(false);
  const rows = detailRows(failure, requestReference, activity);
  if (rows.length === 0) return null;
  const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  return (
    <ChatDisclosure
      compact
      className={`mt-1 text-muted-foreground/60 ${typeStyle("caption.default")}`}
      summaryClassName="hover:text-muted-foreground"
      summary={<span>Error details</span>}
    >
      <dl className="space-y-1 py-1.5">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5"
          >
            <dt>{label}</dt>
            <dd className="min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="mb-1.5 inline-flex items-center gap-1 rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error("Could not copy details");
          }
        }}
      >
        {copied ? (
          <Check aria-hidden className="size-3" />
        ) : (
          <Copy aria-hidden className="size-3" />
        )}
        {copied ? "Copied" : "Copy details"}
      </button>
    </ChatDisclosure>
  );
}
