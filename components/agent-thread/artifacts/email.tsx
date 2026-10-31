"use client";

import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import { Mail as MailIcon, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PillButton } from "@/components/ui/pill-button";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import {
  StatusTag,
  type StatusPresentation,
} from "@claritylabs-inc/ui/components/status-tag";
import { ChatAttachmentList } from "@/components/chat/attachment-chip";
import { LinkedText } from "@/components/email/linked-text";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";
import type { ThreadMessage } from "../types";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import {
  ChatArtifact,
  ChatArtifactMeta,
  ChatArtifactMetaRow,
} from "@/components/chat/artifact";
import { ActionPill } from "./shell";

type PendingEmailAction = "send" | "cancel" | "restore";

const PENDING_EMAIL_ACTIONS: Record<
  PendingEmailAction,
  { status: "sent" | "cancelled" | "draft"; success: string; failure: string }
> = {
  send: { status: "sent", success: "Email sent", failure: "Failed to send email" },
  cancel: {
    status: "cancelled",
    success: "Email draft cancelled",
    failure: "Failed to cancel email",
  },
  restore: {
    status: "draft",
    success: "Email restored as draft",
    failure: "Failed to restore email",
  },
};

/**
 * Pending-email record plus send/cancel/restore actions that keep the named
 * cache in step with the server. Each caller uses its own cache name.
 */
export function usePendingEmailActions(
  cacheKey: "summary" | "detail" | "countdown",
  pendingEmailId: Id<"pendingEmails"> | undefined,
) {
  const cacheName = `pendingEmails.get.${cacheKey}`;
  const pendingEmail = useCachedQuery(
    cacheName,
    api.pendingEmails.get,
    pendingEmailId ? { id: pendingEmailId } : "skip",
  );
  const updatePendingEmail = useUpdateCachedQuery<
    typeof pendingEmail,
    { id: Id<"pendingEmails"> }
  >(cacheName);
  const sendDraft = useAction(api.actions.sendPendingEmail.sendDraftNow);
  const cancelDraft = useMutation(api.pendingEmails.cancel);
  const restoreDraft = useMutation(api.pendingEmails.restoreAsDraft);
  const [busy, setBusy] = useState<PendingEmailAction | null>(null);

  async function run(
    action: PendingEmailAction,
    messages: { success?: string; failure?: string } = {},
  ) {
    if (!pendingEmailId) return;
    const id = pendingEmailId;
    const spec = PENDING_EMAIL_ACTIONS[action];
    setBusy(action);
    try {
      let success = messages.success ?? spec.success;
      if (action === "send") {
        const result = await sendDraft({ id });
        success = `Email sent to ${result.recipientEmail}`;
      } else if (action === "cancel") {
        await cancelDraft({ id });
      } else {
        await restoreDraft({ id });
      }
      await updatePendingEmail({ id }, (current) =>
        current ? { ...current, status: spec.status } : current,
      );
      toast.success(success);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, messages.failure ?? spec.failure),
      );
    } finally {
      setBusy(null);
    }
  }

  return { pendingEmail, busy, run };
}

export function formatEmailAddressList(
  addresses: string[] | undefined,
): string | null {
  return addresses?.filter(Boolean).join(", ") || null;
}

function isSafeEmailPreviewUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return (
      ["http:", "https:", "mailto:"].includes(url.protocol) ||
      value.startsWith("data:image/")
    );
  } catch {
    return false;
  }
}

function sanitizeEmailPreviewHtml(html: string | undefined): string | null {
  if (!html || typeof window === "undefined") return null;
  const document = new DOMParser().parseFromString(html, "text/html");
  document
    .querySelectorAll("script, style, iframe, object, embed, link, meta")
    .forEach((node) => node.remove());
  document.body.querySelectorAll("*").forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith("on") || name === "srcset") {
        element.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "src") &&
        !isSafeEmailPreviewUrl(value)
      ) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (name === "style" && /\bexpression\s*\(|url\s*\(/i.test(value)) {
        element.removeAttribute(attr.name);
      }
    }
    if (element instanceof HTMLAnchorElement) {
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
  });
  return document.body.innerHTML;
}

export function EmailBodyPreview({ html, text }: { html?: string; text: string }) {
  const safeHtml = useMemo(() => sanitizeEmailPreviewHtml(html), [html]);

  if (safeHtml) {
    return (
      <div
        className={`break-words text-foreground/90 [overflow-wrap:anywhere] [&_a]:text-primary-light [&_a]:underline [&_img]:inline-block [&_img]:align-middle [&_li+li]:mt-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${typeStyle("body.default")}`}
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    );
  }

  return (
    <div className={`whitespace-pre-wrap break-words text-foreground/90 [overflow-wrap:anywhere] ${typeStyle("body.default")}`}>
      <LinkedText text={text} />
    </div>
  );
}

export function EmailHeaderAttachments({
  attachments,
  threadId,
  operatorThreadId,
}: {
  attachments: Array<{ filename: string; contentType?: string; fileId?: Id<"_storage"> }> | undefined;
  threadId?: Id<"threads">;
  operatorThreadId?: string;
}) {
  if (!attachments?.length) return null;
  return (
    <ChatArtifactMetaRow
      label="Attachments"
      value={
        <ChatAttachmentList
          attachments={attachments}
          threadId={threadId}
          operatorThreadId={operatorThreadId}
          size="compact"
          collapseAfter={2}
        />
      }
    />
  );
}

/** Bordered card shell shared by single email summary cards. */
export function EmailCardFrame({
  compact = false,
  children,
}: {
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <OperationalPanel
      as="div"
      className={`${compact ? "mt-2" : ""} w-fit min-w-[min(16rem,100%)] max-w-[min(28rem,100%)] transition-colors hover:bg-muted/50 sm:min-w-[min(18rem,100%)]`}
    >
      {children}
    </OperationalPanel>
  );
}

/** Clickable summary block: kind label, subject and recipients, plus optional extras. */
export function EmailCardSummary({
  label,
  subject,
  recipients,
  onOpen,
  children,
}: {
  label: string;
  subject: string;
  recipients: string;
  onOpen?: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full min-w-0 px-3 py-2.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-muted-foreground ${typeStyle("caption.medium")}`}>
          {label}
        </span>
        <span className={`block truncate text-foreground ${typeStyle("body.medium")}`}>
          {subject}
        </span>
        <span className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}>
          {recipients}
        </span>
        {children}
      </span>
    </button>
  );
}

/** Container for several emails with a title row and divided rows. */
export function EmailStackFrame({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <OperationalPanel as="div" className="max-w-md">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <p className={`min-w-0 truncate text-foreground/90 ${typeStyle("body.default")}`}>
          {label}
        </p>
        {action}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </OperationalPanel>
  );
}

export function EmailStackRow({
  subject,
  recipients,
  attachmentCount,
  status,
  isOpen,
  onOpen,
}: {
  subject: string;
  recipients: string;
  attachmentCount: number;
  status: { label: string } & StatusPresentation;
  isOpen: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`block w-full min-w-0 px-3 py-2.5 text-left transition-colors ${
        isOpen ? "bg-muted" : "hover:bg-muted/50"
      }`}
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className={`block truncate text-foreground ${typeStyle("body.medium")}`}>
            {subject}
          </span>
          <span className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}>
            {recipients}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {attachmentCount > 0 ? (
            <span className={`text-muted-foreground/45 ${typeStyle("caption.default")}`}>
              {attachmentCount} file{attachmentCount === 1 ? "" : "s"}
            </span>
          ) : null}
          <StatusTag tone={status.tone} indicator={status.indicator}>
            {status.label}
          </StatusTag>
        </span>
      </span>
    </button>
  );
}

function emailRecipients(message: ThreadMessage) {
  return message.toAddresses?.length
    ? message.toAddresses.join(", ")
    : (message.fromEmail ?? "Email");
}

function emailPreview(message: ThreadMessage) {
  return (
    message.subject ||
    message.content.split(/\n+/).find((line) => line.trim()) ||
    "Email"
  );
}

function emailStatus(
  message: ThreadMessage,
): { label: string; summary: string } & StatusPresentation {
  if (message.status === "draft_email")
    return { label: "Draft", summary: "Email draft", tone: "warning", indicator: "draft" };
  if (message.status === "cancelled")
    return { label: "Cancelled", summary: "Email cancelled", tone: "danger", indicator: "cancelled" };
  if (message.role === "agent")
    return { label: "Sent", summary: "Email sent", tone: "success", indicator: "complete" };
  return { label: "Email", summary: "Email received", tone: "neutral", indicator: "complete" };
}

export function EmailSummaryCard({
  message,
  onOpen,
  compact = false,
  isOpen = false,
}: {
  message: ThreadMessage;
  onOpen?: (message: ThreadMessage) => void;
  compact?: boolean;
  isOpen?: boolean;
}) {
  const { pendingEmail, busy, run } = usePendingEmailActions(
    "summary",
    message.pendingEmailId,
  );
  const canQuickSend =
    message.status === "draft_email" && pendingEmail?.status === "draft";
  const isCancelled =
    message.status === "cancelled" || pendingEmail?.status === "cancelled";
  const canRestore = message.pendingEmailId && isCancelled;
  const reviewLabel = canQuickSend
    ? "Review draft"
    : isCancelled
      ? "View cancelled email"
      : "View sent email";

  return (
    <EmailCardFrame compact={compact}>
      <EmailCardSummary
        label={emailStatus(message).summary}
        subject={emailPreview(message)}
        recipients={emailRecipients(message)}
        onOpen={() => onOpen?.(message)}
      />
      {isOpen ? null : (
        <div className="flex items-center justify-end gap-1.5 border-t border-border px-3 py-2.5">
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={() => onOpen?.(message)}
          >
            {reviewLabel}
          </PillButton>
          {canQuickSend ? (
            <ActionPill
              type="button"
              size="compact"
              variant="primary"
              onClick={() => void run("send")}
              disabled={busy === "send"}
              busy={busy === "send"}
              icon={MailIcon}
            >
              Send
            </ActionPill>
          ) : null}
          {canRestore ? (
            <ActionPill
              type="button"
              size="compact"
              variant="primary"
              onClick={() => void run("restore")}
              disabled={busy === "restore"}
              busy={busy === "restore"}
              icon={RotateCcw}
            >
              Restore
            </ActionPill>
          ) : null}
        </div>
      )}
    </EmailCardFrame>
  );
}

export function EmailStackCard({
  messages,
  onOpen,
  isOpenMessageId,
}: {
  messages: ThreadMessage[];
  onOpen?: (message: ThreadMessage) => void;
  isOpenMessageId?: Id<"threadMessages"> | null;
}) {
  const sendDrafts = useAction(api.actions.sendPendingEmail.sendDraftsNow);
  const [isSendingAll, setIsSendingAll] = useState(false);
  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => a._creationTime - b._creationTime),
    [messages],
  );
  const draftPendingEmailIds = useMemo(
    () => [
      ...new Set(
        orderedMessages
          .filter(
            (message) =>
              message.status === "draft_email" && message.pendingEmailId,
          )
          .map((message) => message.pendingEmailId as Id<"pendingEmails">),
      ),
    ],
    [orderedMessages],
  );
  const draftCount = draftPendingEmailIds.length;
  const stackLabel =
    draftCount === orderedMessages.length
      ? `${orderedMessages.length} email drafts`
      : `${orderedMessages.length} emails`;

  async function handleSendAll() {
    if (draftPendingEmailIds.length === 0) return;
    setIsSendingAll(true);
    try {
      const result = await sendDrafts({ ids: draftPendingEmailIds });
      const sent = `${result.sent.length} email${result.sent.length === 1 ? "" : "s"}`;
      if (result.failed.length > 0) {
        toast.error(`Sent ${sent}; ${result.failed.length} failed.`);
      } else {
        toast.success(`Sent ${sent}.`);
      }
    } catch (err) {
      toast.error(getUserFacingErrorMessage(err, "Failed to send emails"));
    } finally {
      setIsSendingAll(false);
    }
  }

  if (orderedMessages.length === 1) {
    const [message] = orderedMessages;
    return (
      <EmailSummaryCard
        message={message}
        onOpen={onOpen}
        compact
        isOpen={isOpenMessageId === message._id}
      />
    );
  }

  return (
    <EmailStackFrame
      label={stackLabel}
      action={
        draftCount > 1 ? (
          <ActionPill
            type="button"
            size="compact"
            variant="primary"
            onClick={handleSendAll}
            disabled={isSendingAll}
            busy={isSendingAll}
            icon={MailIcon}
          >
            Send all
          </ActionPill>
        ) : null
      }
    >
      {orderedMessages.map((message) => (
        <EmailStackRow
          key={message._id}
          subject={emailPreview(message)}
          recipients={emailRecipients(message)}
          attachmentCount={message.attachments?.length ?? 0}
          status={emailStatus(message)}
          isOpen={isOpenMessageId === message._id}
          onOpen={() => onOpen?.(message)}
        />
      ))}
    </EmailStackFrame>
  );
}

/** One email in the chat artifact panel: subject and status, mail headers, the body, and actions. */
export function EmailArtifact({
  eyebrow,
  subject,
  status,
  closeLabel,
  onClose,
  from,
  to,
  cc,
  bcc,
  replyTo,
  time,
  attachments,
  threadId,
  operatorThreadId,
  html,
  text,
  note,
  actions,
}: {
  eyebrow?: ReactNode;
  subject: string;
  status: { label: string } & StatusPresentation;
  closeLabel: string;
  onClose: () => void;
  from?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  time: { label: string; value: number };
  attachments?: ComponentProps<typeof EmailHeaderAttachments>["attachments"];
  threadId?: Id<"threads">;
  operatorThreadId?: string;
  html?: string;
  text: string;
  /** Muted line at the start of the action bar, e.g. why a draft cannot be sent. */
  note?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <ChatArtifact
      eyebrow={eyebrow}
      title={subject}
      status={
        <StatusTag
          indicator={status.indicator}
          tone={status.tone}
          className="shrink-0"
        >
          {status.label}
        </StatusTag>
      }
      closeLabel={closeLabel}
      onClose={onClose}
      footer={
        note || actions ? (
          <>
            {note ? (
              <p
                className={`mr-auto min-w-0 text-muted-foreground/60 ${typeStyle("caption.default")}`}
              >
                {note}
              </p>
            ) : null}
            {actions}
          </>
        ) : null
      }
      meta={
        <ChatArtifactMeta>
          <ChatArtifactMetaRow label="From" value={from} />
          <ChatArtifactMetaRow label="To" value={formatEmailAddressList(to)} />
          <ChatArtifactMetaRow label="Cc" value={formatEmailAddressList(cc)} />
          <ChatArtifactMetaRow label="Bcc" value={formatEmailAddressList(bcc)} />
          <ChatArtifactMetaRow
            label="Reply-To"
            value={formatEmailAddressList(replyTo)}
          />
          <ChatArtifactMetaRow
            label={time.label}
            value={formatDisplayDateTime(time.value)}
          />
          <EmailHeaderAttachments
            attachments={attachments}
            threadId={threadId}
            operatorThreadId={operatorThreadId}
          />
        </ChatArtifactMeta>
      }
    >
      <EmailBodyPreview html={html} text={text} />
    </ChatArtifact>
  );
}

export function EmailThreadSidebar({
  message,
  onClose,
}: {
  message: ThreadMessage | null;
  onClose: () => void;
}) {
  const { pendingEmail, busy, run } = usePendingEmailActions(
    "detail",
    message?.pendingEmailId,
  );

  if (!message) return null;
  const isDraft =
    message.status === "draft_email" && pendingEmail?.status === "draft";
  const isSent = pendingEmail?.status === "sent" || !!message.responseMessageId;
  const isCancelled =
    pendingEmail?.status === "cancelled" || message.status === "cancelled";
  const status: { label: string } & StatusPresentation = isDraft
    ? { label: "Draft", tone: "warning", indicator: "draft" }
    : isCancelled
      ? { label: "Cancelled", tone: "danger", indicator: "cancelled" }
      : { label: isSent ? "Sent" : "Email", tone: isSent ? "success" : "neutral", indicator: "complete" };
  const fromLine =
    pendingEmail?.fromHeader ??
    (message.fromEmail
      ? message.fromName
        ? `${message.fromName} <${message.fromEmail}>`
        : message.fromEmail
      : null);

  return (
    <EmailArtifact
      subject={
        pendingEmail?.subject || message.subject ||
          (message.role === "agent" ? "Sent email" : "Received email")
      }
      status={status}
      closeLabel="Close email"
      onClose={onClose}
      from={fromLine}
      to={pendingEmail ? [pendingEmail.recipientEmail] : message.toAddresses}
      cc={pendingEmail ? pendingEmail.ccAddresses : message.ccAddresses}
      bcc={pendingEmail ? pendingEmail.bccAddresses : message.bccAddresses}
      time={{ label: "Time", value: message._creationTime }}
      attachments={pendingEmail ? pendingEmail.attachments : message.attachments}
      threadId={message.threadId}
      html={pendingEmail?.renderedHtml}
      text={pendingEmail?.renderedText ?? pendingEmail?.emailBody ?? message.content}
      actions={
        isDraft ? (
          <>
            <ActionPill
              type="button"
              variant="ghost"
              size="compact"
              onClick={() => void run("cancel")}
              disabled={busy !== null}
              busy={busy === "cancel"}
              iconClassName="mr-1.5 h-3.5 w-3.5"
            >
              Cancel
            </ActionPill>
            <ActionPill
              type="button"
              size="compact"
              variant="primary"
              onClick={() => void run("send")}
              disabled={busy !== null}
              busy={busy === "send"}
              icon={MailIcon}
              iconClassName="mr-1.5 h-3.5 w-3.5"
            >
              Send Email
            </ActionPill>
          </>
        ) : isCancelled ? (
          <ActionPill
            type="button"
            size="compact"
            variant="primary"
            onClick={() => void run("restore")}
            disabled={busy === "restore"}
            busy={busy === "restore"}
            icon={RotateCcw}
            iconClassName="mr-1.5 h-3.5 w-3.5"
          >
            Restore draft
          </ActionPill>
        ) : null
      }
    />
  );
}
