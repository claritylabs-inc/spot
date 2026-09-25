import type { AppShellSurface } from "@/lib/app-shell-routes";
import type { AgentDockTab } from "./dock-state";

export const AGENT_DOCK_DEFAULT_HEIGHT = 0.6;
export const AGENT_DOCK_MIN_HEIGHT = 0.3;
export const AGENT_DOCK_MAX_HEIGHT = 0.9;

export type StoredAgentDock = {
  tabs: AgentDockTab[];
  activeThreadId: string | null;
  height: number;
};

export function agentDockStorageKey(surface: AppShellSurface, userId: string) {
  return `spot:agent-dock:${surface}:${userId}`;
}

export function clampAgentDockHeight(height: number) {
  if (!Number.isFinite(height)) return AGENT_DOCK_DEFAULT_HEIGHT;
  return Math.min(AGENT_DOCK_MAX_HEIGHT, Math.max(AGENT_DOCK_MIN_HEIGHT, height));
}

export function parseStoredAgentDock(raw: string | null): StoredAgentDock {
  const fallback: StoredAgentDock = {
    tabs: [],
    activeThreadId: null,
    height: AGENT_DOCK_DEFAULT_HEIGHT,
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof StoredAgentDock, unknown>>;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.flatMap((tab: unknown) => {
          const { threadId, seenAt } = (tab ?? {}) as Record<string, unknown>;
          return typeof threadId === "string" && threadId
            ? [{ threadId, seenAt: typeof seenAt === "number" ? seenAt : 0 }]
            : [];
        })
      : [];
    return {
      tabs,
      activeThreadId:
        typeof parsed.activeThreadId === "string" ? parsed.activeThreadId : null,
      height:
        typeof parsed.height === "number"
          ? clampAgentDockHeight(parsed.height)
          : AGENT_DOCK_DEFAULT_HEIGHT,
    };
  } catch {
    return fallback;
  }
}

export function readStoredAgentDock(key: string) {
  try {
    return parseStoredAgentDock(localStorage.getItem(key));
  } catch {
    return parseStoredAgentDock(null);
  }
}

export function writeStoredAgentDock(key: string, value: StoredAgentDock) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Restricted storage keeps the dock usable for this session only.
  }
}
