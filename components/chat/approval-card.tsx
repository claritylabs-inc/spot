"use client";

import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

export type ChatApprovalDecision = "approve" | "reject";

/** An action waiting on, or resolved by, the viewer's approval. */
export function ChatApprovalCard({
  status,
  title,
  actionable,
  destructive = false,
  busy,
  onDecision,
}: {
  status: { label: string } & StatusPresentation;
  /** First line is the summary; later lines are details. */
  title: string;
  actionable: boolean;
  destructive?: boolean;
  busy: boolean;
  onDecision: (decision: ChatApprovalDecision) => void;
}) {
  const [summary, ...details] = title.split("\n");
  return (
    <OperationalPanel
      as="div"
      className="flex min-w-0 flex-wrap items-center gap-3 p-3"
    >
      <div className="min-w-0 flex-1 basis-80">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusTag tone={status.tone} indicator={status.indicator}>
            {status.label}
          </StatusTag>
          <p
            className={cn(
              "min-w-0 flex-1 basis-48 break-words text-foreground",
              typeStyle("body.large"),
            )}
          >
            {summary}
          </p>
        </div>
        {details.length ? (
          <p
            className={cn(
              "mt-2 whitespace-pre-line break-words text-foreground",
              typeStyle("body.large"),
            )}
          >
            {details.join("\n")}
          </p>
        ) : null}
      </div>
      {actionable ? (
        <div className="flex shrink-0 items-center gap-2">
          <PillButton
            size="compact"
            variant="secondary"
            disabled={busy}
            onClick={() => onDecision("reject")}
          >
            Cancel
          </PillButton>
          <PillButton
            size="compact"
            variant={destructive ? "destructive" : "primary"}
            disabled={busy}
            onClick={() => onDecision("approve")}
          >
            {busy ? <Spinner className="size-3.5" /> : null}
            Confirm
          </PillButton>
        </div>
      ) : null}
    </OperationalPanel>
  );
}
