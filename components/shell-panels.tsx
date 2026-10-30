"use client";

import dayjs from "dayjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useAppMinWidth } from "@/hooks/use-app-container-width";
import { cn } from "@/lib/utils";

/**
 * Side panels beside the page. Any number can be open: a page renders a
 * `<ShellPanel>` per drawer it shows and opening one never closes another.
 * `ShellPanelsLayout` lays them out as columns after the page in the order
 * they opened. Up to three columns (the page and two panels) share the width;
 * from four, each keeps its own width and the row scrolls sideways, like
 * TweetDeck. Phones show one panel at a time, full screen; closing it returns
 * to the one before.
 */
export type ShellPanelKind = "entity" | "detail" | "preview" | "pdf";

type ShellPanelEntry = {
  id: string;
  kind: ShellPanelKind;
  /** Mail and other reading surfaces open wider. */
  wide: boolean;
  openedAt: number;
  focusedAt: number;
};

type ShellPanelsValue = {
  panels: ShellPanelEntry[];
  host: (id: string) => HTMLElement | null;
  register: (id: string, kind: ShellPanelKind, wide: boolean) => void;
  unregister: (id: string) => void;
  focus: (id: string) => void;
  /** Whether `id` is the panel used most recently. */
  isFront: (id: string) => boolean;
  setCloseHandler: (id: string, close: (() => void) | undefined) => void;
};

const ShellPanelsContext = createContext<ShellPanelsValue | null>(null);

export function ShellPanelsProvider({
  maxPanels,
  children,
}: {
  /** Closes the least recently used panel past this many. Unset: no limit. */
  maxPanels?: number;
  children: ReactNode;
}) {
  const [panels, setPanels] = useState<ShellPanelEntry[]>([]);
  // Each panel renders into its own node, which the layout moves between a
  // column and a full-screen sheet without remounting the panel's content.
  const hosts = useRef(new Map<string, HTMLElement>());
  const closers = useRef(new Map<string, () => void>());

  const host = useCallback((id: string) => {
    if (typeof document === "undefined") return null;
    let node = hosts.current.get(id);
    if (!node) {
      node = document.createElement("div");
      node.className = "flex h-full min-h-0 w-full min-w-0";
      hosts.current.set(id, node);
    }
    return node;
  }, []);

  const register = useCallback(
    (id: string, kind: ShellPanelKind, wide: boolean) => {
      const now = dayjs().valueOf();
      setPanels((current) =>
        current.some((panel) => panel.id === id)
          ? current.map((panel) =>
              panel.id === id ? { ...panel, kind, wide } : panel,
            )
          : [...current, { id, kind, wide, openedAt: now, focusedAt: now }],
      );
    },
    [],
  );

  const unregister = useCallback((id: string) => {
    setPanels((current) => current.filter((panel) => panel.id !== id));
    closers.current.delete(id);
  }, []);

  const focus = useCallback((id: string) => {
    const now = dayjs().valueOf();
    setPanels((current) =>
      current.some((panel) => panel.id === id) && !frontOf(current, id)
        ? current.map((panel) =>
            panel.id === id ? { ...panel, focusedAt: now } : panel,
          )
        : current,
    );
  }, []);
  const latest = useRef(panels);
  useEffect(() => {
    latest.current = panels;
  });
  const isFront = useCallback((id: string) => frontOf(latest.current, id), []);

  const setCloseHandler = useCallback(
    (id: string, close: (() => void) | undefined) => {
      if (close) closers.current.set(id, close);
      else closers.current.delete(id);
    },
    [],
  );

  useEffect(() => {
    if (maxPanels === undefined || panels.length <= maxPanels) return;
    const leastRecent = [...panels]
      .sort((a, b) => a.focusedAt - b.focusedAt)
      .find((panel) => closers.current.has(panel.id));
    if (leastRecent) closers.current.get(leastRecent.id)?.();
  }, [maxPanels, panels]);

  const value = useMemo(
    () => ({
      panels,
      host,
      register,
      unregister,
      focus,
      isFront,
      setCloseHandler,
    }),
    [focus, host, isFront, panels, register, setCloseHandler, unregister],
  );
  return (
    <ShellPanelsContext.Provider value={value}>
      {children}
    </ShellPanelsContext.Provider>
  );
}

function frontOf(panels: ShellPanelEntry[], id: string) {
  const target = panels.find((panel) => panel.id === id);
  return (
    !!target && panels.every((panel) => panel.focusedAt <= target.focusedAt)
  );
}

export function useShellPanels() {
  return useContext(ShellPanelsContext);
}

const ShellPanelIdContext = createContext<string | null>(null);

/** Marks `children` as content of panel `id`, for content portalled in from a page. */
export function ShellPanelScope({
  id,
  children,
}: {
  id: string | null;
  children: ReactNode;
}) {
  return (
    <ShellPanelIdContext.Provider value={id}>
      {children}
    </ShellPanelIdContext.Provider>
  );
}

/**
 * For content inside a panel: `focus` scrolls the panel into view (or brings
 * it to the front on phones); `setOnClose` lets the shell close it;
 * `ownsEscape` tells whether an Escape press should close this panel: the one
 * holding focus, or else the one used most recently.
 */
export function useShellPanel() {
  const id = useContext(ShellPanelIdContext);
  const panels = useShellPanels();
  const focus = panels?.focus;
  const isFront = panels?.isFront;
  const setCloseHandler = panels?.setCloseHandler;
  return useMemo(
    () =>
      id && focus && isFront && setCloseHandler
        ? {
            focus: () => focus(id),
            setOnClose: (close: (() => void) | undefined) =>
              setCloseHandler(id, close),
            ownsEscape: (event: Event | undefined) => {
              const holder =
                event?.target instanceof Element
                  ? event.target.closest<HTMLElement>("[data-shell-panel]")
                  : null;
              return holder ? holder.dataset.shellPanel === id : isFront(id);
            },
          }
        : null,
    [focus, id, isFront, setCloseHandler],
  );
}

/**
 * Renders `children` as a side panel. Mounting opens it after the open panels
 * and scrolls it into view; unmounting closes it. A changed `focusKey` (the
 * record shown) scrolls it into view again.
 */
export function ShellPanel({
  id,
  kind,
  wide = false,
  focusKey,
  onClose,
  children,
}: {
  id: string;
  kind: ShellPanelKind;
  wide?: boolean;
  focusKey?: string | number | null;
  onClose?: () => void;
  children: ReactNode;
}) {
  const panels = useShellPanels();
  const register = panels?.register;
  const unregister = panels?.unregister;
  const focus = panels?.focus;
  const setCloseHandler = panels?.setCloseHandler;
  useLayoutEffect(() => {
    register?.(id, kind, wide);
  }, [id, kind, register, wide]);
  useLayoutEffect(() => {
    if (!unregister) return;
    return () => unregister(id);
  }, [id, unregister]);
  useLayoutEffect(() => {
    if (focusKey !== undefined) focus?.(id);
  }, [focus, focusKey, id]);
  useLayoutEffect(() => {
    setCloseHandler?.(id, onClose);
  }, [id, onClose, setCloseHandler]);

  const target = panels?.host(id) ?? null;
  if (!target) return null;
  return createPortal(
    <ShellPanelScope id={id}>{children}</ShellPanelScope>,
    target,
  );
}

/** Width each kind opens at and its resize bounds, in pixels. */
function panelSize(panel: Pick<ShellPanelEntry, "kind" | "wide">) {
  switch (panel.kind) {
    case "entity":
      return { key: "entity", width: 400, min: 320, max: 700 };
    case "detail":
      return panel.wide
        ? { key: "detail-wide", width: 640, min: 360, max: 960 }
        : { key: "detail", width: 420, min: 320, max: 760 };
    case "preview":
      return { key: "preview", width: 440, min: 320, max: 760 };
    case "pdf":
      return { key: "pdf", width: 540, min: 400, max: 900 };
  }
}

/** The page column keeps at least this width; past it the row scrolls. */
const PAGE_MIN_WIDTH = 480;
/** From this many panels (four columns with the page), columns keep their widths. */
const SCROLL_FROM_PANELS = 3;

// Panel widths the user dragged to, per kind, remembered in this browser.
const savedWidths = new Map<string, string>();
const widthListeners = new Set<() => void>();

function readWidths(storageKey: string) {
  if (!savedWidths.has(storageKey)) {
    try {
      const saved = localStorage.getItem(storageKey) ?? "{}";
      JSON.parse(saved);
      savedWidths.set(storageKey, saved);
    } catch {
      savedWidths.set(storageKey, "{}");
    }
  }
  return savedWidths.get(storageKey) ?? "{}";
}

function subscribeWidths(listener: () => void) {
  widthListeners.add(listener);
  return () => void widthListeners.delete(listener);
}

function usePanelWidths(userId: string | undefined) {
  const storageKey = `spot:shell-panel-widths:${userId ?? "pending"}`;
  const json = useSyncExternalStore(
    subscribeWidths,
    () => readWidths(storageKey),
    () => "{}",
  );
  const widths = useMemo(
    () => JSON.parse(json) as Record<string, number>,
    [json],
  );
  const save = useCallback(
    (changed: Record<string, number>) => {
      const next = JSON.stringify({ ...widths, ...changed });
      savedWidths.set(storageKey, next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Restricted storage keeps the width for this session only.
      }
      widthListeners.forEach((listener) => listener());
    },
    [storageKey, widths],
  );
  return [widths, save] as const;
}

/**
 * The page and its side panels. Columns at tablet widths and up, a
 * full-screen sheet per panel on phones. The page keeps its place in the tree
 * across layouts, so it never remounts.
 */
export function ShellPanelsLayout({
  main,
  storageUserId,
}: {
  main: ReactNode;
  storageUserId?: string;
}) {
  const shellPanels = useShellPanels();
  const panels = useMemo(
    () =>
      [...(shellPanels?.panels ?? [])].sort((a, b) => a.openedAt - b.openedAt),
    [shellPanels?.panels],
  );
  const sheets = !useAppMinWidth(768);
  const scrolling = panels.length >= SCROLL_FROM_PANELS;
  const [widths, saveWidth] = usePanelWidths(storageUserId);
  const rowRef = useRef<HTMLDivElement>(null);
  const front = panels.reduce<ShellPanelEntry | null>(
    (latest, panel) =>
      !latest || panel.focusedAt > latest.focusedAt ? panel : latest,
    null,
  );

  // Bring the panel just opened or focused into view.
  const frontId = front?.id;
  const frontFocusedAt = front?.focusedAt;
  useEffect(() => {
    const row = rowRef.current;
    if (sheets || !row || !frontId) return;
    const column = row.querySelector<HTMLElement>(
      `[data-shell-panel="${CSS.escape(frontId)}"]`,
    );
    if (!column) return;
    const left = column.offsetLeft;
    const right = left + column.offsetWidth;
    const view = row.scrollLeft;
    const target =
      left < view || column.offsetWidth > row.clientWidth
        ? left
        : right > view + row.clientWidth
          ? right - row.clientWidth
          : view;
    if (target === view) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    row.scrollTo({ left: target, behavior: reduceMotion ? "auto" : "smooth" });
  }, [frontFocusedAt, frontId, sheets]);

  // Shade the edges the row can scroll toward.
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const row = rowRef.current;
    if (sheets || !row) return;
    const update = () => {
      const start = row.scrollLeft > 1;
      const end = row.scrollLeft < row.scrollWidth - row.clientWidth - 1;
      setEdges((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(row);
    for (const child of row.children) observer.observe(child);
    row.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      row.removeEventListener("scroll", update);
    };
  }, [panels, sheets]);
  const edgeShade =
    "pointer-events-none sticky z-30 w-3 shrink-0 from-foreground/8 to-transparent transition-opacity";

  return (
    <div
      ref={rowRef}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1",
        sheets
          ? "overflow-hidden"
          : "table-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain",
      )}
    >
      <div
        aria-hidden
        className={cn(
          edgeShade,
          "left-0 -mr-3 bg-linear-to-r",
          (sheets || !edges.start) && "opacity-0",
        )}
      />
      <div
        inert={sheets && panels.length > 0}
        className="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
        style={
          !sheets && panels.length > 0
            ? { minWidth: PAGE_MIN_WIDTH }
            : undefined
        }
      >
        {main}
      </div>
      {panels.map((panel) => {
        const size = panelSize(panel);
        const width = Math.min(
          size.max,
          Math.max(size.min, widths[size.key] ?? size.width),
        );
        const outlet = (
          <PanelHostOutlet
            host={shellPanels?.host(panel.id) ?? null}
            // Safari can scroll a column when a nested popup takes focus;
            // clip without creating a scrollport.
            className="flex h-full min-h-0 w-full min-w-0 overflow-clip"
          />
        );
        return sheets ? (
          <div
            key={panel.id}
            data-shell-panel={panel.id}
            onPointerDownCapture={() => shellPanels?.focus(panel.id)}
            className={cn(
              "absolute inset-0 z-40 flex bg-background",
              panel.id !== front?.id && "hidden",
            )}
          >
            {outlet}
          </div>
        ) : (
          <div
            key={panel.id}
            data-shell-panel={panel.id}
            data-shell-panel-size={size.key}
            onPointerDownCapture={() => shellPanels?.focus(panel.id)}
            className="relative flex h-full"
            style={{
              flex: `0 ${scrolling ? 0 : 1} ${width}px`,
              minWidth: scrolling ? width : size.min,
            }}
          >
            <ColumnResizeHandle
              rowRef={rowRef}
              fixed={scrolling}
              min={size.min}
              max={size.max}
              width={width}
              onResize={saveWidth}
            />
            {outlet}
          </div>
        );
      })}
      <div
        aria-hidden
        className={cn(
          edgeShade,
          "right-0 -ml-3 bg-linear-to-l",
          (sheets || !edges.end) && "opacity-0",
        )}
      />
    </div>
  );
}

/** Holds `host` in place; moving it between outlets keeps its React content mounted. */
function PanelHostOutlet({
  host,
  className,
}: {
  host: HTMLElement | null;
  className?: string;
}) {
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      if (element && host) element.appendChild(host);
    },
    [host],
  );
  return <div ref={attach} className={className} />;
}

/**
 * Drags a column's left edge. The column's right edge stays put: the page
 * gives up width while it can, then the other panels, then the row scrolls.
 * Saves every column's width as shown, so a squeezed row stays as arranged.
 */
function ColumnResizeHandle({
  rowRef,
  fixed,
  min,
  max,
  width,
  onResize,
}: {
  rowRef: RefObject<HTMLDivElement | null>;
  /** The column keeps its width rather than shrinking to fit. */
  fixed: boolean;
  min: number;
  max: number;
  width: number;
  onResize: (widths: Record<string, number>) => void;
}) {
  const drag = useRef<{
    x: number;
    width: number;
    limit: number;
    flex: string;
  } | null>(null);
  // Shared columns grow only into room the page and other panels can give.
  const widest = (column: HTMLElement) => {
    const row = rowRef.current;
    if (fixed || !row) return max;
    const others = [
      ...row.querySelectorAll<HTMLElement>(":scope > [data-shell-panel-size]"),
    ].filter((other) => other !== column);
    const room =
      row.clientWidth -
      PAGE_MIN_WIDTH -
      others.reduce(
        (sum, other) => sum + parseFloat(getComputedStyle(other).minWidth),
        0,
      );
    return Math.max(column.offsetWidth, Math.min(max, room));
  };
  const resizeTo = (column: HTMLElement, next: number, limit: number) => {
    const row = rowRef.current;
    if (!row) return;
    const clamped = Math.round(Math.min(limit, Math.max(min, next)));
    const right = column.getBoundingClientRect().right;
    column.style.flex = `0 0 ${clamped}px`;
    if (fixed) column.style.minWidth = `${clamped}px`;
    row.scrollLeft += column.getBoundingClientRect().right - right;
  };
  const save = () => {
    const columns = rowRef.current?.querySelectorAll<HTMLElement>(
      ":scope > [data-shell-panel-size]",
    );
    onResize(
      Object.fromEntries(
        [...(columns ?? [])].map((column) => [
          column.dataset.shellPanelSize,
          column.offsetWidth,
        ]),
      ),
    );
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize touch-none outline-none select-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-foreground/10 focus-visible:after:bg-foreground/10 data-dragging:after:bg-foreground/16"
      onPointerDown={(event) => {
        // Dragging would otherwise start a text selection across the page.
        event.preventDefault();
        const column = event.currentTarget.parentElement;
        if (!column) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = "";
        drag.current = {
          x: event.clientX,
          width: column.offsetWidth,
          limit: widest(column),
          flex: column.style.flex,
        };
      }}
      onPointerMove={(event) => {
        const column = event.currentTarget.parentElement;
        if (!drag.current || !column) return;
        resizeTo(
          column,
          drag.current.width + drag.current.x - event.clientX,
          drag.current.limit,
        );
      }}
      onPointerUp={(event) => {
        const column = event.currentTarget.parentElement;
        if (!drag.current || !column) return;
        resizeTo(
          column,
          drag.current.width + drag.current.x - event.clientX,
          drag.current.limit,
        );
        save();
        column.style.flex = drag.current.flex;
        drag.current = null;
        delete event.currentTarget.dataset.dragging;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        const column = event.currentTarget.parentElement;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (!column) return;
        event.preventDefault();
        const flex = column.style.flex;
        resizeTo(
          column,
          column.offsetWidth + (event.key === "ArrowLeft" ? 16 : -16),
          widest(column),
        );
        save();
        column.style.flex = flex;
      }}
    />
  );
}
