"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface PageContext {
  pageType: string;
  entityId?: string;
  summary?: string;
  href?: string;
  /** Records related to the entity, e.g. `{ kind: "organization", id }`. */
  related?: { kind: string; id: string; label?: string }[];
}

interface PageContextValue {
  context: PageContext | null;
  setPageContext: (ctx: PageContext | null) => void;
  /** Layers a narrower context (an open panel) over the page's; call the result to remove it. */
  pushPageContext: (ctx: PageContext) => () => void;
  /** Sets or removes one layer by ID, keeping its place in the stack when it changes. */
  setPageContextLayer: (id: symbol, ctx: PageContext | null) => void;
}

const Ctx = createContext<PageContextValue>({
  context: null,
  setPageContext: () => {},
  pushPageContext: () => () => {},
  setPageContextLayer: () => {},
});

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [base, setBase] = useState<PageContext | null>(null);
  const [layers, setLayers] = useState<{ id: symbol; context: PageContext }[]>([]);

  const setPageContext = useCallback((ctx: PageContext | null) => {
    setBase(ctx);
  }, []);

  const setPageContextLayer = useCallback(
    (id: symbol, ctx: PageContext | null) => {
      setLayers((current) => {
        const index = current.findIndex((layer) => layer.id === id);
        if (!ctx) {
          return index === -1 ? current : current.filter((layer) => layer.id !== id);
        }
        if (index === -1) return [...current, { id, context: ctx }];
        const next = current.slice();
        next[index] = { id, context: ctx };
        return next;
      });
    },
    [],
  );

  const pushPageContext = useCallback(
    (ctx: PageContext) => {
      const id = Symbol();
      setPageContextLayer(id, ctx);
      return () => setPageContextLayer(id, null);
    },
    [setPageContextLayer],
  );

  const context = layers.at(-1)?.context ?? base;
  const value = useMemo(
    () => ({ context, setPageContext, pushPageContext, setPageContextLayer }),
    [context, setPageContext, pushPageContext, setPageContextLayer],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageContext() {
  return useContext(Ctx);
}

/**
 * Layers `ctx` over the page's while it is set (an open drawer, a selected
 * row). Summary changes update the layer in place, so a panel opened later
 * stays on top.
 */
export function usePageContextLayer(ctx: PageContext | null) {
  const { setPageContextLayer } = usePageContext();
  const [id] = useState(() => Symbol());
  const pageType = ctx?.pageType;
  const entityId = ctx?.entityId;
  const summary = ctx?.summary;
  // Keyed by value so a freshly built array does not re-set the layer.
  const related = ctx?.related?.length ? JSON.stringify(ctx.related) : undefined;
  useEffect(() => {
    setPageContextLayer(
      id,
      pageType
        ? {
            pageType,
            entityId,
            summary,
            ...(related ? { related: JSON.parse(related) } : {}),
          }
        : null,
    );
  }, [entityId, id, pageType, related, setPageContextLayer, summary]);
  useEffect(() => () => setPageContextLayer(id, null), [id, setPageContextLayer]);
}
