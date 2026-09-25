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
import { threadPageContext } from "@/convex/lib/threadPageContext";
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
import { chatChannelLabel } from "@/components/chat/channel-icon";
import { ChatComposer, type ChatComposerHandle } from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatErrorNotice } from "@/components/chat/chat-message";
import { useChatAction } from "@/components/chat/use-chat-action";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { NewChatEmptyState } from "@/components/new-chat-empty-state";
import { PromptReferenceText } from "@/components/prompt-reference-tag";
import { usePdf } from "@/components/pdf-context";
import { AppShellPortal } from "@/components/app-shell-slots";
import { AgentDockContextChip } from "@/components/agent-dock/agent-dock-context-chip";
import { useOptionalAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  optimisticPromptAttachments,
  promptReferenceIds,
  uploadPromptFiles,
} from "@/lib/thread-prompt";
import { getThreadDisplayLabel } from "@/lib/thread-display";
import type { ThreadArtifactRef, ThreadMessage } from "./types";
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
  hasMultipleSenders,
  messageSenderName,
  threadMessageGroupingFingerprint,
  useStableMessages,
  type AssistantPdfAttachment,
} from "./thread-messages";
import { typeStyle } from "@/lib/typography";

export { ThreadContextLink, UnifiedMessageBubble } from "./thread-message";

function UnifiedThreadActions({
  threadId,
  thread,
  messages,
}: {
  threadId: Id<"threads">;
  thread: { title: string; archivedAt?: number };
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
      lines.push("");
      lines.push(`${sender} [${chatChannelLabel(msg.channel, "Chat")}] — ${time}`);
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
        variant="icon"
        onClick={handleCopyThread}
        label="Copy thread"
        iconOnly
      >
        <Copy className="size-3.5" />
      </PillButton>
      <PillButton
        size="compact"
        variant="icon"
        onClick={handleArchiveToggle}
        label={isArchived ? "Unarchive" : "Archive"}
        iconOnly
      >
        {isArchived ? (
          <ArchiveRestore className="size-3.5" />
        ) : (
          <Archive className="size-3.5" />
        )}
      </PillButton>
    </>
  );
}

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

/** Tenant thread: data, artifact side panels and sending, on the shared chat list. */
export function UnifiedThreadContent({
  threadId,
  onMeta,
  viewerId,
  viewerEmail,
}: {
  threadId: Id<"threads">;
  onMeta?: (meta: {
    detail: React.ReactNode;
    actions: React.ReactNode;
  }) => void;
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
  // A live mailbox review renders as an extra artifact on the first agent message.
  const reviewMessage = mailboxReview
    ? messages?.find((message) => message.role === "agent")
    : undefined;
  const reviewRendered = useMemo(
    () =>
      reviewMessage && mailboxReview
        ? {
            ...reviewMessage,
            toolArtifacts: [
              ...(reviewMessage.toolArtifacts ?? []),
              { type: "mailbox_task", data: mailboxReview },
            ],
          }
        : undefined,
    [mailboxReview, reviewMessage],
  );
  const renderedMessages = useMemo(
    () =>
      reviewRendered
        ? messages?.map((message) =>
            message._id === reviewRendered._id ? reviewRendered : message,
          )
        : messages,
    [messages, reviewRendered],
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
      (renderedMessages ?? []).filter(
        (message) =>
          !messageRenderPlan.hiddenStatusMessageIds.has(message._id) &&
          !messageRenderPlan.attachedEmailMessageIds.has(message._id),
      ),
    [messageRenderPlan, renderedMessages],
  );
  const multipleSenders = useMemo(
    () => hasMultipleSenders(messages ?? []),
    [messages],
  );
  const pdf = usePdf();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const sendMessage = useMutation(api.threads.sendMessage);
  const { appendOptimisticSend, markOptimisticSendFailed } =
    useThreadCacheActions();
  const updateTitle = useMutation(api.threads.updateTitle);
  const clearPageContext = useMutation(api.threads.clearPageContext);
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
  const {
    pending: isSubmitting,
    run: runSend,
    isRunning: sendInFlight,
  } = useChatAction();
  const [queuedMessage, setQueuedMessage] = useState<PromptInputMessage | null>(
    null,
  );
  const [sendingQueuedNow, setSendingQueuedNow] = useState(false);
  const [openArtifact, setOpenArtifact] = useState<ThreadArtifactRef | null>(
    null,
  );
  const openMessage = openArtifact
    ? renderedMessages?.find((message) => message._id === openArtifact.messageId)
    : undefined;
  const openToolArtifact =
    openArtifact && openArtifact.kind !== "email"
      ? openMessage?.toolArtifacts?.filter(
          (artifact) => artifact.type === openArtifact.kind,
        )[openArtifact.index]
      : undefined;

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

  const closeArtifact = useCallback(() => setOpenArtifact(null), []);
  const artifactPanel =
    !openArtifact || !openMessage ? null
    : openArtifact.kind === "email" ? (
      <EmailThreadSidebar message={openMessage} onClose={closeArtifact} />
    ) : !openToolArtifact ? null
    : openArtifact.kind === "vendor_compliance" ? (
      <VendorComplianceSidebar artifact={openToolArtifact} onClose={closeArtifact} />
    ) : (
      <MailboxTaskSidebar
        key={`${openArtifact.index}:${openArtifact.emailIndex ?? "task"}`}
        artifact={openToolArtifact}
        orgId={openMessage.orgId}
        threadId={openMessage.threadId}
        emailIndex={openArtifact.emailIndex}
        onClose={closeArtifact}
      />
    );
  const registerComposer = useOptionalAgentDock()?.registerComposer;

  useEffect(() => {
    if (!registerComposer) return;
    registerComposer({ focus: () => chatInputRef.current?.focus() });
    return () => registerComposer(null);
  }, [registerComposer]);

  // Reset thread-local panels when the selected thread changes.
  useEffect(() => {
    lastAutoOpenedEmailId.current = null;
    const frame = window.requestAnimationFrame(() => setOpenArtifact(null));
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
    setOpenArtifact({ kind: "email", messageId: latestDraftEmail._id });
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

  const isAgentActive = useMemo(() => {
    if (!messages) return false;
    const lastIndex = (role: ThreadMessage["role"]) =>
      messages.reduce((acc, m, i) => (m.role === role ? i : acc), -1);
    return (
      messages.some((m) => m.role === "agent" && m.status === "processing") ||
      lastIndex("user") > lastIndex("agent")
    );
  }, [messages]);
  const isInputBusy = isSubmitting || sendingQueuedNow;

  const sendThreadMessage = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if ((!text && message.files.length === 0) || !thread) {
        return Promise.resolve();
      }
      return runSend(async () => {
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
          await sendMessage({
            threadId,
            content,
            ...(attachments.length > 0 ? { attachments } : {}),
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
        }
      });
    },
    [
      appendOptimisticSend,
      generateUploadUrl,
      markOptimisticSendFailed,
      runSend,
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
        isAgentActive || isInputBusy || sendInFlight() || queuedMessage
      ) {
        throw new Error("Wait for the current task to finish.");
      }
      await runSend(() =>
        sendMessage({
          threadId,
          content,
          ...promptReferenceIds(selectedReferences?.flatMap(reference =>
            reference.kind === "policy" || reference.kind === "requirement"
              ? [{ kind: reference.kind, id: reference.recordId, label: reference.label }]
              : [],
          )),
          clientMutationId: createClientMutationId("message"),
        }),
      );
    },
    [
      thread,
      isAgentActive,
      isInputBusy,
      sendInFlight,
      queuedMessage,
      runSend,
      sendMessage,
      threadId,
    ],
  );

  const collapseEmailMessages = thread?.originChannel !== "email";

  if (!thread) {
    return <div className="h-full" />;
  }

  const threadContext = threadPageContext(thread);
  const slackUrl = slackConversationUrl(thread);

  return (
    <>
    <AppShellPortal slot="artifactPanel" active={artifactPanel !== null}>
      {artifactPanel}
    </AppShellPortal>
    <ChatMessageList
      className="h-full"
      anchorKey={threadId}
      composer={
        thread.originChannel === "slack" ? (
          <div className="my-2 flex flex-col items-stretch gap-3 rounded-xl border border-input bg-background px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
            busyLabel="Sending"
            variant="dock"
            orgId={thread.orgId}
            contextChip={
              threadContext ? (
                <AgentDockContextChip
                  label={
                    threadContext.summary ??
                    threadContext.pageType.replaceAll("_", " ")
                  }
                  onRemove={() =>
                    void clearPageContext({ id: threadId }).catch(() =>
                      toast.error("Could not remove the page context"),
                    )
                  }
                />
              ) : undefined
            }
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
        const isFirstUser = msg._id === messageRenderPlan.firstUserMessageId;
        const firstUserIsOwn =
          isFirstUser && isMessageFromViewer(msg, viewerId, viewerEmail);
        return (
          <div key={msg._id}>
            <UnifiedMessageBubble
              msg={msg}
              onPresentationFollowUp={sendPresentationFollowUp}
              presentationDisabled={
                isAgentActive || isInputBusy || Boolean(queuedMessage) ||
                thread.originChannel === "slack" || Boolean(thread.archivedAt)
              }
              relatedEmailMessages={messageRenderPlan.relatedEmailsByMessageId.get(msg._id)}
              viewerId={viewerId}
              viewerEmail={viewerEmail}
              showSender={multipleSenders}
              mirroredToImessage={
                thread.originChannel === "imessage" && msg.channel === "chat"
              }
              threadContext={isFirstUser ? thread.initialContext : undefined}
              collapseEmailMessages={collapseEmailMessages}
              openArtifact={openArtifact}
              onOpenArtifact={setOpenArtifact}
            />
            {isFirstUser && thread.initialContext && (
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
    </>
  );
}
