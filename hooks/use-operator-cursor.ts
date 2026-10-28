"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { pointerIsPrivate } from "@/components/operator-agent/page-multiplayer";
import {
  publishedUiJson,
  subscribePublishedUi,
} from "@/hooks/use-followed-state";

/** Twenty updates a second reads as live without flooding Convex. */
const PUBLISH_INTERVAL_MS = 50;

/**
 * CSS path from <body> to `element`. Followers run the same app on the same
 * route, so the path usually lands on the same element even when their window
 * size or scroll position differs.
 */
function cursorAnchor(element: Element | null) {
  const parts: string[] = [];
  let node = element;
  while (node && node !== document.body) {
    const parent: Element | null = node.parentElement;
    if (!parent) return undefined;
    const index = Array.prototype.indexOf.call(parent.children, node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
    node = parent;
  }
  return parts.length ? `body > ${parts.join(" > ")}` : undefined;
}

/** Matches the server cap; an oversized map is skipped rather than failing. */
const UI_STATE_LIMIT = 50_000;
const UI_PUBLISH_DELAY_MS = 50;

function currentHref() {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Streams this operator's pointer to Convex while `pointer` (a teammate shares
 * the page or follows them) and their followed UI state while `ui` (someone
 * follows them).
 */
export function usePublishOperatorCursor({
  pointer: pointerEnabled,
  ui: uiEnabled,
}: {
  pointer: boolean;
  ui: boolean;
}) {
  const move = useMutation(api.operatorCursors.move);
  const clear = useMutation(api.operatorCursors.clear);
  const publishUi = useMutation(api.operatorCursors.publishUi);

  // Followed UI state goes on its own row, sent only when it changes.
  useEffect(() => {
    if (!uiEnabled) return;
    let sent: string | null = null;
    let timer: number | null = null;
    const send = () => {
      timer = null;
      const ui = publishedUiJson();
      if (ui === sent || ui.length > UI_STATE_LIMIT) return;
      sent = ui;
      void publishUi({ ui }).catch(() => {});
    };
    const schedule = () => {
      timer ??= window.setTimeout(send, UI_PUBLISH_DELAY_MS);
    };
    send();
    const unsubscribe = subscribePublishedUi(schedule);
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [uiEnabled, publishUi]);

  useEffect(() => {
    if (!pointerEnabled) return;
    let pointer: { x: number; y: number } | null = null;
    let visible = true;
    let lastSent = 0;
    let lastHref = "";
    let timer: number | null = null;

    const send = () => {
      timer = null;
      lastSent = performance.now();
      const { innerWidth, innerHeight } = window;
      const at = pointer ?? { x: innerWidth / 2, y: innerHeight / 2 };
      const element = document.elementFromPoint(at.x, at.y);
      const hidden = pointerIsPrivate(element);
      const rect = element?.getBoundingClientRect();
      const anchored = !hidden && rect && rect.width > 0 && rect.height > 0;
      lastHref = currentHref();
      void move({
        href: lastHref,
        anchor: anchored ? cursorAnchor(element) : undefined,
        x: anchored ? (at.x - rect.left) / rect.width : 0,
        y: anchored ? (at.y - rect.top) / rect.height : 0,
        viewportX: at.x / innerWidth,
        viewportY: at.y / innerHeight,
        visible: visible && pointer !== null && !hidden,
      }).catch(() => {});
    };
    const schedule = () => {
      if (timer !== null) return;
      const wait = Math.max(
        0,
        PUBLISH_INTERVAL_MS - (performance.now() - lastSent),
      );
      timer = window.setTimeout(send, wait);
    };
    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      visible = true;
      schedule();
    };
    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      visible = false;
      schedule();
    };

    send();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut);
    // Scrolling changes what sits under a still pointer.
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    // Client navigation has no event; catch route and tab changes by polling.
    const hrefWatch = window.setInterval(() => {
      if (currentHref() !== lastHref) schedule();
    }, 250);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(hrefWatch);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("scroll", schedule, { capture: true });
      void clear().catch(() => {});
    };
  }, [pointerEnabled, move, clear]);
}
