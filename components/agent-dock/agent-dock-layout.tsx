"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { motion, useReducedMotion, type Transition } from "framer-motion";
import { ArrowDown, ArrowRight } from "lucide-react";
import { usePanelRef } from "react-resizable-panels";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableSeparator,
} from "@claritylabs-inc/ui/components/resizable";
import { useMediaQuery } from "@/components/app-sidebar/utils";
import { setAppContainerWidth } from "@/hooks/use-app-container-width";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import {
  AGENT_DOCK_RAIL_WIDTH,
  AgentDockBar,
  AgentDockTabSidebar,
} from "./agent-dock-bar";
import { AgentDockHistory } from "./agent-dock-history";
import { useAgentDock } from "./agent-dock-provider";
import { DockErrorBoundary } from "./dock-error-boundary";
import type { AgentDockMode } from "./dock-state";
import {
  AGENT_DOCK_MAX_HEIGHT,
  AGENT_DOCK_MAX_WIDTH,
  AGENT_DOCK_MIN_HEIGHT,
  AGENT_DOCK_MIN_WIDTH,
} from "./dock-storage";
import type { AgentDockAdapter } from "./types";

const AGENT_DOCK_BAR_HEIGHT = 44;
export const AGENT_CHAT_SURFACE =
  "bg-(--chat-surface) [--chat-surface:color-mix(in_srgb,var(--muted)_40%,var(--background))] dark:[--chat-surface:#050506]";
/** Frame around the lifted app card while the agent is open. */
const CARD_GAP = 8;
const CARD_RADIUS = 12;
/** In full screen, this much of the app card stays visible at the top. */
const CARD_LIP = 20;
/** The right dock's chat never gets narrower than this beside its tabs. */
const RIGHT_CHAT_MIN_WIDTH = 360;

export type AgentDockPlacement = "bottom" | "right";

const SPRING: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 40,
  mass: 0.9,
};

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
  return useSyncExternalStore(
    subscribeViewport,
    readViewport,
    () => SERVER_VIEWPORT,
  );
}

/**
 * Drags between the collapsed bar and full screen, vertically for the bottom
 * dock and horizontally for the right one. Releasing past the midpoint between
 * a resize limit and the next mode snaps into that mode.
 */
function ResizeHandle({
  axis,
  viewportSize,
  minSize,
  minExpandedSize = 0,
  maxSize,
  onDrag,
}: {
  /** `y` resizes the bottom dock's height, `x` the right dock's width. */
  axis: "x" | "y";
  viewportSize: number;
  /** Pixel size of the collapsed bar or rail. */
  minSize: number;
  /** Smallest expanded pixel size; dragging below it heads for collapsed. */
  minExpandedSize?: number;
  /** Pixel size of the dock in full screen. */
  maxSize: number;
  onDrag: (sizePx: number | null) => void;
}) {
  const dock = useAgentDock();
  const vertical = axis === "y";
  const [fraction, baseMinFraction, maxFraction, setFraction] = vertical
    ? [dock.height, AGENT_DOCK_MIN_HEIGHT, AGENT_DOCK_MAX_HEIGHT, dock.setHeight]
    : [dock.width, AGENT_DOCK_MIN_WIDTH, AGENT_DOCK_MAX_WIDTH, dock.setWidth];
  const minFraction = Math.min(
    maxFraction,
    Math.max(baseMinFraction, minExpandedSize / viewportSize),
  );
  const sizeAt = (event: { clientX: number; clientY: number }) =>
    Math.min(
      maxSize,
      Math.max(
        minSize,
        viewportSize - (vertical ? event.clientY : event.clientX),
      ),
    );
  const release = (sizePx: number) => {
    const next = sizePx / viewportSize;
    const collapseBelow = (minFraction + minSize / viewportSize) / 2;
    const fullAbove = (maxFraction + maxSize / viewportSize) / 2;
    if (next < collapseBelow) dock.setMode("collapsed");
    else if (next > fullAbove) dock.setMode("full");
    else setFraction(Math.max(minFraction, next));
  };
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      aria-label="Resize agent"
      aria-valuemin={Math.round(minFraction * 100)}
      aria-valuemax={Math.round(maxFraction * 100)}
      aria-valuenow={Math.round(Math.max(minFraction, fraction) * 100)}
      tabIndex={0}
      className={cn(
        "group/resize absolute z-10 flex touch-none items-center select-none justify-center outline-none",
        vertical
          ? "inset-x-0 top-0 h-2.5 cursor-row-resize"
          : "inset-y-0 left-0 w-2.5 cursor-col-resize",
      )}
      onPointerDown={(event) => {
        // Dragging would otherwise start a text selection across the page.
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onDrag(Math.round(Math.max(minExpandedSize, sizeAt(event))));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        release(sizeAt(event));
        onDrag(null);
      }}
      onKeyDown={(event) => {
        const grow = vertical ? "ArrowUp" : "ArrowLeft";
        const shrink = vertical ? "ArrowDown" : "ArrowRight";
        if (event.key !== grow && event.key !== shrink) return;
        event.preventDefault();
        const up = event.key === grow;
        if (up && fraction >= maxFraction) dock.setMode("full");
        else if (!up && fraction <= minFraction) dock.setMode("collapsed");
        else
          setFraction(Math.max(minFraction, fraction + (up ? 0.05 : -0.05)));
      }}
    >
      <span
        className={cn(
          "rounded-full bg-foreground/15 transition-colors group-hover/resize:bg-foreground/30 group-focus-visible/resize:bg-foreground/40",
          vertical ? "h-1 w-10" : "h-10 w-1",
        )}
      />
    </div>
  );
}

/** Tracks the height of the chat composer rendered inside `container`. */
function useComposerHeight(container: HTMLElement | null) {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!container) return;
    let observed: HTMLElement | null = null;
    const resize = new ResizeObserver(() => {
      if (observed) setHeight(observed.offsetHeight);
    });
    const find = () => {
      const next = container.querySelector<HTMLElement>("[data-chat-composer]");
      if (next === observed) return;
      if (observed) resize.unobserve(observed);
      observed = next;
      if (next) resize.observe(next);
      else setHeight(null);
    };
    find();
    const mutations = new MutationObserver(find);
    mutations.observe(container, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      resize.disconnect();
    };
  }, [container]);
  return height;
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
  artifactPanelRef: artifactTarget,
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
  const [prevOpen, setPrevOpen] = useState(artifactOpen);
  const sideArtifacts =
    artifactTarget !== undefined && artifactPlacement === "side";

  // Animate only the open/close, never a drag.
  if (prevOpen !== artifactOpen) {
    setPrevOpen(artifactOpen);
    setAnimating(true);
  }
  useEffect(() => {
    if (!animating) return;
    const timer = window.setTimeout(() => setAnimating(false), 250);
    return () => window.clearTimeout(timer);
  }, [animating]);

  // The artifact panel stays mounted so an artifact can portal in before the
  // card opens; opening expands it and shifts the chat left.
  useEffect(() => {
    if (!sideArtifacts) return;
    const panel = artifactPanel.current;
    if (!panel) return;
    if (artifactOpen && panel.isCollapsed()) {
      // Expanding a panel that mounted collapsed lands on its minimum size, so
      // restore the width the user last chose.
      const width = readArtifactWidth();
      panel.expand();
      panel.resize(`${width}px`);
    } else if (!artifactOpen && !panel.isCollapsed()) panel.collapse();
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
            animating &&
              "transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          {chat}
        </ResizablePanel>
        <ResizableSeparator
          id="agent-dock-artifact-separator"
          aria-label="Resize artifact"
          className={cn(
            "data-[separator=active]:after:bg-transparent data-[separator=focus]:after:bg-transparent data-[separator=hover]:after:bg-transparent",
            !artifactOpen && "pointer-events-none lg:hidden",
          )}
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
            animating &&
              "transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none",
          )}
          inert={!artifactOpen}
        >
          <div className="h-full py-2 pr-2">
            <div
              ref={artifactTarget}
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
      {artifactTarget ? (
        <div
          ref={artifactTarget}
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
 * away. Its content follows the animated card size so the sidebar and page
 * stay in sync throughout mode changes and dragging.
 *
 * `placement` puts the dock below the page or, on desktop, to its right with
 * the tabs as a vertical sidebar along the right edge.
 */
export function AgentDockLayout({
  app,
  adapter,
  placement = "bottom",
  artifactPanelRef,
  artifactPlacement,
  artifactOpen = false,
  detailPanelOpen,
}: {
  app: ReactNode;
  adapter: AgentDockAdapter | null;
  placement?: AgentDockPlacement;
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
  const right = placement === "right" && !mobile;
  const mode: AgentDockMode = !enabled
    ? "collapsed"
    : mobile && dock.mode === "expanded"
      ? "full"
      : dock.mode;
  const [animatedSettledMode, setSettledMode] = useState(mode);
  const settledMode = reduceMotion ? mode : animatedSettledMode;
  const [dragSize, setDragSize] = useState<number | null>(null);
  const [actions, setActions] = useState<ReactNode>(null);
  const [rightSection, setRightSection] = useState<HTMLElement | null>(null);
  const [appContainer, setAppContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!appContainer) return;
    const observer = new ResizeObserver(() =>
      setAppContainerWidth(appContainer.offsetWidth),
    );
    observer.observe(appContainer);
    return () => {
      observer.disconnect();
      setAppContainerWidth(null);
    };
  }, [appContainer]);
  const composerHeight = useComposerHeight(rightSection);
  const lifted = mode !== "collapsed";
  const viewportSize = right ? viewport.width : viewport.height;
  const barSize = !enabled ? 0 : right ? AGENT_DOCK_RAIL_WIDTH : AGENT_DOCK_BAR_HEIGHT;
  const fullDockSize = viewportSize - CARD_GAP - CARD_LIP;
  const minExpandedWidth =
    (dock.tabsCollapsed ? AGENT_DOCK_RAIL_WIDTH : dock.tabsWidth) +
    RIGHT_CHAT_MIN_WIDTH;
  const expandedDockSize =
    dragSize ??
    (right
      ? Math.max(minExpandedWidth, Math.round(viewport.width * dock.width))
      : Math.round(viewport.height * dock.height));
  const dockSize =
    mode === "collapsed"
      ? barSize
      : mode === "full"
        ? fullDockSize
        : expandedDockSize;
  // The bottom dock lifts the card by scaling it; the right one narrows it.
  const cardScale =
    lifted && !right ? (viewport.width - CARD_GAP * 2) / viewport.width : 1;
  const card = right
    ? (() => {
        const width = lifted
          ? viewport.width - expandedDockSize - CARD_GAP
          : viewport.width - barSize;
        return {
          width,
          height: lifted ? viewport.height - CARD_GAP * 2 : viewport.height,
          // Full screen slides the card left until only its right lip shows.
          x:
            mode === "full"
              ? CARD_GAP + CARD_LIP - width
              : lifted
                ? CARD_GAP
                : 0,
          y: lifted ? CARD_GAP : 0,
        };
      })()
    : (() => {
        const height = lifted
          ? (viewport.height - expandedDockSize - CARD_GAP) / cardScale
          : viewport.height - barSize;
        return {
          width: "100%",
          height,
          x: 0,
          // Full screen slides the card up until only its bottom lip shows.
          y:
            mode === "full"
              ? CARD_GAP + CARD_LIP - height * cardScale
              : lifted
                ? CARD_GAP
                : 0,
        };
      })();
  const restingRadius = enabled ? CARD_RADIUS : 0;
  const cardRadius = lifted
    ? `${CARD_RADIUS}px ${CARD_RADIUS}px ${CARD_RADIUS}px ${CARD_RADIUS}px`
    : right
      ? `0px ${restingRadius}px ${restingRadius}px 0px`
      : `0px 0px ${restingRadius}px ${restingRadius}px`;
  const setMode = dock.setMode;
  // Mid-transition the body keeps its widest size, so the narrowing dock
  // clips it behind the card instead of reflowing the text.
  const settledSizeRef = useRef(dockSize);
  const transitioning = right && mode !== settledMode;
  useEffect(() => {
    if (!transitioning) settledSizeRef.current = dockSize;
  }, [transitioning, dockSize]);
  const bodyWidth = transitioning
    ? Math.max(settledSizeRef.current, dockSize) -
      (dock.tabsCollapsed ? AGENT_DOCK_RAIL_WIDTH : dock.tabsWidth)
    : undefined;
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

  const transition =
    reduceMotion || dragSize !== null ? { duration: 0 } : SPRING;
  const showBody = mode !== "collapsed" || settledMode !== "collapsed";

  return (
    <div
      className={cn(
        "relative h-dvh w-full overflow-hidden",
        AGENT_CHAT_SURFACE,
      )}
    >
      {adapter && right ? (
        <motion.section
          key="right"
          ref={setRightSection}
          data-agent-dock
          aria-label="Spot agent"
          className="absolute inset-y-0 right-0 flex justify-end"
          initial={false}
          animate={{ width: dockSize }}
          transition={transition}
          onAnimationComplete={() => setSettledMode(mode)}
        >
          {mode === "expanded" ? (
            <ResizeHandle
              axis="x"
              viewportSize={viewport.width}
              minSize={barSize}
              minExpandedSize={minExpandedWidth}
              maxSize={fullDockSize}
              onDrag={setDragSize}
            />
          ) : null}
          {showBody ? (
            <motion.div
              className={cn(
                "flex min-h-0 min-w-0 flex-col overflow-hidden",
                bodyWidth === undefined ? "flex-1" : "shrink-0",
              )}
              style={bodyWidth === undefined ? undefined : { width: bodyWidth }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
            >
              {mode !== "collapsed" && dock.view === "chat" && actions ? (
                <div className="flex h-11 shrink-0 items-center justify-end gap-1 px-3">
                  {actions}
                </div>
              ) : null}
              <DockBody
                adapter={adapter}
                mode={mode}
                onActions={setActions}
                artifactPanelRef={artifactPanelRef}
                // Too narrow beside the page for a second column.
                artifactPlacement="overlay"
                artifactOpen={artifactOpen}
              />
            </motion.div>
          ) : null}
          <AgentDockTabSidebar
            adapter={adapter}
            mode={mode}
            composerHeight={mode === "collapsed" ? null : composerHeight}
          />
        </motion.section>
      ) : adapter ? (
        <motion.section
          key="bottom"
          data-agent-dock
          aria-label="Spot agent"
          className="absolute inset-x-0 bottom-0 flex flex-col"
          initial={false}
          animate={{ height: dockSize }}
          transition={transition}
          onAnimationComplete={() => setSettledMode(mode)}
        >
          {mode === "expanded" && !mobile ? (
            <ResizeHandle
              axis="y"
              viewportSize={viewport.height}
              minSize={barSize}
              maxSize={fullDockSize}
              onDrag={setDragSize}
            />
          ) : null}
          {showBody ? (
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
          "absolute top-0 left-0 z-10 origin-top overflow-hidden bg-background",
          enabled &&
            "shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_-14px_rgba(0,0,0,0.1)] ring-1 ring-foreground/[0.04] dark:shadow-[0_8px_24px_-14px_rgba(0,0,0,0.6)] dark:ring-foreground/20",
        )}
        initial={false}
        animate={{
          ...card,
          scale: cardScale,
          borderRadius: cardRadius,
        }}
        transition={transition}
        inert={mode === "full"}
        aria-hidden={mode === "full" || undefined}
      >
        {/* The `app` container: breakpoints inside follow the card's width,
            and fixed drawers and overlays stay within the card. */}
        <div ref={setAppContainer} className="@container/app h-full contain-layout">
          {app}
        </div>
      </motion.div>
      {mode === "full" ? (
        <motion.button
          type="button"
          aria-label="Show page"
          onClick={() => setMode("expanded")}
          className={cn(
            "absolute z-20 flex size-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground",
            right ? "top-1/2 -translate-y-1/2" : "left-1/2 -translate-x-1/2",
          )}
          style={
            right
              ? { left: CARD_GAP + CARD_LIP - 14 }
              : { top: CARD_GAP + CARD_LIP - 14 }
          }
          initial={right ? { opacity: 0, x: -4 } : { opacity: 0, y: -4 }}
          animate={right ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: reduceMotion ? 0 : 0.15 }}
        >
          {right ? (
            <ArrowRight className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )}
        </motion.button>
      ) : null}
    </div>
  );
}
