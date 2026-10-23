"use client";

import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";

import type {
  AgentDockAdapter,
  AgentDockHistoryView,
  AgentDockTabSummary,
} from "@/components/agent-dock/types";
import {
  normalizeOperatorAgentThread,
  normalizeOperatorAgentThreads,
  operatorAgentApi,
} from "@/lib/operator-agent-api";
import { useActiveOperators } from "@/hooks/use-operator-presence";
import { OperatorAgentChat } from "./operator-agent-chat";

function useOperatorThreads(view: AgentDockHistoryView) {
  const rawThreads = useQuery(operatorAgentApi.listThreads, {
    limit: 100,
    view,
  });
  const activeOperators = useActiveOperators();
  return useMemo(
    () =>
      rawThreads === undefined
        ? undefined
        : normalizeOperatorAgentThreads(rawThreads).map((thread) => ({
            id: thread.id,
            title: thread.title,
            lastMessageAt: thread.lastMessageAt,
            archivedAt: thread.archivedAt,
            channel: thread.channel,
            creator: thread.creator,
            activeUsers: activeOperators.filter(
              (operator) => !operator.self && operator.threadId === thread.id,
            ),
          })),
    [activeOperators, rawThreads],
  );
}

function useOperatorTabSummary(
  threadId: string,
): AgentDockTabSummary | undefined {
  const rawThread = useQuery(operatorAgentApi.getThread, { threadId });
  return useMemo(() => {
    if (rawThread === undefined) return undefined;
    const detail = normalizeOperatorAgentThread(rawThread);
    const waiting =
      rawThread.activeRun?.status === "waiting_confirmation" ||
      detail.confirmations.some(
        (confirmation) =>
          confirmation.state === "pending" && confirmation.actionable,
      );
    return {
      title: detail.thread?.title ?? "Chat",
      lastMessageAt: detail.thread?.lastMessageAt ?? 0,
      status: waiting ? "approval" : detail.activeRun ? "working" : null,
    };
  }, [rawThread]);
}

function useOperatorArchiveActions() {
  const archiveThread = useMutation(operatorAgentApi.archiveThread);
  const unarchiveThread = useMutation(operatorAgentApi.unarchiveThread);
  return useMemo(
    () => ({
      archive: async (threadId: string) => {
        await archiveThread({ threadId });
      },
      restore: async (threadId: string) => {
        await unarchiveThread({ threadId });
      },
    }),
    [archiveThread, unarchiveThread],
  );
}

export const operatorDockAdapter: AgentDockAdapter = {
  newChatLabel: "Ask anything",
  historyViews: ["recent", "mcp", "archived"],
  useThreads: useOperatorThreads,
  useTabSummary: useOperatorTabSummary,
  useArchiveActions: useOperatorArchiveActions,
  Chat: OperatorAgentChat,
};
