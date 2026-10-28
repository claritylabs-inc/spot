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
  /** Layers a narrower context (an open panel) over the page's; call the result to remove it. */
  pushPageContext: (ctx: PageContext) => () => void;
}

const Ctx = createContext<PageContextValue>({
  context: null,
  setPageContext: () => {},
  pushPageContext: () => () => {},
});

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [base, setBase] = useState<PageContext | null>(null);
  const [layers, setLayers] = useState<{ id: symbol; context: PageContext }[]>([]);

  const setPageContext = useCallback((ctx: PageContext | null) => {
    setBase(ctx);
  }, []);

  const pushPageContext = useCallback((ctx: PageContext) => {
    const id = Symbol();
    setLayers((current) => [...current, { id, context: ctx }]);
    return () => setLayers((current) => current.filter((layer) => layer.id !== id));
  }, []);

  const context = layers.at(-1)?.context ?? base;
  const value = useMemo(
    () => ({ context, setPageContext, pushPageContext }),
    [context, setPageContext, pushPageContext],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageContext() {
  return useContext(Ctx);
}
