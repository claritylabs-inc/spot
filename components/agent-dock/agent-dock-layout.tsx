"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { ArrowDown } from "lucide-react";
import { useMediaQuery } from "@/components/app-sidebar/utils";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { AgentDockBar } from "./agent-dock-bar";
import { AgentDockHistory } from "./agent-dock-history";
import { useAgentDock } from "./agent-dock-provider";
import { DockErrorBoundary } from "./dock-error-boundary";
import type { AgentDockMode } from "./dock-state";
import { AGENT_DOCK_MAX_HEIGHT, AGENT_DOCK_MIN_HEIGHT } from "./dock-storage";
import type { AgentDockAdapter } from "./types";

export const AGENT_DOCK_BAR_HEIGHT = 44;
/** Frame around the lifted app card while the agent is open. */
const CARD_GAP = 8;
const CARD_RADIUS = 12;
/** In full screen, this much of the app card stays visible at the top. */
const CARD_LIP = 20;

const SPRING: Transition = { type: "spring", stiffness: 380, damping: 40, mass: 0.9 };

let viewportSnapshot = { width: 1440, height: 900 };
function readViewport() {
  if (
    viewportSnapshot.width !== window.innerWidth ||
    viewportSnapshot.height !== window.innerHeight
  ) {
    viewportSnapshot = { width: window.innerWidth, height: window.innerHeight };
  }
  return viewportSnapshot;
}
function subscribeViewport(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}
const SERVER_VIEWPORT = { width: 1440, height: 900 };

function useViewport() {
  return useSyncExternalStore(subscribeViewport, readViewport, () => SERVER_VIEWPORT);
}

/**
 * Drags between the collapsed bar and full screen. Releasing past the midpoint
 * between a resize limit and the next mode snaps into that mode.
 */
function ResizeHandle({
  viewportHeight,
  minHeight,
  maxHeight,
  onDrag,
  onCommit,
}: {
  viewportHeight: number;
  /** Pixel height of the collapsed bar. */
  minHeight: number;
  /** Pixel height of the dock in full screen. */
  maxHeight: number;
  onDrag: (heightPx: number | null) => void;
  onCommit: (fraction: number) => void;
}) {
  const dock = useAgentDock();
  const heightAt = (clientY: number) =>
    Math.min(maxHeight, Math.max(minHeight, viewportHeight - clientY));
  const release = (heightPx: number) => {
    const fraction = heightPx / viewportHeight;
    const collapseBelow = (AGENT_DOCK_MIN_HEIGHT + minHeight / viewportHeight) / 2;
    const fullAbove = (AGENT_DOCK_MAX_HEIGHT + maxHeight / viewportHeight) / 2;
    if (fraction < collapseBelow) dock.setMode("collapsed");
    else if (fraction > fullAbove) dock.setMode("full");
    else onCommit(fraction);
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize agent"
      aria-valuemin={30}
      aria-valuemax={90}
      aria-valuenow={Math.round(dock.height * 100)}
      tabIndex={0}
      className="group/resize absolute inset-x-0 top-0 z-10 flex h-2.5 cursor-row-resize touch-none items-center select-none justify-center outline-none"
      onPointerDown={(event) => {
        // Dragging would otherwise start a text selection across the page.
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onDrag(Math.round(heightAt(event.clientY)));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        release(heightAt(event.clientY));
        onDrag(null);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const up = event.key === "ArrowUp";
        if (up && dock.height >= AGENT_DOCK_MAX_HEIGHT) dock.setMode("full");
        else if (!up && dock.height <= AGENT_DOCK_MIN_HEIGHT) dock.setMode("collapsed");
        else dock.setHeight(dock.height + (up ? 0.05 : -0.05));
      }}
    >
      <span className="h-1 w-10 rounded-full bg-foreground/15 transition-colors group-hover/resize:bg-foreground/30 group-focus-visible/resize:bg-foreground/40" />
    </div>
  );
}

function DockBody({
  adapter,
  mode,
  onActions,
  artifactPanelRef,
}: {
  adapter: AgentDockAdapter;
  mode: AgentDockMode;
  onActions: (actions: ReactNode) => void;
  artifactPanelRef?: (element: HTMLElement | null) => void;
}) {
  const dock = useAgentDock();
  const { Chat } = adapter;
  const chatKey = dock.activeThreadId ?? "new";
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onClickCapture={(event) => {
        // Following a link from full screen reveals the page behind the dock.
        if (mode !== "full" || event.metaKey || event.ctrlKey) return;
        const link =
          event.target instanceof Element
            ? event.target.closest("a[href^='/']")
            : null;
        if (link && link.getAttribute("target") !== "_blank") {
          dock.setMode("expanded");
        }
      }}
    >
      {dock.view === "history" ? (
        <AgentDockHistory adapter={adapter} />
      ) : (
        <DockErrorBoundary
          key={chatKey}
          fallback={
            <p
              className={cn(
                "px-6 py-10 text-center text-muted-foreground",
                typeStyle("body.default"),
              )}
            >
              This chat is unavailable.
            </p>
          }
        >
          <Chat
            threadId={dock.activeThreadId}
            onThreadCreated={(threadId) => dock.openThread(threadId)}
            onActions={onActions}
          />
        </DockErrorBoundary>
      )}
      {artifactPanelRef ? (
        <div
          ref={artifactPanelRef}
          className="absolute inset-0 z-20 flex bg-background empty:hidden"
        />
      ) : null}
    </div>
  );
}

/**
 * The agent lives on the base layer and the app sits above it as a card.
 * Collapsed, the card covers everything but the agent bar; expanded, the card
 * lifts and shrinks to reveal the chat underneath; full screen, it slides
 * away. While the card moves, its content keeps a fixed layout height so only
 * the card box itself is laid out per frame; the content settles afterwards.
 */
export function AgentDockLayout({
  app,
  adapter,
  artifactPanelRef,
  detailPanelOpen,
}: {
  app: ReactNode;
  adapter: AgentDockAdapter | null;
  artifactPanelRef?: (element: HTMLElement | null) => void;
  detailPanelOpen: boolean;
}) {
  const dock = useAgentDock();
  const viewport = useViewport();
  const mobile = useMediaQuery("(max-width: 767px)");
  const reduceMotion = useReducedMotion();
  const enabled = adapter !== null;
  const mode: AgentDockMode = !enabled
    ? "collapsed"
    : mobile && dock.mode === "expanded"
      ? "full"
      : dock.mode;
  const [animatedSettledMode, setSettledMode] = useState(mode);
  const settledMode = reduceMotion ? mode : animatedSettledMode;
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [actions, setActions] = useState<ReactNode>(null);
  const barHeight = enabled ? AGENT_DOCK_BAR_HEIGHT : 0;
  const fullDockHeight = viewport.height - CARD_GAP - CARD_LIP;
  const expandedDockHeight =
    dragHeight ?? Math.round(viewport.height * dock.height);
  const dockHeight =
    mode === "collapsed"
      ? barHeight
      : mode === "full"
        ? fullDockHeight
        : expandedDockHeight;
  const lifted = mode !== "collapsed";
  const cardScale = lifted
    ? (viewport.width - CARD_GAP * 2) / viewport.width
    : 1;
  const restingCardHeight = viewport.height - barHeight;
  const cardHeight = lifted
    ? (viewport.height - expandedDockHeight - CARD_GAP) / cardScale
    : restingCardHeight;
  // Full screen slides the card up until only its bottom lip shows.
  const cardY =
    mode === "full"
      ? CARD_GAP + CARD_LIP - cardHeight * cardScale
      : lifted
        ? CARD_GAP
        : 0;
  const geometryKey = `${mode}:${cardHeight}`;
  const [settledGeometryKey, setSettledGeometryKey] = useState(geometryKey);
  const moving =
    !reduceMotion && (geometryKey !== settledGeometryKey || dragHeight !== null);
  const setMode = dock.setMode;
  const wasDetailOpenRef = useRef(detailPanelOpen);

  // Detail panels open beside the page, so full screen steps down to show them.
  useEffect(() => {
    const opened = detailPanelOpen && !wasDetailOpenRef.current;
    wasDetailOpenRef.current = detailPanelOpen;
    if (opened && dock.mode === "full" && !mobile) setMode("expanded");
  }, [detailPanelOpen, dock.mode, mobile, setMode]);

  const transition = reduceMotion || dragHeight !== null ? { duration: 0 } : SPRING;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-(--chat-surface) [--chat-surface:color-mix(in_srgb,var(--muted)_40%,var(--background))] dark:[--chat-surface:#0b0c0d]">
      {adapter ? (
        <motion.section
          data-agent-dock
          aria-label="Spot agent"
          className="absolute inset-x-0 bottom-0 flex flex-col"
          initial={false}
          animate={{ height: dockHeight }}
          transition={transition}
          onAnimationComplete={() => setSettledMode(mode)}
        >
          {mode === "expanded" && !mobile ? (
            <ResizeHandle
              viewportHeight={viewport.height}
              minHeight={barHeight}
              maxHeight={fullDockHeight}
              onDrag={setDragHeight}
              onCommit={dock.setHeight}
            />
          ) : null}
          {mode !== "collapsed" || settledMode !== "collapsed" ? (
            <motion.div
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
            >
              <DockBody
                adapter={adapter}
                mode={mode}
                onActions={setActions}
                artifactPanelRef={artifactPanelRef}
              />
            </motion.div>
          ) : null}
          <AgentDockBar
            adapter={adapter}
            mode={mode}
            mobile={mobile}
            actions={actions}
          />
        </motion.section>
      ) : null}
      <motion.div
        className={cn(
          "absolute inset-x-0 top-0 z-10 origin-top overflow-hidden bg-background",
          enabled &&
            "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-14px_rgba(0,0,0,0.1)] ring-1 ring-foreground/[0.04]",
        )}
        initial={false}
        animate={{
          height: cardHeight,
          scale: cardScale,
          y: cardY,
          borderRadius: lifted
            ? `${CARD_RADIUS}px ${CARD_RADIUS}px ${CARD_RADIUS}px ${CARD_RADIUS}px`
            : `0px 0px ${enabled ? CARD_RADIUS : 0}px ${enabled ? CARD_RADIUS : 0}px`,
        }}
        transition={transition}
        onAnimationComplete={() => setSettledGeometryKey(geometryKey)}
        inert={mode === "full"}
        aria-hidden={mode === "full" || undefined}
      >
        <div style={{ height: moving ? restingCardHeight : "100%" }}>{app}</div>
      </motion.div>
      {mode === "full" ? (
        <motion.button
          type="button"
          aria-label="Show page"
          onClick={() => setMode("expanded")}
          className="absolute left-1/2 z-20 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          style={{ top: CARD_GAP + CARD_LIP - 14 }}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: reduceMotion ? 0 : 0.15 }}
        >
          <ArrowDown className="size-3.5" />
        </motion.button>
      ) : null}
    </div>
  );
}
