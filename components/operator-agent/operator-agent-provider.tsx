"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { useSpotSync } from "@/lib/sync/spot-sync";

type OperatorAgentContextValue = {
  activeThreadId: string | null;
  detachedPageContextKey: string | null;
  enabled: boolean;
  open: boolean;
  attachPageContext: () => void;
  close: () => void;
  detachPageContext: (key: string) => void;
  setActiveThreadId: (threadId: string | null) => void;
  toggle: () => void;
};

const OperatorAgentContext = createContext<OperatorAgentContextValue | null>(
  null,
);

function storageKey(userId: string, name: "open") {
  return `spot:operator-agent:${userId}:${name}`;
}

function readStoredState(userId: string) {
  try {
    const storedOpen = localStorage.getItem(storageKey(userId, "open"));
    return {
      open: storedOpen === null ? true : storedOpen === "true",
    };
  } catch {
    return { open: true };
  }
}

export function OperatorAgentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { scope } = useSpotSync();
  const requestedThreadId = searchParams.get("agentThread");

  return (
    <OperatorAgentPageProvider
      key={`${scope.userId}:${pathname}:${requestedThreadId ?? ""}`}
      pathname={pathname}
      userId={scope.userId ?? null}
      requestedThreadId={requestedThreadId}
    >
      {children}
    </OperatorAgentPageProvider>
  );
}

function OperatorAgentPageProvider({
  children,
  pathname,
  userId,
  requestedThreadId,
}: {
  children: React.ReactNode;
  pathname: string;
  userId: string | null;
  requestedThreadId: string | null;
}) {
  const enabled =
    pathname.startsWith("/operator") &&
    !pathname.startsWith("/operator/login") &&
    !pathname.startsWith("/operator/threads");
  const [open, setOpen] = useState(true);
  const [activeThreadIdState, setActiveThreadIdState] = useState<string | null>(
    requestedThreadId,
  );
  const [detachedPageContextKey, setDetachedPageContextKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!userId) {
        setOpen(true);
        return;
      }
      const stored = readStoredState(userId);
      setOpen(requestedThreadId ? true : stored.open);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [userId, requestedThreadId]);

  const persistOpen = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!userId) return;
      try {
        localStorage.setItem(storageKey(userId, "open"), String(next));
      } catch {}
    },
    [userId],
  );

  const value = useMemo<OperatorAgentContextValue>(
    () => ({
      activeThreadId: activeThreadIdState,
      detachedPageContextKey,
      enabled,
      open: enabled && open,
      attachPageContext: () => setDetachedPageContextKey(null),
      close: () => persistOpen(false),
      detachPageContext: setDetachedPageContextKey,
      setActiveThreadId: setActiveThreadIdState,
      toggle: () => {
        if (!open) {
          setActiveThreadIdState(null);
          setDetachedPageContextKey(null);
        }
        persistOpen(!open);
      },
    }),
    [
      activeThreadIdState,
      detachedPageContextKey,
      enabled,
      open,
      persistOpen,
    ],
  );

  return (
    <OperatorAgentContext.Provider value={value}>
      {children}
    </OperatorAgentContext.Provider>
  );
}

export function useOptionalOperatorAgent() {
  return useContext(OperatorAgentContext);
}
