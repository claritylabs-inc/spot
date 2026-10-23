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
import { usePanelRef } from "react-resizable-panels";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableSeparator,
} from "@claritylabs-inc/ui/components/resizable";
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

const AGENT_DOCK_BAR_HEIGHT = 44;
export const AGENT_CHAT_SURFACE =
  "bg-(--chat-surface) [--chat-surface:color-mix(in_srgb,var(--muted)_40%,var(--background))] dark:[--chat-surface:#050506]";
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

/** Artifact card width beside the conversation on wide screens; drag to resize. */
const ARTIFACT_CARD_DEFAULT_WIDTH = 480;
const ARTIFACT_CARD_WIDTH_KEY = "spot:agent-dock:artifact-width";

function readArtifactWidth() {
  try {
    const stored = Number(localStorage.getItem(ARTIFACT_CARD_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= 320
      ? stored
      : ARTIFACT_CARD_DEFAULT_WIDTH;
  } catch {
    return ARTIFACT_CARD_DEFAULT_WIDTH;
  }
}
const ARTIFACT_CARD_MIN_WIDTH = "320px";
const ARTIFACT_CARD_MAX_WIDTH = "80%";

export function DockBody({
  adapter,
  mode,
  onActions,
  artifactPanelRef,
  artifactPlacement = "overlay",
  artifactOpen = false,
}: {
  adapter: AgentDockAdapter;
  mode: AgentDockMode;
  onActions: (actions: ReactNode) => void;
  artifactPanelRef?: (element: HTMLElement | null) => void;
  /** `side` opens artifacts as a card beside the chat; `overlay` covers it. */
  artifactPlacement?: "side" | "overlay";
  artifactOpen?: boolean;
}) {
  const dock = useAgentDock();
  const { Chat } = adapter;
  const chatKey = dock.activeThreadId ?? "new";
  const artifactPanel = usePanelRef();
  const [artifactWidth] = useState(readArtifactWidth);
  const [animating, setAnimating] = useState(false);
  const sideArtifacts = Boolean(artifactPanelRef) && artifactPlacement === "side";

  // The artifact panel stays mounted so an artifact can portal in before the
  // card opens; opening expands it and shifts the chat left.
  useEffect(() => {
    if (!sideArtifacts) return;
    const panel = artifactPanel.current;
    if (!panel) return;
    // Animate only the open/close, never a drag.
    setAnimating(true);
    const timer = window.setTimeout(() => setAnimating(false), 250);
    if (artifactOpen && panel.isCollapsed()) panel.expand();
    else if (!artifactOpen && !panel.isCollapsed()) panel.collapse();
    return () => window.clearTimeout(timer);
  }, [artifactOpen, artifactPanel, sideArtifacts]);

  const chat = (
    <div
      className="@container relative flex min-h-0 min-w-0 flex-1 flex-col"
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
    </div>
  );

  if (sideArtifacts) {
    return (
      <ResizablePanelGroup
        id="agent-dock-artifact-panels"
        orientation="horizontal"
        className="relative flex min-h-0 flex-1"
      >
        <ResizablePanel
          id="agent-dock-chat"
          minSize="320px"
          className={cn(
            "flex h-full min-w-0 flex-col",
            animating && "transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          {chat}
        </ResizablePanel>
        <ResizableSeparator
          id="agent-dock-artifact-separator"
          aria-label="Resize artifact"
          className={cn(!artifactOpen && "pointer-events-none lg:hidden")}
        />
        <ResizablePanel
          id="agent-dock-artifact"
          panelRef={artifactPanel}
          collapsible
          collapsedSize={0}
          defaultSize={artifactOpen ? `${artifactWidth}px` : 0}
          onResize={({ inPixels }) => {
            if (!artifactOpen || inPixels < 320) return;
            try {
              localStorage.setItem(
                ARTIFACT_CARD_WIDTH_KEY,
                String(Math.round(inPixels)),
              );
            } catch {
              // Restricted storage keeps the width for this session only.
            }
          }}
          minSize={ARTIFACT_CARD_MIN_WIDTH}
          maxSize={ARTIFACT_CARD_MAX_WIDTH}
          groupResizeBehavior="preserve-pixel-size"
          className={cn(
            "h-full overflow-hidden",
            animating && "transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none",
          )}
          inert={!artifactOpen}
        >
          <div className="h-full py-2 pr-2">
            <div
              ref={artifactPanelRef}
              className="flex h-full w-full overflow-hidden rounded-xl border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-14px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.6)]"
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      {chat}
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
 * away. Its content follows the animated card height so the sidebar and page
 * stay in sync throughout mode changes and dragging.
 */
export function AgentDockLayout({
  app,
  adapter,
  artifactPanelRef,
  artifactPlacement,
  artifactOpen = false,
  detailPanelOpen,
}: {
  app: ReactNode;
  adapter: AgentDockAdapter | null;
  artifactPanelRef?: (element: HTMLElement | null) => void;
  artifactPlacement?: "side" | "overlay";
  artifactOpen?: boolean;
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
  const setMode = dock.setMode;
  const wasDetailOpenRef = useRef(detailPanelOpen);

  const wasArtifactOpenRef = useRef(artifactOpen);

  // Artifacts open inside the dock, so a collapsed dock opens to show them.
  useEffect(() => {
    const opened = artifactOpen && !wasArtifactOpenRef.current;
    wasArtifactOpenRef.current = artifactOpen;
    if (opened && dock.mode === "collapsed") setMode("expanded");
  }, [artifactOpen, dock.mode, setMode]);

  // Detail panels open beside the page, so full screen steps down to show them.
  useEffect(() => {
    const opened = detailPanelOpen && !wasDetailOpenRef.current;
    wasDetailOpenRef.current = detailPanelOpen;
    if (opened && dock.mode === "full" && !mobile) setMode("expanded");
  }, [detailPanelOpen, dock.mode, mobile, setMode]);

  const transition = reduceMotion || dragHeight !== null ? { duration: 0 } : SPRING;

  return (
    <div className={cn("relative h-dvh w-full overflow-hidden", AGENT_CHAT_SURFACE)}>
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
                artifactPlacement={artifactPlacement}
                artifactOpen={artifactOpen}
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
            "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-14px_rgba(0,0,0,0.1)] ring-1 ring-foreground/[0.04] dark:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.6)] dark:ring-foreground/20",
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
        inert={mode === "full"}
        aria-hidden={mode === "full" || undefined}
      >
        <div className="h-full">{app}</div>
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
