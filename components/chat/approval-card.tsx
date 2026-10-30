"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, ChevronRight, Mail as MailIcon, Minus, X } from "lucide-react";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { Spinner } from "@claritylabs-inc/ui/components/spinner";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { DisclosurePanel } from "./disclosure";

export type ChatApprovalDecision = "approve" | "reject";

type ApprovalStatus = { label: string } & StatusPresentation;

/** Indented, left-ruled detail, as under a tool activity row. */
function ApprovalDetail({
  items,
  details,
  className,
}: {
  items?: string[];
  details: string[];
  className?: string;
}) {
  if (!items?.length && !details.length) return null;
  return (
    <div
      className={cn(
        "border-l-2 border-border pl-2.5 break-words text-muted-foreground",
        typeStyle("caption.default"),
        className,
      )}
    >
      {items?.length ? (
        <ul className="list-disc space-y-0.5 pl-4">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="whitespace-pre-line">{details.join("\n")}</p>
      )}
    </div>
  );
}

/** A non-email action waiting on approval, laid out like a tool activity row. */
export function ChatApprovalCard({
  status,
  title,
  items,
  actionable,
  destructive = false,
  busy,
  onDecision,
}: {
  status: ApprovalStatus;
  /** First line is the summary; later lines are details. */
  title: string;
  items?: string[];
  actionable: boolean;
  destructive?: boolean;
  busy: boolean;
  onDecision: (decision: ChatApprovalDecision) => void;
}) {
  const [summary, ...details] = title.split("\n");
  return (
    <OperationalPanel as="div" className="max-w-xl px-3.5 py-2.5">
      <div className="flex min-w-0 items-start gap-3">
        <p
          className={cn(
            "min-h-6 min-w-0 flex-1 py-px break-words text-foreground",
            typeStyle("body.default"),
          )}
        >
          {summary}
        </p>
        <StatusTag
          tone={status.tone}
          indicator={status.indicator}
          className="mt-0.5 shrink-0"
        >
          {status.label}
        </StatusTag>
      </div>
      <ApprovalDetail items={items} details={details} className="mt-1.5" />
      {actionable ? (
        <div className="mt-2.5 flex justify-end">
          <ChatApprovalActions
            destructive={destructive}
            busy={busy}
            onDecision={onDecision}
          />
        </div>
      ) : null}
    </OperationalPanel>
  );
}

/** An email waiting on approval, shown like an email draft card. */
export function ChatApprovalEmailCard({
  status,
  subject,
  recipients,
  detail,
  actionable,
  busy,
  isOpen,
  onOpen,
  onDecision,
}: {
  status: ApprovalStatus;
  subject: string;
  recipients: string;
  /** Extra line under the recipients, e.g. the follow-up cadence. */
  detail?: string;
  actionable: boolean;
  busy: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onDecision: (decision: ChatApprovalDecision) => void;
}) {
  return (
    <OperationalPanel as="div" className="w-fit max-w-md min-w-64 sm:min-w-72">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "block w-full min-w-0 px-3 py-2.5 text-left transition-colors",
          isOpen ? "bg-muted" : "hover:bg-muted/50",
        )}
      >
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span
            className={cn(
              "truncate text-muted-foreground",
              typeStyle("caption.medium"),
            )}
          >
            Email to send
          </span>
          <StatusTag
            tone={status.tone}
            indicator={status.indicator}
            className="shrink-0"
          >
            {status.label}
          </StatusTag>
        </span>
        <span
          className={cn("block truncate text-foreground", typeStyle("body.medium"))}
        >
          {subject || "(no subject)"}
        </span>
        <span
          className={cn(
            "block truncate text-muted-foreground",
            typeStyle("caption.default"),
          )}
        >
          {recipients}
        </span>
        {detail ? (
          <span
            className={cn(
              "block truncate text-muted-foreground",
              typeStyle("caption.default"),
            )}
          >
            {detail}
          </span>
        ) : null}
      </button>
      <div className="flex items-center justify-end gap-1.5 border-t border-border px-3 py-2.5">
        <PillButton
          type="button"
          size="compact"
          variant="secondary"
          onClick={onOpen}
        >
          Review
        </PillButton>
        {actionable ? (
          <ChatApprovalActions
            busy={busy}
            confirmLabel="Send"
            confirmIcon={<MailIcon className="size-3.5" />}
            onDecision={onDecision}
          />
        ) : null}
      </div>
    </OperationalPanel>
  );
}

function ReceiptIcon({ tone }: { tone: StatusPresentation["tone"] }) {
  const className = "size-3.5 shrink-0";
  if (tone === "success")
    return <Check aria-hidden className={cn(className, "text-success")} />;
  if (tone === "danger")
    return <X aria-hidden className={cn(className, "text-muted-foreground")} />;
  return (
    <Minus aria-hidden className={cn(className, "text-muted-foreground/70")} />
  );
}

/**
 * A decided approval, kept to one line. It expands to its details, or opens
 * its artifact when `onOpen` is given.
 */
export function ChatApprovalReceipt({
  status,
  title,
  items,
  context,
  onOpen,
  isOpen = false,
}: {
  status: ApprovalStatus;
  /** First line is the summary; later lines are details. */
  title: string;
  items?: string[];
  /** Muted text after the summary, e.g. an email's subject. */
  context?: string;
  onOpen?: () => void;
  isOpen?: boolean;
}) {
  const detailId = useId();
  const [expanded, setExpanded] = useState(false);
  const [summary, ...details] = title.split("\n");
  const expandable = !onOpen;
  const open = expandable ? expanded : isOpen;
  return (
    <div className="min-w-0 max-w-xl">
      <button
        type="button"
        aria-expanded={expandable ? expanded : undefined}
        aria-controls={expandable ? detailId : undefined}
        onClick={onOpen ?? (() => setExpanded(!expanded))}
        className={cn(
          "group -mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
          open && onOpen && "bg-muted",
          typeStyle("body.default"),
        )}
      >
        <ReceiptIcon tone={status.tone} />
        <span
          className={cn(
            "min-w-0 text-foreground/90",
            expanded ? "break-words" : "truncate",
          )}
        >
          {summary}
          {context ? (
            <span className="text-muted-foreground/70"> {context}</span>
          ) : null}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 whitespace-nowrap text-muted-foreground/70",
            typeStyle("caption.default"),
          )}
        >
          {status.label}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expandable ? (
        <DisclosurePanel id={detailId} open={expanded}>
          <ApprovalDetail
            items={items}
            details={details}
            className="mt-0.5 mb-1 ml-1.5"
          />
        </DisclosurePanel>
      ) : null}
    </div>
  );
}

/** Cancel / Confirm for an action awaiting the viewer's approval. */
export function ChatApprovalActions({
  destructive = false,
  busy,
  confirmLabel = "Confirm",
  confirmIcon,
  onDecision,
}: {
  destructive?: boolean;
  busy: boolean;
  confirmLabel?: string;
  confirmIcon?: ReactNode;
  onDecision: (decision: ChatApprovalDecision) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
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
        {busy ? <Spinner className="size-3.5" /> : confirmIcon}
        {confirmLabel}
      </PillButton>
    </div>
  );
}
