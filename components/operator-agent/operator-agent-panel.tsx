"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { ChevronDown, Plus, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useStickToBottom } from "use-stick-to-bottom";

import { AgentThinkingBubble } from "@/components/agent-thread/agent-thinking-bubble";
import { ThreadMessageBubble } from "@/components/agent-thread/message-bubble";
import { ThreadAttachmentChip } from "@/components/agent-thread/thread-attachment-chip";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input/prompt-input";
import { ProseMarkdown } from "@/components/prose-markdown";
import {
  ChatInputOverlay,
  SpotPromptInput,
  type SpotPromptInputHandle,
} from "@/components/spot-prompt-input";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";
import { OperationalPanel } from "@/components/ui/operational-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { StatusTag } from "@/components/ui/status-tag";
import type { Id } from "@/convex/_generated/dataModel";
import { usePageContext } from "@/hooks/use-page-context";
import {
  normalizeOperatorAgentThread,
  normalizeOperatorAgentThreads,
  operatorAgentApi,
  type OperatorAgentAttachment,
  type OperatorAgentConfirmation,
  type OperatorAgentIntent,
  type OperatorAgentMessage,
  type OperatorAgentThreadDetail,
} from "@/lib/operator-agent-api";
import { formatDisplayDateTime } from "@/lib/date-format";
import { uploadPromptFiles } from "@/lib/thread-prompt";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";
import {
  operatorPageContextFromPathname,
  operatorPageContextKey,
  operatorPageContextLabel,
  operatorPageContextsShareScope,
} from "./operator-page-context";
import { useOptionalOperatorAgent } from "./operator-agent-provider";
import { OperatorThreadChannelIcon } from "./operator-thread-channel";
import {
  operatorConversationEntries,
  OperatorToolActivityGroup,
  OperatorToolActivity,
} from "./operator-tool-activity";

const OPERATOR_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const OPERATOR_ATTACHMENT_MAX_AGGREGATE_BYTES = 50 * 1024 * 1024;
const OPERATOR_ATTACHMENT_ACCEPT =
  ".pdf,.xlsx,.csv,.tsv,.txt,.md,.markdown,.json,.xml,.docx,.pptx,.jpg,.jpeg,.png,.gif,.webp";

function OperatorMessageAttachments({
  threadId,
  attachments,
}: {
  threadId: string;
  attachments: OperatorAgentAttachment[];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <OperatorAttachmentChip
          key={attachment.fileId}
          threadId={threadId}
          attachment={attachment}
        />
      ))}
    </div>
  );
}

function OperatorAttachmentChip({
  threadId,
  attachment,
}: {
  threadId: string;
  attachment: OperatorAgentAttachment;
}) {
  const url = useQuery(operatorAgentApi.getAttachmentUrl, {
    threadId,
    fileId: attachment.fileId,
  });
  return (
    <ThreadAttachmentChip
      attachment={attachment}
      resolvedUrl={url}
      isLoading={url === undefined}
      size="compact"
    />
  );
}

function ConfirmationArtifact({
  confirmation,
  busy,
  onDecision,
}: {
  confirmation: OperatorAgentConfirmation;
  busy: boolean;
  onDecision: (decision: "approve" | "reject") => void;
}) {
  const [title, ...details] = confirmation.title.split("\n");
  const presentation = (() => {
    switch (confirmation.state) {
      case "approved":
        return { label: "Approved", tone: "success" as const };
      case "cancelled":
        return { label: "Cancelled", tone: "neutral" as const };
      case "expired":
        return { label: "Expired", tone: "warning" as const };
      case "superseded":
        return { label: "Superseded", tone: "neutral" as const };
      case "unavailable":
        return { label: "No longer available", tone: "neutral" as const };
      case "pending":
        return {
          label: confirmation.actionable
            ? "Approval required"
            : "Awaiting approval",
          tone: "warning" as const,
        };
    }
  })();

  return (
    <OperationalPanel
      as="div"
      className="flex min-w-0 flex-wrap items-end gap-4 p-4"
    >
      <div className="min-w-0 flex-1 basis-80">
        <StatusTag tone={presentation.tone}>{presentation.label}</StatusTag>
        <p
          className={cn(
            "mt-2 break-words text-foreground",
            typeStyle(details.length ? "body.medium" : "body.default"),
          )}
        >
          {title}
        </p>
        {details.length ? (
          <p
            className={cn(
              "mt-2 whitespace-pre-line break-words text-foreground",
              typeStyle("body.default"),
            )}
          >
            {details.join("\n")}
          </p>
        ) : null}
      </div>
      {confirmation.state === "pending" && confirmation.actionable ? (
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
            variant={confirmation.destructive ? "destructive" : "primary"}
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

function EmptyThread({
  intents,
  launchingIntentId,
  onSelect,
}: {
  intents: OperatorAgentIntent[] | undefined;
  launchingIntentId: string | null;
  onSelect: (intentId: string) => void;
}) {
  return (
    <div className="flex min-h-full flex-col justify-center py-10">
      <LogoIcon className="mb-4 text-muted-foreground" size={24} static />
      <h2 className={cn("text-foreground", typeStyle("body.medium"))}>
        What do you need?
      </h2>
      <p
        className={cn(
          "mt-1 text-muted-foreground",
          typeStyle("caption.default"),
        )}
      >
        Pick a task or describe what you need. Sensitive actions still require
        your approval.
      </p>
      <div className="mt-6 divide-y divide-border border-y border-border">
        {intents === undefined ? (
          <div className="flex h-20 items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : (
          intents.map((intent) => (
            <button
              key={intent.id}
              type="button"
              disabled={launchingIntentId !== null}
              onClick={() => onSelect(intent.id)}
              className={cn(
                "flex w-full items-center gap-2 py-3 text-left text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
                typeStyle("caption.medium"),
              )}
            >
              {launchingIntentId === intent.id ? (
                <Spinner className="size-3.5" />
              ) : null}
              {intent.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function operatorBubbleChannel(channel: OperatorAgentMessage["channel"]) {
  return channel === "mcp" ? "chat" : channel;
}

function operatorInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function OperatorMessageRow({
  threadId,
  message,
  showThinking,
}: {
  threadId: string;
  message: OperatorAgentMessage;
  showThinking: boolean;
}) {
  const bubbleChannel = operatorBubbleChannel(message.channel);
  const content =
    message.content.trim() ||
    (message.status === "error"
      ? "The operator task failed."
      : message.status === "cancelled"
        ? "Task stopped."
        : "");
  const attachments = message.attachments?.length ? (
    <OperatorMessageAttachments
      threadId={threadId}
      attachments={message.attachments}
    />
  ) : null;

  if (message.role === "assistant") {
    if (!showThinking && !content && !attachments) return null;

    return (
      <div className="w-full">
        {showThinking ? (
          <AgentThinkingBubble />
        ) : (
          <ThreadMessageBubble
            role="agent"
            channel={bubbleChannel}
            isError={message.status === "error"}
          >
            {content ? (
              <ProseMarkdown
                gfm
                breaks
                compact={message.channel === "imessage"}
              >
                {content}
              </ProseMarkdown>
            ) : null}
            {attachments}
          </ThreadMessageBubble>
        )}
      </div>
    );
  }

  const displayName = message.userName?.trim() || "Operator";

  return (
    <div className="ml-auto flex w-fit max-w-[min(32rem,100%)] flex-row-reverse items-start gap-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/8">
        <span className={cn("text-foreground/60", typeStyle("caption.medium"))}>
          {operatorInitials(displayName)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-w-0 items-center justify-end gap-2">
          <p
            className={cn(
              "min-w-0 max-w-[min(24rem,70vw)] truncate text-muted-foreground/50",
              typeStyle("caption.medium"),
            )}
            title={displayName}
          >
            {displayName}
          </p>
          <OperatorThreadChannelIcon
            channel={message.channel}
            className="size-3 shrink-0 text-muted-foreground/45"
          />
          <span className="text-muted-foreground/30">·</span>
          <span
            className={cn(
              "shrink-0 text-muted-foreground/45",
              typeStyle("caption.default"),
            )}
          >
            {formatDisplayDateTime(message.createdAt)}
          </span>
        </div>
        <ThreadMessageBubble
          role="user"
          channel={bubbleChannel}
          isOwnMessage
          isError={message.status === "error"}
        >
          {content ? (
            message.channel === "slack" ? (
              <ProseMarkdown sourceFormat="slack-mrkdwn" gfm breaks>
                {content}
              </ProseMarkdown>
            ) : (
              <p className="whitespace-pre-wrap wrap-anywhere">{content}</p>
            )
          ) : null}
          {attachments}
        </ThreadMessageBubble>
      </div>
    </div>
  );
}

function OperatorConversation({
  variant,
  activeThreadId,
  loading,
  detail,
  intents,
  launchingIntentId,
  confirmationBusyId,
  onSelectIntent,
  onDecision,
  composer,
}: {
  variant: "rail" | "page";
  activeThreadId: string | null;
  loading: boolean;
  detail: OperatorAgentThreadDetail;
  intents: OperatorAgentIntent[] | undefined;
  launchingIntentId: string | null;
  confirmationBusyId: string | null;
  onSelectIntent: (intentId: string) => void;
  onDecision: (
    confirmation: OperatorAgentConfirmation,
    decision: "approve" | "reject",
  ) => void;
  composer: ReactNode;
}) {
  const { contentRef, scrollRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });
  const entries = useMemo(() => operatorConversationEntries(detail), [detail]);
  const hasPendingConfirmation = detail.confirmations.some(
    (confirmation) => confirmation.state === "pending",
  );

  useEffect(() => {
    if (detail.messages.length === 0) return;
    void scrollToBottom("instant");
  }, [
    activeThreadId,
    detail.confirmations.length,
    detail.messages.length,
    scrollToBottom,
  ]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto scrollbar-hide p-4 pr-5"
      >
        <div
          ref={contentRef}
          className="mx-auto min-h-full w-full max-w-3xl space-y-4"
        >
          {loading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : detail.messages.length === 0 ? (
            <EmptyThread
              intents={intents}
              launchingIntentId={launchingIntentId}
              onSelect={onSelectIntent}
            />
          ) : (
            entries.map((entry) => {
              if (entry.kind === "tool_calls") {
                return (
                  <OperatorToolActivityGroup
                    key={entry.activities[0].request.id}
                    activities={entry.activities}
                  />
                );
              }
              const {
                request: message,
                response,
                confirmations,
              } = entry.activity;
              return (
                <Fragment key={message.id}>
                  {message.isDirectToolRequest ? (
                    <>
                      {confirmations.length === 0 ? (
                        <OperatorToolActivity
                          request={message}
                          response={response}
                          awaitingApproval={false}
                        />
                      ) : null}
                      {[message, ...(response ? [response] : [])].map((item) =>
                        item.attachments?.length ? (
                          <OperatorMessageAttachments
                            key={item.id}
                            threadId={activeThreadId ?? ""}
                            attachments={item.attachments}
                          />
                        ) : null,
                      )}
                    </>
                  ) : (
                    <OperatorMessageRow
                      threadId={activeThreadId ?? ""}
                      message={message}
                      showThinking={
                        message.status === "processing" &&
                        !hasPendingConfirmation
                      }
                    />
                  )}
                  {confirmations.map((confirmation) => (
                    <div key={confirmation.id} className="w-full">
                      <ConfirmationArtifact
                        confirmation={confirmation}
                        busy={confirmationBusyId === confirmation.id}
                        onDecision={(decision) =>
                          onDecision(confirmation, decision)
                        }
                      />
                      {message.isDirectToolRequest ? (
                        <div className="mt-2">
                          <OperatorToolActivity
                            request={message}
                            response={response}
                            awaitingApproval={confirmation.state === "pending"}
                            detailsOnly
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </Fragment>
              );
            })
          )}
          {detail.messages.length > 0 ? <div className="h-40" /> : null}
        </div>
      </div>
      <ChatInputOverlay compact={variant === "rail"}>
        {composer}
      </ChatInputOverlay>
    </div>
  );
}

export function OperatorAgentPanel({
  pagePanel,
  variant = "rail",
  threadId,
  showHeader = true,
}: {
  pagePanel?: ReactNode;
  variant?: "rail" | "page";
  threadId?: string;
  showHeader?: boolean;
}) {
  const controller = useOptionalOperatorAgent();
  const pathname = usePathname();
  const { context: registeredPageContext } = usePageContext();
  const promptRef = useRef<SpotPromptInputHandle>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationBusyId, setConfirmationBusyId] = useState<string | null>(
    null,
  );
  const [launchingIntentId, setLaunchingIntentId] = useState<string | null>(
    null,
  );
  const rawThreads = useQuery(operatorAgentApi.listThreads, {
    limit: 40,
    archived: false,
  });
  const threads = useMemo(
    () => normalizeOperatorAgentThreads(rawThreads),
    [rawThreads],
  );
  const activeThreadId = threadId ?? controller?.activeThreadId ?? null;
  const rawThread = useQuery(
    operatorAgentApi.getThread,
    activeThreadId ? { threadId: activeThreadId } : "skip",
  );
  const detail = useMemo(
    () => normalizeOperatorAgentThread(rawThread),
    [rawThread],
  );
  const createThread = useMutation(operatorAgentApi.createThread);
  const generateUploadUrl = useMutation(operatorAgentApi.generateUploadUrl);
  const registerUpload = useMutation(operatorAgentApi.registerUpload);
  const discardUploads = useMutation(operatorAgentApi.discardUploads);
  const sendMessage = useMutation(operatorAgentApi.sendMessage);
  const cancelRun = useMutation(operatorAgentApi.cancelRun);
  const confirmAction = useMutation(operatorAgentApi.confirmAction);
  const startIntent = useMutation(operatorAgentApi.startIntent);
  const fallbackPageContext = useMemo(
    () => operatorPageContextFromPathname(pathname),
    [pathname],
  );
  const currentPageContext =
    variant === "rail" ? (registeredPageContext ?? fallbackPageContext) : null;
  const recentContextThreads = useMemo(
    () =>
      currentPageContext
        ? threads.filter(
            (thread) =>
              thread.initialContext &&
              operatorPageContextsShareScope(
                thread.initialContext,
                currentPageContext,
              ),
          )
        : threads,
    [currentPageContext, threads],
  );
  const currentPageContextKey = currentPageContext
    ? operatorPageContextKey(currentPageContext)
    : null;
  const availablePageContext =
    currentPageContext &&
    currentPageContextKey !== controller?.detachedPageContextKey
      ? currentPageContext
      : null;
  const activeThread =
    detail.thread ??
    threads.find((thread) => thread.id === activeThreadId) ??
    null;
  const retainedThreadContext = activeThread?.initialContext ?? null;
  const displayedPageContext = retainedThreadContext ?? availablePageContext;
  const intents = useQuery(
    operatorAgentApi.listIntents,
    displayedPageContext ? { pageContext: displayedPageContext } : {},
  );
  const running = detail.activeRun || submitting;

  useEffect(() => {
    if (
      threadId ||
      !controller ||
      controller.activeThreadId ||
      threads.length === 0
    )
      return;
    controller.setActiveThreadId(threads[0].id);
  }, [controller, threadId, threads]);

  const startNewThread = useCallback(async () => {
    if (!controller) throw new Error("Operator agent is unavailable");
    const result = await createThread(
      availablePageContext ? { initialContext: availablePageContext } : {},
    );
    const newThreadId = result;
    controller.setActiveThreadId(newThreadId);
    return newThreadId;
  }, [availablePageContext, controller, createThread]);

  const startNewThreadFromUi = useCallback(async () => {
    try {
      await startNewThread();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start a task",
      );
    }
  }, [startNewThread]);

  const launchIntent = useCallback(
    async (intentId: string) => {
      if (!controller || launchingIntentId) return;
      setLaunchingIntentId(intentId);
      try {
        const result = await startIntent({
          intentId,
          ...(displayedPageContext
            ? { pageContext: displayedPageContext }
            : {}),
          ...(activeThreadId && detail.messages.length === 0
            ? { emptyThreadId: activeThreadId }
            : {}),
        });
        controller.setActiveThreadId(result.threadId);
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not start the operator task"),
        );
      } finally {
        setLaunchingIntentId(null);
      }
    },
    [
      activeThreadId,
      controller,
      detail.messages.length,
      displayedPageContext,
      launchingIntentId,
      startIntent,
    ],
  );

  const submit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();
      if ((!text && message.files.length === 0) || !controller || submitting)
        return;
      setSubmitting(true);
      const uploadedIntents: Array<{
        uploadIntentId: Id<"operatorAgentUploadIntents">;
        fileId?: Id<"_storage">;
      }> = [];
      try {
        const targetThreadId = activeThreadId ?? (await startNewThread());
        const attachments = await uploadPromptFiles(
          message.files,
          generateUploadUrl,
          {
            failOnUploadError: true,
            maxAggregateSize: OPERATOR_ATTACHMENT_MAX_AGGREGATE_BYTES,
            onUploadTarget: (target) => {
              if (typeof target !== "string") {
                uploadedIntents.push({
                  uploadIntentId: target.uploadIntentId,
                });
              }
            },
            onUploaded: (attachment) => {
              if (attachment.uploadIntentId) {
                const tracked = uploadedIntents.find(
                  ({ uploadIntentId }) =>
                    uploadIntentId === attachment.uploadIntentId,
                );
                if (tracked) tracked.fileId = attachment.fileId;
              }
            },
            finalizeUpload: async (attachment) => {
              if (!attachment.uploadIntentId) {
                throw new Error("Operator attachment upload intent is missing");
              }
              await registerUpload({
                uploadIntentId: attachment.uploadIntentId,
                fileId: attachment.fileId,
              });
            },
          },
        );
        if (attachments.length !== message.files.length) {
          throw new Error("One or more files could not be uploaded");
        }
        await sendMessage({
          threadId: targetThreadId,
          content: text || "(attached files)",
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(!retainedThreadContext && availablePageContext
            ? { pageContext: availablePageContext }
            : {}),
        });
      } catch (error) {
        if (uploadedIntents.length > 0) {
          await discardUploads({ uploads: uploadedIntents }).catch(
            () => undefined,
          );
        }
        toast.error(
          error instanceof Error
            ? error.message
            : "The operator task could not be sent",
        );
        throw error;
      } finally {
        setSubmitting(false);
      }
    },
    [
      activeThreadId,
      availablePageContext,
      controller,
      generateUploadUrl,
      registerUpload,
      discardUploads,
      sendMessage,
      startNewThread,
      submitting,
      retainedThreadContext,
    ],
  );

  const stop = useCallback(async () => {
    if (!activeThreadId) return;
    try {
      await cancelRun({ threadId: activeThreadId });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not stop the task",
      );
    }
  }, [activeThreadId, cancelRun]);

  const decide = useCallback(
    async (
      confirmation: OperatorAgentConfirmation,
      decision: "approve" | "reject",
    ) => {
      if (!activeThreadId) return;
      setConfirmationBusyId(confirmation.id);
      try {
        await confirmAction({
          threadId: activeThreadId,
          confirmationId: confirmation.id,
          decision,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not record the decision",
        );
      } finally {
        setConfirmationBusyId(null);
      }
    },
    [activeThreadId, confirmAction],
  );

  if (!controller) return null;

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full flex-col bg-background",
        variant === "rail" && "border-l border-border",
      )}
      style={
        variant === "rail"
          ? { paddingTop: "env(safe-area-inset-top, 0px)" }
          : undefined
      }
    >
      {showHeader ? (
        <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={(props) => (
                <button
                  {...props}
                  type="button"
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground outline-none focus-visible:underline focus-visible:underline-offset-4",
                    typeStyle("body.medium"),
                  )}
                >
                  <span className="truncate">
                    {activeThread?.title ?? "Operator agent"}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              )}
            />
            <DropdownMenuContent
              align="start"
              sideOffset={6}
              className="max-h-80 w-72 max-w-[calc(100vw-1.5rem)]"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>Recent tasks</DropdownMenuLabel>
                {rawThreads === undefined ? (
                  <DropdownMenuItem disabled className="h-16 justify-center">
                    <Spinner className="text-muted-foreground" />
                    <span className="sr-only">Loading tasks</span>
                  </DropdownMenuItem>
                ) : recentContextThreads.length === 0 ? (
                  <DropdownMenuItem disabled className="py-3">
                    No tasks for this page.
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuRadioGroup
                    value={activeThreadId}
                    onValueChange={(threadId) => {
                      if (typeof threadId !== "string") return;
                      controller.setActiveThreadId(threadId);
                    }}
                  >
                    {recentContextThreads.map((thread) => (
                      <DropdownMenuRadioItem
                        key={thread.id}
                        value={thread.id}
                        className="items-start py-1.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-foreground">
                            {thread.title}
                          </span>
                          {thread.lastMessageAt ? (
                            <span
                              className={cn(
                                "block text-muted-foreground",
                                typeStyle("label.tag"),
                              )}
                            >
                              {dayjs(thread.lastMessageAt).format(
                                "MMM D, h:mm A",
                              )}
                            </span>
                          ) : null}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <PillButton
            variant="icon"
            iconOnly
            label="New operator task"
            onClick={() => void startNewThreadFromUi()}
          >
            <Plus className="size-4" />
          </PillButton>
        </header>
      ) : null}

      {variant === "rail" && (retainedThreadContext || currentPageContext) ? (
        <div className="flex min-h-10 shrink-0 items-center border-b border-border px-3 py-1.5">
          {displayedPageContext ? (
            <div
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-full border border-input px-2.5 py-1 text-muted-foreground",
                typeStyle("label.tag"),
              )}
            >
              <span className="truncate">
                {retainedThreadContext ? "Thread context: " : "Using "}
                {operatorPageContextLabel(displayedPageContext)}
              </span>
              {!retainedThreadContext ? (
                <button
                  type="button"
                  aria-label="Remove current page context"
                  className="shrink-0 transition-colors hover:text-foreground"
                  onClick={() =>
                    currentPageContextKey &&
                    controller.detachPageContext(currentPageContextKey)
                  }
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ) : (
            <PillButton
              variant="ghost"
              size="compact"
              onClick={controller.attachPageContext}
            >
              Use current page
            </PillButton>
          )}
        </div>
      ) : null}

      <OperatorConversation
        variant={variant}
        activeThreadId={activeThreadId}
        loading={Boolean(activeThreadId && rawThread === undefined)}
        detail={detail}
        intents={intents}
        launchingIntentId={launchingIntentId}
        confirmationBusyId={confirmationBusyId}
        onSelectIntent={(intentId) => void launchIntent(intentId)}
        onDecision={(confirmation, decision) =>
          void decide(confirmation, decision)
        }
        composer={
          <SpotPromptInput
            ref={promptRef}
            onSubmit={submit}
            onStop={() => void stop()}
            placeholder="Ask the operator agent…"
            attachmentAccept={OPERATOR_ATTACHMENT_ACCEPT}
            multipleAttachments
            maxFileSize={OPERATOR_ATTACHMENT_MAX_BYTES}
            onAttachmentError={(message) => toast.error(message)}
            status={running ? "submitted" : undefined}
            submittedLabel="Working"
          />
        }
      />

      {pagePanel ? (
        <div className="absolute inset-0 z-10 bg-background">{pagePanel}</div>
      ) : null}
    </div>
  );
}
