"use client";

import { TagRemoveButton } from "@claritylabs-inc/ui/components/tag-remove-button";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input/prompt-input";
import type { ChatApprovalDecision } from "@/components/chat/approval-card";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatThreadHeader } from "@/components/chat/thread-header";
import { useChatAction } from "@/components/chat/use-chat-action";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import { usePageContext } from "@/hooks/use-page-context";
import {
  normalizeOperatorAgentThread,
  normalizeOperatorAgentThreads,
  operatorAgentApi,
  type OperatorAgentConfirmation,
} from "@/lib/operator-agent-api";
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
import { OperatorConversation } from "./operator-conversation";

const OPERATOR_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const OPERATOR_ATTACHMENT_MAX_AGGREGATE_BYTES = 50 * 1024 * 1024;
const OPERATOR_ATTACHMENT_ACCEPT =
  ".pdf,.xlsx,.csv,.tsv,.txt,.md,.markdown,.json,.xml,.docx,.pptx,.jpg,.jpeg,.png,.gif,.webp";

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
  const searchParams = useSearchParams();
  const { context: registeredPageContext } = usePageContext();
  const {
    pending: submitting,
    run: runSubmission,
    isRunning: isSubmitting,
  } = useChatAction();
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
  const currentPageContext = useMemo(() => {
    const context = registeredPageContext ?? fallbackPageContext;
    if (variant !== "rail" || !context) return null;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("agentThread");
    const query = params.toString();
    return { ...context, href: `${pathname}${query ? `?${query}` : ""}` };
  }, [
    fallbackPageContext,
    pathname,
    registeredPageContext,
    searchParams,
    variant,
  ]);
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
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if ((!text && message.files.length === 0) || !controller) return;
      return runSubmission(async () => {
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
        }
      });
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
      runSubmission,
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
      decision: ChatApprovalDecision,
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
        <ChatThreadHeader
          title={activeThread?.title ?? "New thread"}
          threads={rawThreads === undefined ? undefined : recentContextThreads}
          activeThreadId={activeThreadId}
          onSelectThread={controller.setActiveThreadId}
          historyLabel="Recent tasks"
          emptyLabel="No tasks for this page."
          actions={
            <PillButton
              variant="icon"
              iconOnly
              label="New operator task"
              onClick={() => void startNewThreadFromUi()}
            >
              <Plus className="size-4" />
            </PillButton>
          }
        />
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
                <TagRemoveButton
                  label="Remove current page context"
                  onClick={() => {
                    if (currentPageContextKey) {
                      controller.detachPageContext(currentPageContextKey);
                    }
                  }}
                />
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
        presentationDisabled={
          running || Boolean(confirmationBusyId) || Boolean(launchingIntentId) ||
          Boolean(activeThread?.archivedAt)
        }
        onFollowUp={async (text) => {
          if (
            running || isSubmitting() || confirmationBusyId ||
            launchingIntentId || activeThread?.archivedAt || !controller
          ) throw new Error("Wait for the current task to finish.");
          await submit({ text, files: [] });
        }}
        onSelectIntent={(intentId) => void launchIntent(intentId)}
        onDecision={(confirmation, decision) =>
          void decide(confirmation, decision)
        }
        composer={
          <ChatComposer
            onSubmit={submit}
            onStop={() => void stop()}
            placeholder="Ask the operator agent…"
            attachmentAccept={OPERATOR_ATTACHMENT_ACCEPT}
            multipleAttachments
            maxFileSize={OPERATOR_ATTACHMENT_MAX_BYTES}
            onAttachmentError={(message) => toast.error(message)}
            busy={running}
            busyLabel="Working"
          />
        }
      />

      {pagePanel ? (
        <div className="absolute inset-0 z-10 bg-background">{pagePanel}</div>
      ) : null}
    </div>
  );
}
