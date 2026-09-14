"use client";

import { createContext, useContext, useState, useCallback, useMemo } from "react";

export interface PageContext {
  pageType: string;
  entityId?: string;
  summary?: string;
  href?: string;
}

interface PageContextValue {
  context: PageContext | null;
  setPageContext: (ctx: PageContext | null) => void;
}

const Ctx = createContext<PageContextValue>({
  context: null,
  setPageContext: () => {},
});

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<PageContext | null>(null);

  const setPageContext = useCallback((ctx: PageContext | null) => {
    setContext(ctx);
  }, []);

  const value = useMemo(() => ({ context, setPageContext }), [context, setPageContext]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageContext() {
  return useContext(Ctx);
}
