"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { Mail as MailIcon } from "lucide-react";
import { toast } from "sonner";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import {
  EmailArtifact,
  EmailCardFrame,
  EmailCardSummary,
  EmailStackFrame,
  EmailStackRow,
  formatEmailAddressList,
} from "@/components/agent-thread/artifacts/email";
import { ActionPill } from "@/components/agent-thread/artifacts/shell";
import { ChatAttachmentList } from "@/components/chat/attachment-chip";
import { parseEmailAddressList } from "@/components/email/compose-fields";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  OperatorEmailDraftStatus,
  OperatorEmailDraftView,
} from "@/lib/operator-email-draft";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
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

/**
 * Full draft review in the right-hand artifact panel. The signing operator can
 * revise, cancel or send it by hand; Send approves the exact draft shown.
 */
export function OperatorEmailDraftPanel({
  draft,
  threadId,
  onClose,
}: {
  draft: OperatorEmailDraftView;
  threadId: string;
  onClose: () => void;
}) {
  const updateDraft = useAction(api.actions.operatorEmailDrafts.update);
  const cancelDraft = useAction(api.actions.operatorEmailDrafts.cancel);
  const sendDraft = useAction(api.actions.operatorEmailDrafts.send);
  const [busy, setBusy] = useState<"cancel" | "send" | null>(null);
  const draftId = draft.id as Id<"pendingEmails">;

  async function send() {
    setBusy("send");
    try {
      const result = await sendDraft({
        draftId,
        expectedFingerprint: draft.fingerprint,
      });
      toast.success(`Email sent to ${result.recipientEmail}`);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to send email"));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy("cancel");
    try {
      await cancelDraft({ draftId });
      toast.success("Email draft cancelled");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to cancel email"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <EmailArtifact
      eyebrow={draft.organizationName ?? "Not linked to a client"}
      subject={draft.subject || "(no subject)"}
      status={draftStatus(draft)}
      closeLabel="Close email draft"
      onClose={onClose}
      from={draft.from}
      to={draft.to}
      cc={draft.cc}
      bcc={draft.bcc}
      replyTo={draft.replyTo}
      time={{ label: "Created", value: draft.updatedAt }}
      attachments={draft.attachments}
      operatorThreadId={threadId}
      html={draft.html}
      text={draft.text}
      note={draft.status === "draft" ? draft.sendBlockedReason : undefined}
      actions={
        draft.status === "draft" ? (
          <>
            <ActionPill
              type="button"
              size="compact"
              variant="ghost"
              disabled={busy !== null}
              busy={busy === "cancel"}
              onClick={() => void cancel()}
            >
              Cancel draft
            </ActionPill>
            {draft.editable && !draft.sendBlockedReason ? (
              <ActionPill
                type="button"
                size="compact"
                variant="primary"
                disabled={busy !== null}
                busy={busy === "send"}
                icon={MailIcon}
                onClick={() => void send()}
              >
                Send
              </ActionPill>
            ) : null}
          </>
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
      edit={
        draft.editable
          ? {
              draft: {
                to: draft.to.join(", "),
                cc: draft.cc.join(", "),
                bcc: draft.bcc.join(", "),
                subject: draft.subject,
                body: draft.body,
              },
              onSave: async (edited) => {
                await updateDraft({
                  draftId,
                  to: edited.to.trim(),
                  cc: parseEmailAddressList(edited.cc),
                  bcc: parseEmailAddressList(edited.bcc),
                  subject: edited.subject,
                  body: edited.body,
                });
              },
            }
          : undefined
      }
    />
  );
}

type ThreadReplyDraft = { threadId: string; reply: string };

/** Reply drafts the agent wrote into team inbox threads this turn, newest per thread. */
export function threadReplyDrafts(
  toolCalls: OperatorAgentMessage["toolCalls"],
): ThreadReplyDraft[] {
  const byThread = new Map<string, ThreadReplyDraft>();
  for (const call of toolCalls ?? []) {
    if (call.name !== "update_team_reply_draft" || !call.input) continue;
    try {
      const input = JSON.parse(call.input) as {
        teamEmailThreadId?: unknown;
        reply?: unknown;
      };
      if (
        typeof input.teamEmailThreadId === "string" &&
        typeof input.reply === "string"
      )
        byThread.set(input.teamEmailThreadId, {
          threadId: input.teamEmailThreadId,
          reply: input.reply,
        });
    } catch {
      continue;
    }
  }
  return [...byThread.values()];
}

/** Cards that open the inbox thread holding a reply the agent drafted. */
export function OperatorThreadReplyCards({
  drafts,
}: {
  drafts: ThreadReplyDraft[];
}) {
  const router = useRouter();
  if (drafts.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {drafts.map((draft) => (
        <EmailCardFrame key={draft.threadId}>
          <EmailCardSummary
            label="Reply draft"
            subject="Open the thread to review and send"
            recipients={bodyPreview(draft.reply)}
            onOpen={() => router.push(`/operator/inbox/${draft.threadId}`)}
          />
        </EmailCardFrame>
      ))}
    </div>
  );
}
