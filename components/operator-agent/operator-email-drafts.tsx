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
  EmailHeaderAttachments,
  EmailStackFrame,
  EmailStackRow,
  formatEmailAddressList,
} from "@/components/agent-thread/artifacts/email";
import {
  ChatArtifact,
  ChatArtifactMeta,
  ChatArtifactMetaRow,
} from "@/components/chat/artifact";
import { ChatAttachmentList } from "@/components/chat/attachment-chip";
import { PillButton } from "@/components/ui/pill-button";
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

/** One draft as a compact card: label and status, subject, recipients, a line of body. */
function DraftCard({
  draft,
  threadId,
  onOpen,
}: {
  draft: OperatorEmailDraftView;
  threadId: string;
  onOpen: () => void;
}) {
  const status = draftStatus(draft);
  const preview = bodyPreview(draft.text);
  return (
    <EmailCardFrame>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full min-w-0 space-y-0.5 px-3 py-2 text-left"
      >
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span
            className={`min-w-0 truncate text-muted-foreground/55 ${typeStyle("caption.medium")}`}
          >
            {draft.organizationName
              ? `Email draft · ${draft.organizationName}`
              : "Email draft"}
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
          className={`block truncate text-foreground/90 ${typeStyle("body.medium")}`}
        >
          {draft.subject || "(no subject)"}
        </span>
        <span
          className={`block truncate text-muted-foreground/55 ${typeStyle("caption.default")}`}
        >
          {draft.sendBlockedReason ?? draftRecipients(draft)}
        </span>
        {preview ? (
          <span
            className={`block truncate text-muted-foreground/70 ${typeStyle("caption.default")}`}
          >
            {preview}
          </span>
        ) : null}
      </button>
      {draft.attachments.length > 0 ? (
        <div className="px-3 pb-2">
          <ChatAttachmentList
            attachments={draft.attachments}
            operatorThreadId={threadId}
            size="compact"
            collapseAfter={2}
          />
        </div>
      ) : null}
    </EmailCardFrame>
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
        <DraftCard
          draft={draft}
          threadId={threadId}
          onOpen={() => onOpen(draft)}
        />
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
    <ChatArtifact
      eyebrow={draft.organizationName ?? "Not linked to a client"}
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
      meta={
        <ChatArtifactMeta>
          <ChatArtifactMetaRow label="From" value={draft.from ?? null} />
          <ChatArtifactMetaRow label="To" value={formatEmailAddressList(draft.to)} />
          <ChatArtifactMetaRow label="Cc" value={formatEmailAddressList(draft.cc)} />
          <ChatArtifactMetaRow label="Bcc" value={formatEmailAddressList(draft.bcc)} />
          <ChatArtifactMetaRow
            label="Reply-To"
            value={formatEmailAddressList(draft.replyTo)}
          />
          <ChatArtifactMetaRow
            label="Updated"
            value={formatDisplayDateTime(draft.updatedAt)}
          />
          <EmailHeaderAttachments
            attachments={draft.attachments}
            operatorThreadId={threadId}
          />
        </ChatArtifactMeta>
      }
      footer={
        draft.status === "draft" && draft.sendBlockedReason ? (
          <p
            className={`min-w-0 text-muted-foreground/60 ${typeStyle("caption.default")}`}
          >
            {draft.sendBlockedReason}
          </p>
        ) : draft.status === "sent" && draft.teamEmailThreadId ? (
          <PillButton
            variant="secondary"
            size="xs"
            href={`/operator/inbox/${draft.teamEmailThreadId}`}
          >
            View in team inbox
          </PillButton>
        ) : null
      }
    >
      <EmailBodyPreview html={draft.html} text={draft.text} />
    </ChatArtifact>
  );
}
