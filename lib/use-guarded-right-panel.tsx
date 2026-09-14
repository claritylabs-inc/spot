"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type CloseGuard = () => Promise<boolean>;
const CloseGuardContext = createContext<
  ((guard: CloseGuard) => () => void) | null
>(null);

export function useRightPanelCloseGuard(guard: CloseGuard) {
  const register = useContext(CloseGuardContext);
  useLayoutEffect(() => register?.(guard), [guard, register]);
}

export function useGuardedRightPanel() {
  const [panel, setPanel] = useState<ReactNode>(null);
  const guard = useRef<CloseGuard | null>(null);
  const latestChange = useRef(0);
  const register = useCallback((nextGuard: CloseGuard) => {
    guard.current = nextGuard;
    return () => {
      if (guard.current === nextGuard) guard.current = null;
    };
  }, []);
  const setRightPanel = useCallback((nextPanel: ReactNode) => {
    const change = ++latestChange.current;
    const currentGuard = guard.current;
    if (!currentGuard) {
      setPanel(nextPanel);
      return;
    }
    void currentGuard().then((saved) => {
      if (
        saved &&
        change === latestChange.current &&
        guard.current === currentGuard
      ) {
        setPanel(nextPanel);
      }
    });
  }, []);

  return {
    rightPanel: panel ? (
      <CloseGuardContext.Provider value={register}>
        {panel}
      </CloseGuardContext.Provider>
    ) : null,
    setRightPanel,
  };
}
