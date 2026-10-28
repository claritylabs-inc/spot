import type { ComponentType, ReactNode } from "react";

export type AgentDockPerson = {
  userId: string;
  name: string;
  avatarUrl?: string | null;
};

export type AgentDockThread = {
  id: string;
  title: string;
  lastMessageAt: number;
  archivedAt?: number;
  channel?: string;
  /** Shared surfaces show who started the chat and who has it open. */
  creator?: AgentDockPerson;
  activeUsers?: AgentDockPerson[];
};

type AgentDockTabStatus = "working" | "approval" | null;

export type AgentDockTabSummary = {
  title: string;
  lastMessageAt: number;
  status: AgentDockTabStatus;
  /** Shown when hovering the tab, such as who started a shared chat. */
  hint?: string;
};

export type AgentDockChatProps = {
  threadId: string | null;
  /** The new chat's first message created this thread. */
  onThreadCreated: (threadId: string) => void;
  /** Header actions for the active thread (copy, archive, …). */
  onActions: (actions: ReactNode) => void;
};

export type AgentDockHistoryView = "recent" | "mcp" | "archived";

/** Surface-specific data and chat for the shared dock. */
export type AgentDockAdapter = {
  newChatLabel: string;
  /** History tabs this surface offers; defaults to Recent and Archived. */
  historyViews?: AgentDockHistoryView[];
  useThreads: (view: AgentDockHistoryView) => AgentDockThread[] | undefined;
  /** `undefined` while loading, `null` when the thread is gone. */
  useTabSummary: (threadId: string) => AgentDockTabSummary | null | undefined;
  useArchiveActions: () => {
    archive: (threadId: string) => Promise<void>;
    restore: (threadId: string) => Promise<void>;
  };
  Chat: ComponentType<AgentDockChatProps>;
};
