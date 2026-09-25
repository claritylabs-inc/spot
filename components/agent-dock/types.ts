import type { ComponentType, ReactNode } from "react";

export type AgentDockThread = {
  id: string;
  title: string;
  lastMessageAt: number;
  archivedAt?: number;
  channel?: string;
};

export type AgentDockTabStatus = "working" | "approval" | null;

export type AgentDockTabSummary = {
  title: string;
  lastMessageAt: number;
  status: AgentDockTabStatus;
};

export type AgentDockChatProps = {
  threadId: string | null;
  /** The new chat's first message created this thread. */
  onThreadCreated: (threadId: string) => void;
  /** Header actions for the active thread (copy, archive, …). */
  onActions: (actions: ReactNode) => void;
};

/** Surface-specific data and chat for the shared dock. */
export type AgentDockAdapter = {
  newChatLabel: string;
  useThreads: (archived: boolean) => AgentDockThread[] | undefined;
  /** `undefined` while loading, `null` when the thread is gone. */
  useTabSummary: (threadId: string) => AgentDockTabSummary | null | undefined;
  useArchiveActions: () => {
    archive: (threadId: string) => Promise<void>;
    restore: (threadId: string) => Promise<void>;
  };
  Chat: ComponentType<AgentDockChatProps>;
};
