"use client";

import { useMemo } from "react";
import { useMutation } from "convex/react";
import type {
  AgentDockAdapter,
  AgentDockTabSummary,
} from "@/components/agent-dock/types";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useArchivedThreadCacheActions } from "@/lib/sync/spot-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { getThreadDisplayLabel } from "@/lib/thread-display";
import { ClientAgentChat } from "./client-agent-chat";
import type { ThreadMessage } from "./types";

function useClientThreads(archived: boolean) {
  const threads = useCachedQuery(
    archived ? "threads.list.archived" : "threads.list.active",
    api.threads.list,
    { archived },
  );
  return useMemo(
    () =>
      threads?.map((thread) => ({
        id: thread._id,
        title: getThreadDisplayLabel(thread),
        lastMessageAt: thread.lastMessageAt ?? thread._creationTime,
        archivedAt: thread.archivedAt,
        channel: thread.originChannel,
      })),
    [threads],
  );
}

function clientTabStatus(messages: ThreadMessage[]) {
  const latestAgent = messages.findLast((message) => message.role === "agent");
  if (
    latestAgent?.status === "draft_email" ||
    latestAgent?.status === "pending_send"
  ) {
    return "approval" as const;
  }
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const latestAgentIndex = messages.findLastIndex(
    (message) => message.role === "agent",
  );
  return messages.some(
    (message) => message.role === "agent" && message.status === "processing",
  ) || latestUserIndex > latestAgentIndex
    ? ("working" as const)
    : null;
}

function useClientTabSummary(
  threadId: string,
): AgentDockTabSummary | null | undefined {
  const id = threadId as Id<"threads">;
  const thread = useCachedQuery("threads.get.current", api.threads.get, { id });
  const messages = useCachedQuery(
    "threads.messages.current",
    api.threads.messages,
    { threadId: id },
  ) as ThreadMessage[] | undefined;
  return useMemo(() => {
    if (thread === undefined) return undefined;
    if (thread === null) return null;
    return {
      title: getThreadDisplayLabel(thread),
      lastMessageAt: thread.lastMessageAt ?? thread._creationTime,
      status: messages ? clientTabStatus(messages) : null,
    };
  }, [messages, thread]);
}

function useClientArchiveActions() {
  const archiveThread = useMutation(api.threads.archive);
  const unarchiveThread = useMutation(api.threads.unarchive);
  const { archiveThreadLocally, unarchiveThreadLocally } =
    useArchivedThreadCacheActions();
  return useMemo(
    () => ({
      archive: async (threadId: string) => {
        const id = threadId as Id<"threads">;
        await archiveThreadLocally(id);
        await archiveThread({ id });
      },
      restore: async (threadId: string) => {
        const id = threadId as Id<"threads">;
        await unarchiveThreadLocally(id);
        await unarchiveThread({ id });
      },
    }),
    [archiveThread, archiveThreadLocally, unarchiveThread, unarchiveThreadLocally],
  );
}

export const clientDockAdapter: AgentDockAdapter = {
  newChatLabel: "Ask anything",
  useThreads: useClientThreads,
  useTabSummary: useClientTabSummary,
  useArchiveActions: useClientArchiveActions,
  Chat: ClientAgentChat,
};
