"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import {
  EmailBodyPreview,
  EmailCardFrame,
  EmailCardSummary,
  EmailHeaderAttachments,
  EmailHeaderGrid,
  EmailHeaderRow,
  EmailStackFrame,
  EmailStackRow,
  formatEmailAddressList,
} from "@/components/agent-thread/artifacts/email";
import { ArtifactSidebar } from "@/components/agent-thread/artifacts/shell";
import { ChatAttachmentList } from "@/components/chat/attachment-chip";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDateTime } from "@/lib/date-format";
import type {
  OperatorEmailDraftStatus,
  OperatorEmailDraftView,
} from "@/lib/operator-email-draft";
import { typeStyle } from "@/lib/typography";
import type { OperatorAgentMessage } from "@/lib/operator-agent-api";

const MAX_DRAFT_MESSAGES = 50;

const DRAFT_STATUS: Record<
  OperatorEmailDraftStatus,
  { label: string } & StatusPresentation
> = {
  draft: { label: "Draft", tone: "warning", indicator: "draft" },
  pending: { label: "Sending", tone: "neutral", indicator: "waiting" },
  sent: { label: "Sent", tone: "success", indicator: "complete" },
  cancelled: { label: "Cancelled", tone: "danger", indicator: "cancelled" },
};

function draftStatus(draft: OperatorEmailDraftView) {
  return draft.status === "draft" && draft.sendBlockedReason
    ? ({ label: "Blocked", tone: "warning", indicator: "draft" } as const)
    : DRAFT_STATUS[draft.status];
}

function draftRecipients(draft: OperatorEmailDraftView) {
  const to = formatEmailAddressList(draft.to) ?? "No recipients";
  const cc = formatEmailAddressList(draft.cc);
  return cc ? `To ${to} · Cc ${cc}` : `To ${to}`;
}

function bodyPreview(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** Drafts for the newest agent turns in the thread, keyed by message id. */
export function useOperatorEmailDrafts(messages: OperatorAgentMessage[]) {
  const messageIds = useMemo(
    () =>
      messages
        .filter((message) => message.role === "assistant")
        .slice(-MAX_DRAFT_MESSAGES)
        .map((message) => message.id as Id<"operatorAgentMessages">),
    [messages],
  );
  return useQuery(
    api.operatorEmailDrafts.listForMessages,
    messageIds.length > 0 ? { messageIds } : "skip",
  );
}

function DraftCardDetails({
  draft,
  threadId,
}: {
  draft: OperatorEmailDraftView;
  threadId: string;
}) {
  const status = draftStatus(draft);
  const preview = bodyPreview(draft.text);
  return (
    <div className="space-y-1.5 px-3 pb-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <StatusTag tone={status.tone} indicator={status.indicator}>
          {status.label}
        </StatusTag>
        {draft.sendBlockedReason ? (
          <span
            className={`min-w-0 truncate text-muted-foreground/55 ${typeStyle("caption.default")}`}
          >
            {draft.sendBlockedReason}
          </span>
        ) : null}
      </div>
      {preview ? (
        <p
          className={`line-clamp-2 break-words text-muted-foreground/70 ${typeStyle("body.default")}`}
        >
          {preview}
        </p>
      ) : null}
      {draft.attachments.length > 0 ? (
        <ChatAttachmentList
          attachments={draft.attachments}
          operatorThreadId={threadId}
          size="compact"
          collapseAfter={2}
        />
      ) : null}
    </div>
  );
}

/** Compact draft cards for one agent turn; several drafts share a stack. */
export function OperatorEmailDraftCards({
  drafts,
  threadId,
  openDraftId,
  onOpen,
}: {
  drafts: OperatorEmailDraftView[];
  threadId: string;
  openDraftId: string | null;
  onOpen: (draft: OperatorEmailDraftView) => void;
}) {
  if (drafts.length === 0) return null;
  if (drafts.length === 1) {
    const [draft] = drafts;
    return (
      <div className="mt-3">
        <EmailCardFrame>
          <EmailCardSummary
            label={
              draft.organizationName
                ? `Email draft · ${draft.organizationName}`
                : "Email draft"
            }
            subject={draft.subject || "(no subject)"}
            recipients={draftRecipients(draft)}
            onOpen={() => onOpen(draft)}
          />
          <DraftCardDetails draft={draft} threadId={threadId} />
        </EmailCardFrame>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <EmailStackFrame label={`${drafts.length} email drafts`}>
        {drafts.map((draft) => (
          <EmailStackRow
            key={draft.id}
            subject={draft.subject || "(no subject)"}
            recipients={draftRecipients(draft)}
            attachmentCount={draft.attachments.length}
            status={draftStatus(draft)}
            isOpen={openDraftId === draft.id}
            onOpen={() => onOpen(draft)}
          />
        ))}
      </EmailStackFrame>
    </div>
  );
}

/** Full draft review in the right-hand artifact panel. Sending goes through approval. */
export function OperatorEmailDraftPanel({
  draft,
  threadId,
  onClose,
}: {
  draft: OperatorEmailDraftView;
  threadId: string;
  onClose: () => void;
}) {
  const status = draftStatus(draft);
  return (
    <ArtifactSidebar
      title={draft.subject || "(no subject)"}
      status={
        <StatusTag
          indicator={status.indicator}
          tone={status.tone}
          className="shrink-0"
        >
          {status.label}
        </StatusTag>
      }
      closeLabel="Close email draft"
      onClose={onClose}
      header={
        <EmailHeaderGrid>
          <EmailHeaderRow label="From" value={draft.from ?? null} />
          <EmailHeaderRow label="To" value={formatEmailAddressList(draft.to)} />
          <EmailHeaderRow label="Cc" value={formatEmailAddressList(draft.cc)} />
          <EmailHeaderRow label="Bcc" value={formatEmailAddressList(draft.bcc)} />
          <EmailHeaderRow
            label="Client"
            value={draft.organizationName ?? null}
          />
          <EmailHeaderRow
            label="Updated"
            value={formatDisplayDateTime(draft.updatedAt)}
          />
          <EmailHeaderAttachments
            attachments={draft.attachments}
            operatorThreadId={threadId}
          />
        </EmailHeaderGrid>
      }
      footer={
        draft.status === "draft" ? (
          <p
            className={`min-w-0 text-muted-foreground/60 ${typeStyle("caption.default")}`}
          >
            {draft.sendBlockedReason ??
              "Ask Spot to send it. You will be asked to approve the exact email."}
          </p>
        ) : null
      }
    >
      <EmailBodyPreview html={draft.html} text={draft.text} />
    </ArtifactSidebar>
  );
}
