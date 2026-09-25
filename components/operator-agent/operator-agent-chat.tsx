"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input/prompt-input";
import { AgentDockContextChip } from "@/components/agent-dock/agent-dock-context-chip";
import { useAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { pageSuggestions } from "@/components/agent-dock/page-suggestions";
import type { AgentDockChatProps } from "@/components/agent-dock/types";
import type { ChatApprovalDecision } from "@/components/chat/approval-card";
import {
  ChatComposer,
  type ChatComposerHandle,
} from "@/components/chat/chat-composer";
import { useChatAction } from "@/components/chat/use-chat-action";
import type { Id } from "@/convex/_generated/dataModel";
import { usePageContext } from "@/hooks/use-page-context";
import {
  normalizeOperatorAgentThread,
  operatorAgentApi,
  type OperatorAgentConfirmation,
} from "@/lib/operator-agent-api";
import { uploadPromptFiles } from "@/lib/thread-prompt";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  operatorPageContextFromPathname,
  operatorPageContextKey,
  operatorPageContextLabel,
  operatorThreadContextHref,
} from "./operator-page-context";
import { OperatorConversation } from "./operator-conversation";

const OPERATOR_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const OPERATOR_ATTACHMENT_MAX_AGGREGATE_BYTES = 50 * 1024 * 1024;
const OPERATOR_ATTACHMENT_ACCEPT =
  ".pdf,.xlsx,.csv,.tsv,.txt,.md,.markdown,.json,.xml,.docx,.pptx,.jpg,.jpeg,.png,.gif,.webp";

function reportError(fallback: string) {
  return (error: unknown) =>
    toast.error(getUserFacingErrorMessage(error, fallback));
}

/** Operator conversation in the agent dock. */
export function OperatorAgentChat({
  threadId: activeThreadId,
  onThreadCreated,
}: AgentDockChatProps) {
  const dock = useAgentDock();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { context: registeredPageContext } = usePageContext();
  const composerRef = useRef<ChatComposerHandle>(null);
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
  const currentPageContext = useMemo(() => {
    const context =
      registeredPageContext ?? operatorPageContextFromPathname(pathname);
    if (!context) return null;
    const query = searchParams.toString();
    return { ...context, href: `${pathname}${query ? `?${query}` : ""}` };
  }, [pathname, registeredPageContext, searchParams]);
  const currentPageContextKey = currentPageContext
    ? operatorPageContextKey(currentPageContext)
    : null;
  const availablePageContext =
    currentPageContext && currentPageContextKey !== dock.detachedContextKey
      ? currentPageContext
      : null;
  const activeThread = detail.thread;
  const retainedThreadContext = activeThread?.initialContext ?? null;
  const displayedPageContext = retainedThreadContext ?? availablePageContext;
  const intents = useQuery(
    operatorAgentApi.listIntents,
    displayedPageContext ? { pageContext: displayedPageContext } : {},
  );
  const prompts = useMemo(
    () => pageSuggestions(displayedPageContext, "operator"),
    [displayedPageContext],
  );
  const running = detail.activeRun || submitting;
  const { registerComposer } = dock;

  useEffect(() => {
    registerComposer({ focus: () => composerRef.current?.focus() });
    return () => registerComposer(null);
  }, [registerComposer]);

  const startNewThread = useCallback(async () => {
    const newThreadId = await createThread(
      availablePageContext ? { initialContext: availablePageContext } : {},
    );
    onThreadCreated(newThreadId);
    return newThreadId;
  }, [availablePageContext, createThread, onThreadCreated]);

  const launchIntent = useCallback(
    async (intentId: string) => {
      if (launchingIntentId) return;
      setLaunchingIntentId(intentId);
      await startIntent({
        intentId,
        ...(displayedPageContext
          ? { pageContext: displayedPageContext }
          : {}),
        ...(activeThreadId && detail.messages.length === 0
          ? { emptyThreadId: activeThreadId }
          : {}),
      })
        .then((result) => onThreadCreated(result.threadId))
        .catch(reportError("Could not start the operator task"))
        .finally(() => setLaunchingIntentId(null));
    },
    [
      activeThreadId,
      detail.messages.length,
      displayedPageContext,
      launchingIntentId,
      onThreadCreated,
      startIntent,
    ],
  );

  const submit = useCallback(
    (message: PromptInputMessage) => {
      const text = message.text.trim();
      if (!text && message.files.length === 0) return;
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
              finalizeUpload: async (attachment) => {
                const tracked = uploadedIntents.find(
                  ({ uploadIntentId }) =>
                    uploadIntentId === attachment.uploadIntentId,
                );
                if (!tracked) {
                  throw new Error("Operator attachment upload intent is missing");
                }
                tracked.fileId = attachment.fileId;
                await registerUpload({
                  uploadIntentId: tracked.uploadIntentId,
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
          reportError("The operator task could not be sent")(error);
          throw error;
        }
      });
    },
    [
      activeThreadId,
      availablePageContext,
      generateUploadUrl,
      registerUpload,
      discardUploads,
      sendMessage,
      startNewThread,
      runSubmission,
      retainedThreadContext,
    ],
  );

  const decide = useCallback(
    async (
      confirmation: OperatorAgentConfirmation,
      decision: ChatApprovalDecision,
    ) => {
      if (!activeThreadId) return;
      setConfirmationBusyId(confirmation.id);
      await confirmAction({
        threadId: activeThreadId,
        confirmationId: confirmation.id,
        decision,
      })
        .catch(reportError("Could not record the decision"))
        .finally(() => setConfirmationBusyId(null));
    },
    [activeThreadId, confirmAction],
  );

  const contextLabel = displayedPageContext
    ? operatorPageContextLabel(displayedPageContext)
    : currentPageContext
      ? operatorPageContextLabel(currentPageContext)
      : null;

  return (
    <OperatorConversation
      activeThreadId={activeThreadId}
      loading={Boolean(activeThreadId && rawThread === undefined)}
      detail={detail}
      intents={intents}
      prompts={prompts}
      launchingIntentId={launchingIntentId}
      confirmationBusyId={confirmationBusyId}
      presentationDisabled={
        running ||
        Boolean(confirmationBusyId) ||
        Boolean(launchingIntentId) ||
        Boolean(activeThread?.archivedAt)
      }
      onFollowUp={async (text) => {
        if (
          running ||
          isSubmitting() ||
          confirmationBusyId ||
          launchingIntentId ||
          activeThread?.archivedAt
        )
          throw new Error("Wait for the current task to finish.");
        await submit({ text, files: [] });
      }}
      onSelectIntent={(intentId) => void launchIntent(intentId)}
      onSelectPrompt={(prompt) => composerRef.current?.setValueAndFocus(prompt)}
      onDecision={(confirmation, decision) =>
        void decide(confirmation, decision)
      }
      composer={
        <ChatComposer
          ref={composerRef}
          onSubmit={submit}
          onStop={() => {
            if (!activeThreadId) return;
            void cancelRun({ threadId: activeThreadId }).catch(
              reportError("Could not stop the task"),
            );
          }}
          placeholder="Ask the operator agent…"
          attachmentAccept={OPERATOR_ATTACHMENT_ACCEPT}
          multipleAttachments
          maxFileSize={OPERATOR_ATTACHMENT_MAX_BYTES}
          onAttachmentError={(message) => toast.error(message)}
          busy={running}
          busyLabel="Working"
          variant="dock"
          contextChip={
            <AgentDockContextChip
              label={contextLabel}
              href={activeThread ? operatorThreadContextHref(activeThread) : null}
              retained={Boolean(retainedThreadContext)}
              detached={!displayedPageContext}
              onRemove={() => {
                if (currentPageContextKey) {
                  dock.detachContext(currentPageContextKey);
                }
              }}
              onAttach={dock.attachContext}
            />
          }
        />
      }
    />
  );
}
