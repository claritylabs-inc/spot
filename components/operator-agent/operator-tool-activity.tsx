"use client";

import { ChevronRight, CircleAlert, SquareTerminal } from "lucide-react";

import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import { StatusTag, type StatusPresentation } from "@claritylabs-inc/ui/components/status-tag";
import { ChatDisclosure } from "@/components/chat/disclosure";
import { formatDisplayDateTime } from "@/lib/date-format";
import type {
  OperatorAgentConfirmation,
  OperatorAgentMessage,
  OperatorAgentThreadDetail,
} from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

const DISCLOSURE_SUMMARY = "text-muted-foreground hover:text-foreground";

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
): { label: string } & StatusPresentation {
  if (awaitingApproval) return { label: "Awaiting approval", tone: "warning", indicator: "waiting" };
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
    return { label: "Stopped", tone: "neutral", indicator: "cancelled" };
  if (response.status === "processing")
    return { label: "Running", tone: "neutral", indicator: "progress" };
  if (response.content.startsWith("Blocked:"))
    return { label: "Blocked", tone: "warning" };
  if (response.content.startsWith("Completed:"))
    return { label: "Completed", tone: "neutral", indicator: "complete" };
  return { label: "Finished", tone: "neutral", indicator: "complete" };
}

export type OperatorActivityEntry = {
  request: OperatorAgentMessage;
  response?: OperatorAgentMessage;
  confirmations: OperatorAgentConfirmation[];
};

type ConversationEntry =
  | { kind: "message"; activity: OperatorActivityEntry }
  | { kind: "tool_calls"; activities: OperatorActivityEntry[] };

/**
 * Pairs direct tool requests with their responses and confirmations, and
 * folds consecutive settled read-only calls into one collapsible group.
 */
export function operatorConversationEntries(
  detail: Pick<OperatorAgentThreadDetail, "messages" | "confirmations">,
): ConversationEntry[] {
  const requests = new Set(
    detail.messages
      .filter((message) => message.isDirectToolRequest)
      .map((message) => message.id),
  );
  const responses = new Map(
    detail.messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          message.replyToMessageId &&
          requests.has(message.replyToMessageId),
      )
      .map((message) => [message.replyToMessageId, message] as const),
  );
  const confirmations = new Map<string, OperatorAgentConfirmation[]>();
  for (const confirmation of detail.confirmations) {
    const existing = confirmations.get(confirmation.promptMessageId) ?? [];
    existing.push(confirmation);
    confirmations.set(confirmation.promptMessageId, existing);
  }

  const entries: ConversationEntry[] = [];
  for (const request of detail.messages) {
    if (
      request.replyToMessageId &&
      responses.get(request.replyToMessageId)?.id === request.id
    )
      continue;
    const response = request.isDirectToolRequest
      ? responses.get(request.id)
      : undefined;
    const activity: OperatorActivityEntry = {
      request,
      response,
      confirmations: [
        ...(confirmations.get(request.id) ?? []),
        ...(response ? (confirmations.get(response.id) ?? []) : []),
      ],
    };
    const calls = response?.toolCalls ?? [];
    const status = activityStatus(response, false);
    const isGroupableRead =
      request.isDirectToolRequest &&
      activity.confirmations.length === 0 &&
      !request.attachments?.length &&
      !response?.attachments?.length &&
      calls.length > 0 &&
      calls.every((call) => call.effect === "read") &&
      (status.label === "Completed" || status.label === "Failed");
    if (isGroupableRead) {
      const previous = entries.at(-1);
      if (previous?.kind === "tool_calls") previous.activities.push(activity);
      else entries.push({ kind: "tool_calls", activities: [activity] });
    } else {
      entries.push({ kind: "message", activity });
    }
  }
  return entries;
}

export function OperatorToolActivityGroup({
  activities,
}: {
  activities: OperatorActivityEntry[];
}) {
  const errorCount = activities.filter(
    ({ response }) => activityStatus(response, false).label === "Failed",
  ).length;
  return (
    <ChatDisclosure
      summaryClassName={DISCLOSURE_SUMMARY}
      summary={
        <span>
          {activities.length} tool {activities.length === 1 ? "call" : "calls"}
          {errorCount > 0
            ? `, ${errorCount} ${errorCount === 1 ? "error" : "errors"}`
            : ""}
        </span>
      }
    >
      <div>
        {activities.map(({ request, response }) => (
          <OperatorToolActivity
            key={request.id}
            request={request}
            response={response}
            awaitingApproval={false}
          />
        ))}
      </div>
    </ChatDisclosure>
  );
}

function ToolCallDetails({
  request,
  response,
}: {
  request: OperatorAgentMessage;
  response?: OperatorAgentMessage;
}) {
  const calls = response?.toolCalls ?? [];
  return (
    <div>
      <p className={cn("pt-3 text-muted-foreground", typeStyle("caption.default"))}>
        API · {formatDisplayDateTime(request.createdAt)}
      </p>
      <div className="space-y-4 py-3">
        {calls.length === 0 ? (
          <p className={cn("text-muted-foreground", typeStyle("caption.default"))}>
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
    </div>
  );
}

export function OperatorToolActivity({
  request,
  response,
  awaitingApproval,
  detailsOnly = false,
}: {
  request: OperatorAgentMessage;
  response?: OperatorAgentMessage;
  awaitingApproval: boolean;
  detailsOnly?: boolean;
}) {
  const status = activityStatus(response, awaitingApproval);
  const result = response?.content.trim();
  const showResult =
    result &&
    result !== `Completed: ${request.content}.` &&
    !(awaitingApproval && result.startsWith("Confirmation required:"));

  if (detailsOnly || status.tone === "danger" || status.tone === "warning") {
    return (
      <div className="min-w-0 space-y-2">
        {!detailsOnly || showResult ? (
          <div className="flex items-start gap-2">
            {status.tone === "danger" ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            ) : null}
            <div className="min-w-0">
              <p
                className={cn(
                  "whitespace-pre-wrap wrap-anywhere text-foreground",
                  typeStyle("body.default"),
                )}
              >
                {showResult ? result : request.content}
              </p>
              {awaitingApproval ? (
                <p className={cn("mt-1 text-muted-foreground", typeStyle("caption.default"))}>
                  {status.label}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <ChatDisclosure compact summaryClassName={DISCLOSURE_SUMMARY} summary="Details">
          <ToolCallDetails request={request} response={response} />
        </ChatDisclosure>
      </div>
    );
  }

  return (
    <div className="min-w-0 border-b border-border">
      <details className="group/activity">
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
              <StatusTag tone={status.tone} indicator={status.indicator}>{status.label}</StatusTag>
            </div>
          </div>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground group-open/activity:rotate-90" />
        </summary>
        <ToolCallDetails request={request} response={response} />
      </details>
      {showResult ? (
        <p
          className={cn(
            "pb-3 whitespace-pre-wrap wrap-anywhere text-muted-foreground",
            typeStyle("caption.default"),
          )}
        >
          {result}
        </p>
      ) : null}
    </div>
  );
}
