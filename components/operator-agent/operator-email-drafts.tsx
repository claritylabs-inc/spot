"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { Trash2 } from "lucide-react";
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
import { ChatArtifact } from "@/components/chat/artifact";
import { ChatAttachmentList } from "@/components/chat/attachment-chip";
import {
  EmailComposeInput,
  EmailComposeRow,
} from "@/components/email/compose-fields";
import {
  DraftedBySpot,
  EmailComposerBar,
  EmailComposerNotes,
  FullEmailToggle,
  followUpsRequest,
  type FollowUps,
} from "@/components/email/email-composer";
import { AddressField, FromPicker } from "@/components/email/operator-address";
import {
  ReplyEditor,
  replyBlanks,
  type BlankSuggestion,
} from "@/components/inbox/reply-editor";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  OperatorEmailDraftStatus,
  OperatorEmailDraftView,
} from "@/lib/operator-email-draft";
import { useSharedValue } from "@/hooks/use-shared-value";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
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

/** What sending a draft starts besides the email: follow-ups, or a client information request. */
export function draftSendDetail(draft: OperatorEmailDraftView) {
  const cadence = draft.followUps?.cadence;
  const followUps = !draft.followUps
    ? null
    : cadence
      ? `${cadence.followUpCount} follow-up${cadence.followUpCount === 1 ? "" : "s"} every ${cadence.intervalBusinessDays} business days`
      : "Follow-ups on Spot's schedule";
  const parts = [
    draft.clientRequest ? "Client information request" : null,
    followUps,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : undefined;
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
  const detail = draftSendDetail(draft);
  return (
    <EmailCardFrame>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full min-w-0 space-y-0.5 px-3 py-2 text-left"
      >
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span
            className={`min-w-0 truncate text-muted-foreground ${typeStyle("caption.medium")}`}
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
          className={`block truncate text-foreground ${typeStyle("body.medium")}`}
        >
          {draft.subject || "(no subject)"}
        </span>
        <span
          className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
        >
          {draft.sendBlockedReason ?? draftRecipients(draft)}
        </span>
        {detail ? (
          <span
            className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {detail}
          </span>
        ) : null}
        {preview ? (
          <span
            className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
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
 * Full draft review in the right-hand artifact panel. An unsent draft opens in
 * the same composer as a team inbox reply: edits autosave, and Send approves
 * the exact draft shown.
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
  const cancel = useCancelDraft(draft.id);
  if (draft.status === "draft" && draft.editable)
    return (
      <OperatorEmailDraftComposer
        key={draft.id}
        draft={draft}
        threadId={threadId}
        onClose={onClose}
      />
    );
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
          <ActionPill
            type="button"
            size="compact"
            variant="ghost"
            disabled={cancel.cancelling}
            busy={cancel.cancelling}
            onClick={() => void cancel.run()}
          >
            Cancel draft
          </ActionPill>
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
    />
  );
}

function useCancelDraft(draftId: string) {
  const cancelDraft = useAction(api.actions.operatorEmailDrafts.cancel);
  const [cancelling, setCancelling] = useState(false);
  async function run() {
    setCancelling(true);
    try {
      await cancelDraft({ draftId: draftId as Id<"pendingEmails"> });
      toast.success("Email draft cancelled");
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to cancel email"));
    } finally {
      setCancelling(false);
    }
  }
  return { cancelling, run };
}

type DraftFields = {
  fromUserId: Id<"users">;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

function OperatorEmailDraftComposer({
  draft,
  threadId,
  onClose,
}: {
  draft: OperatorEmailDraftView;
  threadId: string;
  onClose: () => void;
}) {
  const updateDraft = useAction(api.actions.operatorEmailDrafts.update);
  const cancel = useCancelDraft(draft.id);
  const sendDraft = useAction(api.actions.operatorEmailDrafts.send);
  const draftId = draft.id as Id<"pendingEmails">;
  const scope = `email-draft:${draft.id}`;
  const operatorId = useCachedOperatorCurrent()?.user._id;
  const saved: DraftFields = {
    // A legacy draft with no signer is signed by whoever edits it.
    fromUserId: (draft.senderUserId ?? operatorId) as Id<"users">,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    body: draft.body,
  };
  const [fields, setFields] = useState(saved);
  const edit = (patch: Partial<DraftFields>) =>
    setFields((current) => ({ ...current, ...patch }));
  // Hand edits re-sign the draft as the sender picked here; the agent's
  // revisions come in live to every field not edited here since.
  const autoSave = useLocalFirstAutoSave({
    mutationName: `operatorEmailDrafts.update.${draft.id}`,
    args: fields,
    canSave: fields.to.length > 0 && Boolean(fields.fromUserId),
    flush: (next) =>
      updateDraft({
        draftId,
        fromUserId: next.fromUserId,
        to: next.to[0] ?? "",
        cc: next.cc,
        bcc: next.bcc,
        subject: next.subject,
        body: next.body,
      }),
    source: saved,
    adopt: setFields,
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Failed to save draft"),
  });
  const [followUps, setFollowUps] = useState<FollowUps | null>(draft.followUps);
  useSharedValue(`${scope}:follow-ups`, followUps, setFollowUps);
  const [sending, setSending] = useState(false);
  const busy = sending || cancel.cancelling;
  const blanks = replyBlanks(fields.body).length;
  // Send approves the draft as saved, so it waits for edits to land.
  const canSend =
    autoSave.status === "saved" &&
    !busy &&
    fields.to.length > 0 &&
    !draft.sendBlockedReason;

  async function send() {
    if (!canSend || blanks > 0) return;
    setSending(true);
    try {
      const result = await sendDraft({
        draftId,
        expectedFingerprint: draft.fingerprint,
        followUps: followUpsRequest(followUps),
      });
      toast.success(`Email sent to ${result.recipientEmail}`);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to send email"));
    } finally {
      setSending(false);
    }
  }

  return (
    <ChatArtifact
      eyebrow={draft.organizationName ?? "Not linked to a client"}
      title={fields.subject || "(no subject)"}
      status={
        <StatusTag
          tone={draftStatus(draft).tone}
          indicator={draftStatus(draft).indicator}
          className="shrink-0"
        >
          {draftStatus(draft).label}
        </StatusTag>
      }
      closeLabel="Close email draft"
      onClose={onClose}
      bodyClassName="p-0"
      footer={
        <EmailComposerBar
          className="w-full"
          blanks={blanks}
          sending={sending}
          canSend={canSend}
          onSend={() => void send()}
          followUps={{
            followKey: scope,
            value: followUps,
            disabled: busy,
            onChange: setFollowUps,
          }}
          note={draft.sendBlockedReason}
          actions={
            <PillButton
              size="compact"
              type="button"
              variant="ghost"
              label="Cancel draft"
              aria-label="Cancel draft"
              disabled={busy}
              onClick={() => void cancel.run()}
            >
              <Trash2 className="size-3.5" />
            </PillButton>
          }
        />
      }
    >
      <div data-collab-scope={scope}>
        <AutoSaveStatus status={autoSave.status} />
        <EmailComposeRow label="From">
          {fields.fromUserId ? (
            <FromPicker
              value={fields.fromUserId}
              disabled={busy}
              onChange={(fromUserId) => edit({ fromUserId })}
            />
          ) : null}
          <DraftedBySpot />
        </EmailComposeRow>
        <EmailComposeRow label="To">
          <AddressField
            label="To"
            max={1}
            value={fields.to}
            disabled={busy}
            onChange={(to) => edit({ to })}
          />
        </EmailComposeRow>
        <EmailComposeRow label="Cc">
          <AddressField
            label="Cc"
            value={fields.cc}
            disabled={busy}
            placeholder="Add people to copy"
            onChange={(cc) => edit({ cc })}
          />
        </EmailComposeRow>
        <EmailComposeRow label="Bcc">
          <AddressField
            label="Bcc"
            value={fields.bcc}
            disabled={busy}
            placeholder="Add people to copy privately"
            onChange={(bcc) => edit({ bcc })}
          />
        </EmailComposeRow>
        <EmailComposeRow label="Subject">
          <EmailComposeInput
            aria-label="Subject"
            maxLength={200}
            value={fields.subject}
            disabled={busy}
            onChange={(event) => edit({ subject: event.target.value })}
          />
        </EmailComposeRow>
        {draft.attachments.length ? (
          <EmailComposeRow label="Files">
            <ChatAttachmentList
              attachments={draft.attachments}
              operatorThreadId={threadId}
              size="compact"
              collapseAfter={2}
            />
          </EmailComposeRow>
        ) : null}
        <ReplyEditor
          placeholder="Write an email"
          value={fields.body}
          disabled={busy}
          className="[&_.ProseMirror]:min-h-48"
          scrollClassName="max-h-none"
          collabKey={`${scope}:body`}
          suggestions={NO_SUGGESTIONS}
          suggesting={false}
          onChange={(body) => edit({ body })}
          onFocusChange={() => {}}
          onSubmit={() => void send()}
          onEscape={() => {}}
        />
        {draft.clientRequest ? (
          <EmailComposerNotes>
            <p>
              Client information request: Spot adds the greeting and signature,
              and follow-ups stop when they reply or submit the form.
            </p>
          </EmailComposerNotes>
        ) : null}
        <FullEmailToggle followKey={scope} text={draft.text} />
      </div>
    </ChatArtifact>
  );
}

const NO_SUGGESTIONS: BlankSuggestion[] = [];

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
