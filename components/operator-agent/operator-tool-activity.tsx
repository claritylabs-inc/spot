"use client";

import { ChevronRight, SquareTerminal } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { StatusTag, type StatusTagTone } from "@/components/ui/status-tag";
import { formatDisplayDateTime } from "@/lib/date-format";
import type { OperatorAgentMessage } from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

function formatToolValue(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    // Stored tool previews can be truncated before the JSON ends.
    return value;
  }
}

function activityStatus(
  response: OperatorAgentMessage | undefined,
  awaitingApproval: boolean,
): { label: string; tone: StatusTagTone } {
  if (awaitingApproval) return { label: "Awaiting approval", tone: "warning" };
  if (!response) return { label: "Pending", tone: "neutral" };
  if (
    response.status === "error" ||
    response.content.startsWith("Could not complete ")
  ) {
    return { label: "Failed", tone: "danger" };
  }
  if (
    response.status === "cancelled" ||
    response.content.startsWith("Cancelled:")
  )
    return { label: "Stopped", tone: "neutral" };
  if (response.status === "processing")
    return { label: "Running", tone: "neutral" };
  if (response.content.startsWith("Blocked:"))
    return { label: "Blocked", tone: "warning" };
  if (response.content.startsWith("Completed:"))
    return { label: "Completed", tone: "neutral" };
  return { label: "Finished", tone: "neutral" };
}

export function OperatorToolActivity({
  request,
  response,
  awaitingApproval,
}: {
  request: OperatorAgentMessage;
  response?: OperatorAgentMessage;
  awaitingApproval: boolean;
}) {
  const status = activityStatus(response, awaitingApproval);
  const calls = response?.toolCalls ?? [];
  const result = response?.content.trim();
  const showResult =
    result &&
    result !== `Completed: ${request.content}.` &&
    !(awaitingApproval && result.startsWith("Confirmation required:"));

  return (
    <div className="min-w-0 border-b border-border">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {status.label === "Running" ? (
            <Spinner className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <SquareTerminal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                className={cn(
                  "wrap-anywhere text-foreground",
                  typeStyle("caption.medium"),
                )}
              >
                {request.content}
              </span>
              <StatusTag tone={status.tone}>{status.label}</StatusTag>
            </div>
            <div
              className={cn(
                "mt-1 text-muted-foreground",
                typeStyle("caption.default"),
              )}
            >
              API · {formatDisplayDateTime(request.createdAt)}
            </div>
          </div>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground group-open:rotate-90" />
        </summary>
        <div className="space-y-4 border-t border-border py-3">
          {calls.length === 0 ? (
            <p
              className={cn(
                "text-muted-foreground",
                typeStyle("caption.default"),
              )}
            >
              No tool details recorded yet.
            </p>
          ) : (
            calls.map((call, index) => (
              <div key={`${call.name}-${index}`} className="min-w-0 space-y-3">
                <p
                  className={cn(
                    "wrap-anywhere text-muted-foreground",
                    typeStyle("technical.codeCompact"),
                  )}
                >
                  {call.name}
                </p>
                {(
                  [
                    ["Input", call.input],
                    ["Result preview", call.output],
                  ] as const
                ).map(([label, value]) =>
                  value !== undefined ? (
                    <div key={label}>
                      <p
                        className={cn(
                          "mb-2 text-muted-foreground",
                          typeStyle("caption.medium"),
                        )}
                      >
                        {label}
                      </p>
                      <pre
                        tabIndex={0}
                        aria-label={label}
                        className={cn(
                          "max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-muted p-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                          typeStyle("technical.codeCompact"),
                        )}
                      >
                        {formatToolValue(value)}
                      </pre>
                    </div>
                  ) : null,
                )}
              </div>
            ))
          )}
        </div>
      </details>
      {showResult ? (
        <p
          className={cn(
            "pb-3 whitespace-pre-wrap wrap-anywhere",
            status.tone === "danger"
              ? "text-destructive"
              : "text-muted-foreground",
            typeStyle("caption.default"),
          )}
        >
          {result}
        </p>
      ) : null}
    </div>
  );
}
