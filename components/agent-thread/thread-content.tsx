"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  Clock,
  Copy,
  ExternalLink,
  LockKeyhole,
  X,
} from "lucide-react";
import { SiSlack } from "react-icons/si";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PresentationReference } from "@/lib/chat-presentation";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { useMediaQuery } from "@/components/app-sidebar/utils";
import { stripConfidenceMarkers } from "@/lib/confidence";
import {
  useArchivedThreadCacheActions,
  useThreadCacheActions,
} from "@/lib/sync/spot-cached-queries";
import { PillButton } from "@/components/ui/pill-button";
import { EditableBreadcrumbTitle } from "@/components/editable-breadcrumb-title";
import { ChatComposer, type ChatComposerHandle } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatErrorNotice } from "@/components/chat/chat-message";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { NewChatEmptyState } from "@/components/new-chat-empty-state";
import { PromptReferenceText } from "@/components/prompt-reference-tag";
import { usePdf } from "@/components/pdf-context";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  optimisticPromptAttachments,
  promptReferenceIds,
  uploadPromptFiles,
} from "@/lib/thread-prompt";
import { getThreadDisplayLabel } from "@/lib/thread-display";
import type {
  MailboxArtifactRef,
  ThreadMessage,
  ToolArtifactData,
  VendorComplianceArtifactRef,
} from "./types";
import {
  EmailThreadSidebar,
  MailboxTaskSidebar,
  VendorComplianceSidebar,
} from "./artifacts";
import { ThreadContextLink, UnifiedMessageBubble } from "./thread-message";
import {
  assistantPdfAttachments,
  buildThreadMessageRenderPlan,
  isMessageFromViewer,
  latestOwnWebMessageReceipt,
  messageSenderName,
  threadMessageGroupingFingerprint,
  useStableMessages,
  type AssistantPdfAttachment,
} from "./thread-messages";
import { typeStyle } from "@/lib/typography";

export {
  assistantPdfAttachments,
  latestOwnWebMessageReceipt,
  threadMessageGroupingFingerprint,
  type AssistantPdfAttachment,
} from "./thread-messages";
export {
  UnifiedMessageBubble,
  ThreadContextLink,
  WebMessageReceipt,
} from "./thread-message";

function UnifiedThreadActions({
  threadId,
  thread,
  messages,
}: {
  threadId: Id<"threads">;
  thread: {
    title: string;
    archivedAt?: number;
    originChannel?: "chat" | "email" | "imessage" | "slack";
    threadEmail?: string;
  };
  messages?: ThreadMessage[];
}) {
  const archiveThread = useMutation(api.threads.archive);
  const unarchiveThread = useMutation(api.threads.unarchive);
  const { archiveThreadLocally, unarchiveThreadLocally } =
    useArchivedThreadCacheActions();
  const isArchived = !!thread.archivedAt;
  async function handleArchiveToggle() {
    try {
      if (isArchived) {
        await unarchiveThreadLocally(threadId);
        await unarchiveThread({ id: threadId });
        toast.success("Unarchived");
      } else {
        await archiveThreadLocally(threadId);
        await archiveThread({ id: threadId });
        toast.success("Archived");
      }
    } catch {
      toast.error("Failed to update");
    }
  }

  function handleCopyThread() {
    if (!messages || messages.length === 0) {
      toast.error("No messages to copy");
      return;
    }
    const lines: string[] = [];
    lines.push(`Thread: ${thread.title}`);
    lines.push(`Messages: ${messages.length}`);
    lines.push("─".repeat(50));
    for (const msg of messages) {
      if (msg.status === "processing") continue;
      const time = formatDisplayDateTime(msg._creationTime);
      const sender = msg.role === "agent" ? "Spot" : messageSenderName(msg);
      const channel =
        msg.channel === "email"
          ? " [Email]"
          : msg.channel === "imessage"
            ? " [iMessage]"
            : msg.channel === "slack"
              ? " [Slack]"
              : " [Chat]";
      lines.push("");
      lines.push(`${sender}${channel} — ${time}`);
      if (msg.operatorInitiated?.operatorEmail) {
        lines.push(`Operator: ${msg.operatorInitiated.operatorEmail}`);
      }
      if (msg.fromEmail) lines.push(`From: ${msg.fromEmail}`);
      if (msg.toAddresses?.length)
        lines.push(`To: ${msg.toAddresses.join(", ")}`);
      if (msg.ccAddresses?.length)
        lines.push(`CC: ${msg.ccAddresses.join(", ")}`);
      lines.push("");
      lines.push(stripConfidenceMarkers(msg.content));
      if (msg.attachments?.length) {
        lines.push(
          `Attachments: ${msg.attachments.map((a) => a.filename).join(", ")}`,
        );
      }
      lines.push("─".repeat(50));
    }
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Thread copied to clipboard");
  }

  return (
    <>
      <PillButton
        size="compact"
        variant="secondary"
        onClick={handleCopyThread}
        label="Copy thread"
        expandLabel
      >
        <Copy className="w-3.5 h-3.5" />
      </PillButton>
      <PillButton
        size="compact"
        variant={isArchived ? "secondary" : "destructive"}
        onClick={handleArchiveToggle}
        label={isArchived ? "Unarchive" : "Archive"}
        iconOnly
      >
        {isArchived ? (
          <ArchiveRestore className="w-4 h-4" />
        ) : (
          <Archive className="w-4 h-4" />
        )}
      </PillButton>
    </>
  );
}

/* ── Shared markdown container styles ── */
function slackConversationUrl(thread: {
  slackChannelId?: string;
  slackThreadTs?: string;
  slackConversationKind?: "channel" | "direct_message";
}) {
  if (!thread.slackChannelId) return undefined;
  if (
    thread.slackConversationKind === "direct_message" ||
    !thread.slackThreadTs
  ) {
    return `https://slack.com/app_redirect?channel=${encodeURIComponent(thread.slackChannelId)}`;
  }
  return `https://slack.com/archives/${encodeURIComponent(thread.slackChannelId)}/p${thread.slackThreadTs.replace(".", "")}`;
}

function QueuedThreadMessage({
  message,
  sending,
  onSendNow,
  onCancel,
}: {
  message: PromptInputMessage;
  sending: boolean;
  onSendNow: () => void;
  onCancel: () => void;
}) {
  const preview =
    message.text.trim() ||
    (message.files.length > 0
      ? `${message.files.length} attachment${message.files.length === 1 ? "" : "s"}`
      : "Message");
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-input bg-card px-2.5 py-2">
      <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
      <p className={`min-w-0 flex-1 truncate text-muted-foreground/55 ${typeStyle("caption.default")}`}>
        Queued:{" "}
        <PromptReferenceText
          content={preview}
          references={message.references ?? []}
          className="text-foreground/75"
        />
      </p>
      <PillButton
        type="button"
        size="compact"
        onClick={onSendNow}
        disabled={sending}
      >
        {sending ? "Sending" : "Send now"}
      </PillButton>
      <PillButton
        type="button"
        onClick={onCancel}
        disabled={sending}
        variant="icon"
        size="compact"
        label="Remove queued message"
      >
        <X className="h-3.5 w-3.5" />
      </PillButton>
    </div>
  );
}

/* ── Unified thread content ── */
export function UnifiedThreadContent({
  threadId,
  onMeta,
  onRightPanel,
  viewerId,
  viewerEmail,
}: {
  threadId: Id<"threads">;
  onMeta?: (meta: {
    detail: React.ReactNode;
    actions: React.ReactNode;
  }) => void;
  onRightPanel?: (panel: React.ReactNode | null) => void;
  viewerId?: string;
  viewerEmail?: string;
}) {
  const thread = useCachedQuery("threads.get.current", api.threads.get, {
    id: threadId,
  });
  const rawMessages = useCachedQuery(
    "threads.messages.current",
    api.threads.messages,
    { threadId },
  ) as ThreadMessage[] | undefined;
  const messages = useStableMessages(rawMessages);
  const mailboxReview = useCachedQuery(
    "connectedEmailAutomation.reviewForThread.current",
    api.connectedEmailAutomation.reviewForThread,
    { threadId },
  );
  const mailboxReviewArtifact = useMemo<ToolArtifactData | null>(
    () => mailboxReview ? { type: "mailbox_task", data: mailboxReview } : null,
    [mailboxReview],
  );
  const mailboxReviewMessageId = useMemo(
    () =>
      mailboxReviewArtifact
        ? messages?.find((message) => message.role === "agent")?._id
        : undefined,
    [mailboxReviewArtifact, messages],
  );
  const messageGroupingFingerprint = threadMessageGroupingFingerprint(
    threadId,
    messages ?? [],
  );
  const messageRenderPlan = useMemo(
    () => buildThreadMessageRenderPlan(messages ?? []),
    // Grouping inputs are immutable after settlement; processing content is
    // excluded so token updates do not rerun the grouping and dedupe pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messageGroupingFingerprint],
  );
  const visibleMessages = useMemo(
    () =>
      (messages ?? []).filter(
        (message) =>
          !messageRenderPlan.hiddenStatusMessageIds.has(message._id) &&
          !messageRenderPlan.attachedEmailMessageIds.has(message._id),
      ),
    [messageRenderPlan, messages],
  );
  const latestOwnReceipt = useMemo(
    () => latestOwnWebMessageReceipt(messages ?? [], viewerId, viewerEmail),
    [messages, viewerEmail, viewerId],
  );
  const mailboxReviewSourceMessage = mailboxReviewArtifact
    ? messages?.find((message) => message._id === mailboxReviewMessageId)
    : undefined;
  const mailboxReviewRenderedMessage = useMemo(
    () =>
      mailboxReviewArtifact && mailboxReviewSourceMessage
        ? {
            ...mailboxReviewSourceMessage,
            toolArtifacts: [
              ...(mailboxReviewSourceMessage.toolArtifacts ?? []),
              mailboxReviewArtifact,
            ],
          }
        : mailboxReviewSourceMessage,
    [mailboxReviewArtifact, mailboxReviewSourceMessage],
  );
  const pdf = usePdf();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const sendMessage = useMutation(api.threads.sendMessage);
  const { appendOptimisticSend, markOptimisticSendFailed } =
    useThreadCacheActions();
  const updateTitle = useMutation(api.threads.updateTitle);
  const generateUploadUrl = useMutation(api.threads.generateUploadUrl);
  const chatInputRef = useRef<ChatComposerHandle>(null);
  const lastAutoOpenedEmailId = useRef<string | null>(null);
  const autoOpenPdfThreadId = useRef<string | null>(null);
  const seenAssistantPdfKeys = useRef<Set<string>>(new Set());
  const openedAssistantPdfKey = useRef<string | null>(null);
  const [autoOpenPdfAttachment, setAutoOpenPdfAttachment] = useState<
    AssistantPdfAttachment | null
  >(null);
  const autoOpenPdfUrl = useCachedQuery(
    "threads.getAttachmentUrl.auto-open",
    api.threads.getAttachmentUrl,
    autoOpenPdfAttachment
      ? { threadId, fileId: autoOpenPdfAttachment.fileId }
      : "skip",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sendInFlight = useRef(false);
  const [queuedMessage, setQueuedMessage] = useState<PromptInputMessage | null>(
    null,
  );
  const [sendingQueuedNow, setSendingQueuedNow] = useState(false);
  const [openEmailMessageId, setOpenEmailMessageId] =
    useState<Id<"threadMessages"> | null>(null);
  const [openVendorComplianceArtifactRef, setOpenVendorComplianceArtifactRef] =
    useState<VendorComplianceArtifactRef | null>(null);
  const [openMailboxArtifactRef, setOpenMailboxArtifactRef] =
    useState<MailboxArtifactRef | null>(null);
  const handleOpenEmail = useCallback((message: ThreadMessage) => {
    setOpenVendorComplianceArtifactRef(null);
    setOpenMailboxArtifactRef(null);
    setOpenEmailMessageId(message._id);
  }, []);
  const handleOpenVendorCompliance = useCallback(
    (ref: VendorComplianceArtifactRef) => {
      setOpenEmailMessageId(null);
      setOpenMailboxArtifactRef(null);
      setOpenVendorComplianceArtifactRef(ref);
    },
    [],
  );
  const handleOpenMailboxArtifact = useCallback((ref: MailboxArtifactRef) => {
    setOpenEmailMessageId(null);
    setOpenVendorComplianceArtifactRef(null);
    setOpenMailboxArtifactRef(ref);
  }, []);
  const openEmailMessage = useMemo(
    () =>
      messages?.find((message) => message._id === openEmailMessageId) ?? null,
    [messages, openEmailMessageId],
  );
  const openVendorComplianceArtifact = useMemo(() => {
    if (!openVendorComplianceArtifactRef) return null;
    const message = messages?.find(
      (candidate) =>
        candidate._id === openVendorComplianceArtifactRef.messageId,
    );
    const artifacts =
      message?.toolArtifacts?.filter(
        (artifact) => artifact.type === "vendor_compliance",
      ) ?? [];
    return artifacts[openVendorComplianceArtifactRef.index] ?? null;
  }, [messages, openVendorComplianceArtifactRef]);
  const openMailboxArtifact = useMemo(() => {
    if (!openMailboxArtifactRef) return null;
    const message = messages?.find(
      (candidate) => candidate._id === openMailboxArtifactRef.messageId,
    );
    const storedArtifacts =
      message?.toolArtifacts?.filter(
        (artifact) => artifact.type === "mailbox_task",
      ) ?? [];
    const artifacts =
      mailboxReviewArtifact && message?._id === mailboxReviewMessageId
        ? [...storedArtifacts, mailboxReviewArtifact]
        : storedArtifacts;
    const artifact = artifacts[openMailboxArtifactRef.index];
    return artifact
      ? {
          artifact,
          orgId: message?.orgId,
          threadId: message?.threadId,
          emailIndex: openMailboxArtifactRef.emailIndex,
        }
      : null;
  }, [
    mailboxReviewArtifact,
    mailboxReviewMessageId,
    messages,
    openMailboxArtifactRef,
  ]);

  // Error state for chat — stored as { threadId, message } so switching threads auto-clears it
  const [chatErrorState, setChatErrorState] = useState<{
    threadId: string;
    message: string;
  } | null>(null);
  const chatError =
    chatErrorState?.threadId === threadId ? chatErrorState.message : null;
  const setChatError = useCallback(
    (msg: string | null) =>
      setChatErrorState(msg ? { threadId, message: msg } : null),
    [threadId],
  );

  // Push title + actions to parent for AppShell header
  useEffect(() => {
    if (!thread || !onMeta) return;
    onMeta({
      detail: (
        <span className="inline-flex min-w-0 items-center gap-2">
          {thread.originChannel === "slack" ? (
            <SiSlack
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45"
              aria-label="Slack thread"
            />
          ) : null}
          <EditableBreadcrumbTitle
            key={threadId}
            title={getThreadDisplayLabel(thread)}
            saveKey={threadId}
            onSave={async (next) => {
              await updateTitle({ id: threadId, title: next });
            }}
          />
          {thread.originChannel === "slack" &&
          thread.visibility === "user_private" ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1 text-muted-foreground/45 ${typeStyle("caption.medium")}`}
              title="Only you can see this thread in Spot"
            >
              <LockKeyhole className="h-3 w-3" />
              Private
            </span>
          ) : null}
        </span>
      ),
      actions: (
        <UnifiedThreadActions
          threadId={threadId}
          thread={thread}
          messages={messages}
        />
      ),
    });
  }, [thread, threadId, onMeta, messages, updateTitle]);

  useEffect(() => {
    if (!onRightPanel) return;
    onRightPanel(
      openEmailMessage ? (
        <EmailThreadSidebar
          message={openEmailMessage}
          onClose={() => setOpenEmailMessageId(null)}
        />
      ) : openVendorComplianceArtifact ? (
        <VendorComplianceSidebar
          artifact={openVendorComplianceArtifact}
          onClose={() => setOpenVendorComplianceArtifactRef(null)}
        />
      ) : openMailboxArtifact?.artifact &&
        openMailboxArtifact.orgId &&
        openMailboxArtifact.threadId ? (
        <MailboxTaskSidebar
          key={`${openMailboxArtifactRef?.index ?? 0}:${openMailboxArtifact.emailIndex ?? "task"}`}
          artifact={openMailboxArtifact.artifact}
          orgId={openMailboxArtifact.orgId}
          threadId={openMailboxArtifact.threadId}
          emailIndex={openMailboxArtifact.emailIndex}
          onClose={() => setOpenMailboxArtifactRef(null)}
        />
      ) : null,
    );
    return () => onRightPanel(null);
  }, [
    onRightPanel,
    openEmailMessage,
    openVendorComplianceArtifact,
    openMailboxArtifact,
    openMailboxArtifactRef?.index,
  ]);

  // Reset thread-local panels when the selected thread changes.
  useEffect(() => {
    lastAutoOpenedEmailId.current = null;
    const frame = window.requestAnimationFrame(() => {
      setOpenEmailMessageId(null);
      setOpenVendorComplianceArtifactRef(null);
      setOpenMailboxArtifactRef(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [threadId]);

  useEffect(() => {
    const latestDraftEmail = messages
      ?.filter(
        (message) =>
          message.channel === "email" &&
          message.role === "agent" &&
          message.status === "draft_email",
      )
      .at(-1);
    if (!latestDraftEmail) return;
    if (lastAutoOpenedEmailId.current === latestDraftEmail._id) return;
    lastAutoOpenedEmailId.current = latestDraftEmail._id;
    setOpenVendorComplianceArtifactRef(null);
    setOpenMailboxArtifactRef(null);
    setOpenEmailMessageId(latestDraftEmail._id);
  }, [messages]);

  useEffect(() => {
    if (!messages) return;
    const attachments = assistantPdfAttachments(messages);
    if (autoOpenPdfThreadId.current !== threadId) {
      autoOpenPdfThreadId.current = threadId;
      seenAssistantPdfKeys.current = new Set(
        attachments.map((attachment) => attachment.key),
      );
      setAutoOpenPdfAttachment(null);
      return;
    }

    const unseen = attachments.filter(
      (attachment) => !seenAssistantPdfKeys.current.has(attachment.key),
    );
    for (const attachment of unseen) {
      seenAssistantPdfKeys.current.add(attachment.key);
    }
    if (!isDesktop || unseen.length === 0) return;
    setAutoOpenPdfAttachment(unseen.at(-1) ?? null);
  }, [isDesktop, messages, threadId]);

  useEffect(() => {
    if (!autoOpenPdfAttachment || !autoOpenPdfUrl || !isDesktop) return;
    if (openedAssistantPdfKey.current === autoOpenPdfAttachment.key) return;
    openedAssistantPdfKey.current = autoOpenPdfAttachment.key;
    pdf.openWithUrl(autoOpenPdfUrl);
  }, [autoOpenPdfAttachment, autoOpenPdfUrl, isDesktop, pdf]);

  const isAgentProcessing = useMemo(
    () =>
      messages?.some((m) => m.role === "agent" && m.status === "processing") ??
      false,
    [messages],
  );
  const isAwaitingAgent = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    const lastUserIndex = messages.reduce(
      (acc, m, i) => (m.role === "user" ? i : acc),
      -1,
    );
    const lastAgentIndex = messages.reduce(
      (acc, m, i) => (m.role === "agent" ? i : acc),
      -1,
    );
    return lastUserIndex > lastAgentIndex;
  }, [messages]);
  const isAgentActive = isAgentProcessing || isAwaitingAgent;
  const isInputBusy = isSubmitting || sendingQueuedNow;
  const inputBusyLabel = "Sending";

  const sendThreadMessage = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text && message.files.length === 0) return;
      if (!thread || sendInFlight.current) return;
      sendInFlight.current = true;
      setIsSubmitting(true);
      const content = text || "(attached files)";
      const clientMutationId = createClientMutationId("message");
      const referenceIds = promptReferenceIds(message.references);

      try {
        await appendOptimisticSend({
          threadId,
          orgId: thread.orgId,
          content,
          clientMutationId,
          userId: viewerId as Id<"users"> | undefined,
          userName: viewerEmail ?? "You",
          attachments: optimisticPromptAttachments(message.files),
          ...referenceIds,
        });
        setChatError(null);

        const attachments = await uploadPromptFiles(
          message.files,
          generateUploadUrl,
        );

        if (attachments.length > 0) {
          await sendMessage({
            threadId,
            content,
            attachments,
            ...referenceIds,
            clientMutationId,
          });
          return;
        }

        await sendMessage({
          threadId,
          content,
          ...referenceIds,
          clientMutationId,
        });
      } catch (error) {
        const message = getUserFacingErrorMessage(
          error,
          "Failed to send message",
        );
        await markOptimisticSendFailed({
          threadId,
          clientMutationId,
          error: message,
        });
        setChatError(message);
        toast.error("Failed to send message");
      } finally {
        sendInFlight.current = false;
        setIsSubmitting(false);
      }
    },
    [
      appendOptimisticSend,
      generateUploadUrl,
      markOptimisticSendFailed,
      sendMessage,
      setChatError,
      thread,
      threadId,
      viewerEmail,
      viewerId,
    ],
  );

  const handleSend = useCallback(
    (message: PromptInputMessage) => {
      if (isAgentActive) {
        setQueuedMessage(message);
        return;
      }
      if (isInputBusy) return;
      void sendThreadMessage(message);
    },
    [isAgentActive, isInputBusy, sendThreadMessage],
  );

  const sendQueuedNow = useCallback(async () => {
    if (!queuedMessage || sendingQueuedNow) return;
    setSendingQueuedNow(true);
    const message = queuedMessage;
    setQueuedMessage(null);
    try {
      await sendThreadMessage(message);
    } finally {
      setSendingQueuedNow(false);
    }
  }, [queuedMessage, sendThreadMessage, sendingQueuedNow]);

  useEffect(() => {
    if (!queuedMessage || isAgentActive || isSubmitting || sendingQueuedNow)
      return;
    const message = queuedMessage;
    const timeout = window.setTimeout(() => {
      setQueuedMessage(null);
      void sendThreadMessage(message);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    isAgentActive,
    isSubmitting,
    queuedMessage,
    sendThreadMessage,
    sendingQueuedNow,
  ]);

  const sendPresentationFollowUp = useCallback(
    async (content: string, selectedReferences?: PresentationReference[]) => {
      if (
        !thread || thread.archivedAt || thread.originChannel === "slack" ||
        isAgentActive || isInputBusy || sendInFlight.current || queuedMessage
      ) {
        throw new Error("Wait for the current task to finish.");
      }
      sendInFlight.current = true;
      setIsSubmitting(true);
      try {
        await sendMessage({
          threadId,
          content,
          ...promptReferenceIds(selectedReferences?.flatMap(reference =>
            reference.kind === "policy" || reference.kind === "requirement"
              ? [{ kind: reference.kind, id: reference.recordId, label: reference.label }]
              : [],
          )),
          clientMutationId: createClientMutationId("message"),
        });
      } finally {
        sendInFlight.current = false;
        setIsSubmitting(false);
      }
    },
    [thread, isAgentActive, isInputBusy, queuedMessage, sendMessage, threadId],
  );

  const collapseEmailMessages = thread?.originChannel !== "email";

  if (!thread) {
    return <div className="h-full" />;
  }
  const slackUrl = slackConversationUrl(thread);

  return (
    <ChatMessageList
      className="h-full"
      anchorKey={threadId}
      clearanceClassName={
        messages && messages.length > 0
          ? thread.originChannel === "slack" ? "h-24" : "h-40"
          : undefined
      }
      composer={
        thread.originChannel === "slack" ? (
          <div className="flex flex-col items-stretch gap-3 rounded-xl border border-input bg-background px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
                Continue this conversation in Slack.
              </p>
              {thread.visibility !== "user_private" ? (
                <p className={`mt-0.5 text-muted-foreground/55 ${typeStyle("caption.default")}`}>
                  New Slack replies stay synced to this client record.
                </p>
              ) : null}
            </div>
            {slackUrl ? (
              <PillButton
                href={slackUrl}
                target="_blank"
                rel="noreferrer"
                size="compact"
                variant="secondary"
                className="self-start sm:self-auto"
              >
                <SiSlack className="h-3.5 w-3.5" />
                Open in Slack
                <ExternalLink className="h-3 w-3" />
              </PillButton>
            ) : null}
          </div>
        ) : (
          <ChatComposer
            ref={chatInputRef}
            onSubmit={handleSend}
            placeholder="Reply to this thread..."
            showAttach
            disabled={isInputBusy}
            busy={isInputBusy}
            busyLabel={inputBusyLabel}
            orgId={thread.orgId}
            banner={queuedMessage ? (
              <QueuedThreadMessage
                message={queuedMessage}
                sending={sendingQueuedNow}
                onSendNow={sendQueuedNow}
                onCancel={() => setQueuedMessage(null)}
              />
            ) : undefined}
          />
        )
      }
    >
          {messages && messages.length === 0 && (
            <NewChatEmptyState
              orgId={thread.orgId}
              onSelectPrompt={(prompt) =>
                chatInputRef.current?.setValueAndFocus(prompt)
              }
            />
          )}
          {visibleMessages.map((msg) => {
            const renderedMessage =
              msg._id === mailboxReviewMessageId
                ? (mailboxReviewRenderedMessage ?? msg)
                : msg;
            const isFirstUser =
              msg._id === messageRenderPlan.firstUserMessageId;
            const firstUserIsOwn =
              isFirstUser && isMessageFromViewer(msg, viewerId, viewerEmail);
            const relatedEmailMessages =
              messageRenderPlan.relatedEmailsByMessageId.get(msg._id);
            const receiptStatus =
              latestOwnReceipt?.messageId === msg._id
                ? latestOwnReceipt.status
                : null;

            return (
              <div key={msg._id}>
                <UnifiedMessageBubble
                  msg={renderedMessage}
                  onPresentationFollowUp={sendPresentationFollowUp}
                  presentationDisabled={
                    isAgentActive || isInputBusy || Boolean(queuedMessage) ||
                    thread.originChannel === "slack" || Boolean(thread.archivedAt)
                  }
                  relatedEmailMessages={relatedEmailMessages}
                  viewerId={viewerId}
                  viewerEmail={viewerEmail}
                  receiptStatus={receiptStatus ?? undefined}
                  mirroredToImessage={
                    thread.originChannel === "imessage" &&
                    msg.channel === "chat"
                  }
                  threadContext={
                    isFirstUser ? thread?.initialContext : undefined
                  }
                  collapseEmailMessages={collapseEmailMessages}
                  onOpenEmail={handleOpenEmail}
                  openEmailMessageId={openEmailMessageId}
                  onOpenVendorCompliance={handleOpenVendorCompliance}
                  openVendorComplianceArtifactRef={
                    openVendorComplianceArtifactRef
                  }
                  onOpenMailboxArtifact={handleOpenMailboxArtifact}
                  openMailboxArtifactRef={openMailboxArtifactRef}
                />
                {isFirstUser && thread?.initialContext && (
                  <div
                    className={`mt-2 flex ${firstUserIsOwn ? "justify-end mr-9.5" : "ml-9.5"}`}
                  >
                    <ThreadContextLink context={thread.initialContext} />
                  </div>
                )}
              </div>
            );
          })}
          {chatError && (
            <ChatErrorNotice className={`mx-4 mb-4 px-4 py-3 ${typeStyle("body.default")}`}>
              {chatError}
            </ChatErrorNotice>
          )}
    </ChatMessageList>
  );
}
