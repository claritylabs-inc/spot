"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { AgentDockContextChip } from "@/components/agent-dock/agent-dock-context-chip";
import { useAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { pageSuggestions } from "@/components/agent-dock/page-suggestions";
import type { AgentDockChatProps } from "@/components/agent-dock/types";
import { PresenceAvatars } from "@/components/app-top-bar";
import {
  ChatComposer,
  type ChatComposerHandle,
} from "@/components/chat/chat-composer";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { NewChatEmptyState } from "@/components/new-chat-empty-state";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePageContext, type PageContext } from "@/hooks/use-page-context";
import { usePresence } from "@/hooks/use-presence";
import { useStartAgentThread } from "@/hooks/use-start-agent-thread";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { UnifiedThreadContent } from "./thread-content";

const CLIENT_PAGE_SUMMARIES: Record<string, string> = {
  policies: "Policies",
  compliance: "Compliance",
  certificates: "Certificates",
  requests: "Requests",
  files: "Files",
  connect: "Connected organizations",
};

/** The page a new chat starts from when the page registers no richer context. */
export function clientPageContextFromPathname(
  pathname: string,
): PageContext | null {
  const area = pathname.split("/").filter(Boolean)[0];
  const summary = area ? CLIENT_PAGE_SUMMARIES[area] : undefined;
  return area && summary ? { pageType: area, summary } : null;
}

function contextKey(context: PageContext) {
  return `${context.pageType}:${context.entityId ?? "page"}`;
}

function withContextReference(
  message: PromptInputMessage,
  context: PageContext | null,
): PromptInputMessage {
  if (
    !context?.entityId ||
    (context.pageType !== "policy" && context.pageType !== "requirement")
  ) {
    return message;
  }
  const references = message.references ?? [];
  if (references.some((reference) => reference.id === context.entityId)) {
    return message;
  }
  return {
    ...message,
    references: [
      ...references,
      {
        kind: context.pageType,
        id: context.entityId,
        label: context.summary ?? `Current ${context.pageType}`,
      },
    ],
  };
}

function NewClientChat({ onThreadCreated }: AgentDockChatProps) {
  const dock = useAgentDock();
  const pathname = usePathname();
  const { context: registeredContext } = usePageContext();
  const { startAgentThread, viewerOrg } = useStartAgentThread("agentDock");
  const composerRef = useRef<ChatComposerHandle>(null);
  const [sending, setSending] = useState(false);
  const currentContext = useMemo(() => {
    const context =
      registeredContext ?? clientPageContextFromPathname(pathname);
    return context
      ? {
          pageType: context.pageType,
          entityId: context.entityId,
          summary: context.summary,
        }
      : null;
  }, [pathname, registeredContext]);
  const detached =
    currentContext !== null &&
    dock.detachedContextKey === contextKey(currentContext);
  const pageContext = detached ? null : currentContext;
  const suggestions = useMemo(() => pageSuggestions(pageContext), [pageContext]);
  const { registerComposer } = dock;

  useEffect(() => {
    registerComposer({ focus: () => composerRef.current?.focus() });
    return () => registerComposer(null);
  }, [registerComposer]);

  const submit = useCallback(
    async (message: PromptInputMessage) => {
      if (sending) return;
      setSending(true);
      try {
        const threadId = await startAgentThread(
          withContextReference(message, pageContext),
          pageContext ?? undefined,
        );
        if (threadId) onThreadCreated(threadId);
      } finally {
        setSending(false);
      }
    },
    [onThreadCreated, pageContext, sending, startAgentThread],
  );

  return (
    <ChatMessageList
      className="min-h-0 flex-1"
      anchorKey={null}
      clearanceClassName="h-20"
      composer={
        <ChatComposer
          ref={composerRef}
          onSubmit={submit}
          placeholder="Ask Spot anything…"
          showAttach
          disabled={sending}
          busy={sending}
          busyLabel="Sending"
          variant="dock"
          orgId={viewerOrg?.org?._id}
          contextChip={
            <AgentDockContextChip
              label={currentContext?.summary ?? null}
              detached={detached}
              onRemove={() => {
                if (currentContext) dock.detachContext(contextKey(currentContext));
              }}
              onAttach={dock.attachContext}
            />
          }
        />
      }
    >
      {viewerOrg?.org?._id ? (
        <NewChatEmptyState
          orgId={viewerOrg.org._id}
          leadingPrompts={suggestions}
          onSelectPrompt={(prompt) =>
            composerRef.current?.setValueAndFocus(prompt)
          }
        />
      ) : null}
    </ChatMessageList>
  );
}

function ThreadPresence({ threadId }: { threadId: string }) {
  return <PresenceAvatars users={usePresence(`thread:${threadId}`)} />;
}

function ClientThreadChat({
  threadId,
  onActions,
}: AgentDockChatProps & { threadId: string }) {
  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const [threadActions, setThreadActions] = useState<React.ReactNode>(null);
  const handleMeta = useCallback(
    (meta: { actions: React.ReactNode }) => setThreadActions(meta.actions),
    [],
  );

  useEffect(() => {
    onActions(
      <>
        <ThreadPresence threadId={threadId} />
        {threadActions}
      </>,
    );
    return () => onActions(null);
  }, [onActions, threadActions, threadId]);

  return (
    <UnifiedThreadContent
      threadId={threadId as Id<"threads">}
      onMeta={handleMeta}
      viewerId={viewer?._id}
      viewerEmail={viewer?.email ?? undefined}
    />
  );
}

/** Tenant conversation in the agent dock; the new chat creates its thread. */
export function ClientAgentChat(props: AgentDockChatProps) {
  return props.threadId ? (
    <div className="relative min-h-0 flex-1">
      <ClientThreadChat {...props} threadId={props.threadId} />
    </div>
  ) : (
    <NewClientChat {...props} />
  );
}
