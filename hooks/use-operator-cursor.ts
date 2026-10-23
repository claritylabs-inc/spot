"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
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

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
  "",
]);
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "PRE",
  "BLOCKQUOTE",
  "TR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

/**
 * Plain text of a rich editor with the caret offsets in that same text, so a
 * follower can redraw it. Blocks and <br> become newlines.
 */
function editableText(root: HTMLElement) {
  const range = window.getSelection()?.rangeCount
    ? window.getSelection()!.getRangeAt(0)
    : null;
  let text = "";
  let selectionStart = -1;
  let selectionEnd = -1;
  const mark = (node: Node, offset: number) => {
    if (range?.startContainer === node && range.startOffset === offset) {
      selectionStart = text.length;
    }
    if (range?.endContainer === node && range.endOffset === offset) {
      selectionEnd = text.length;
    }
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = node.textContent ?? "";
      if (range?.startContainer === node)
        selectionStart = text.length + range.startOffset;
      if (range?.endContainer === node)
        selectionEnd = text.length + range.endOffset;
      text += data;
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.tagName === "BR") {
      text += "\n";
      return;
    }
    if (
      node !== root &&
      BLOCK_TAGS.has(node.tagName) &&
      text &&
      !text.endsWith("\n")
    ) {
      text += "\n";
    }
    node.childNodes.forEach((child, index) => {
      mark(node, index);
      walk(child);
    });
    mark(node, node.childNodes.length);
  };
  walk(root);
  if (selectionStart < 0)
    selectionStart = selectionEnd < 0 ? text.length : selectionEnd;
  if (selectionEnd < 0) selectionEnd = selectionStart;
  return { text, selectionStart, selectionEnd };
}

/**
 * The text field this operator is typing in. Passwords, one-time codes and
 * anything inside `data-follow-private` are never shared.
 */
function focusedField() {
  const element = document.activeElement;
  if (
    !(element instanceof HTMLElement) ||
    element.closest("[data-follow-private]")
  ) {
    return undefined;
  }
  if (
    /one-time-code|password/.test(element.getAttribute("autocomplete") ?? "")
  ) {
    return undefined;
  }
  let value: { text: string; selectionStart: number; selectionEnd: number };
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement
  ) {
    if (
      element instanceof HTMLInputElement &&
      !TEXT_INPUT_TYPES.has(element.type)
    ) {
      return undefined;
    }
    // Number inputs have no selection API.
    let selectionStart = element.value.length;
    let selectionEnd = selectionStart;
    try {
      selectionStart = element.selectionStart ?? selectionStart;
      selectionEnd = element.selectionEnd ?? selectionEnd;
    } catch {}
    value = { text: element.value, selectionStart, selectionEnd };
  } else if (element.isContentEditable) {
    value = editableText(element);
  } else {
    return undefined;
  }
  const anchor = cursorAnchor(element);
  return anchor ? { anchor, ...value } : undefined;
}

/** Matches the server cap; an oversized map is dropped rather than failing the update. */
const UI_STATE_LIMIT = 50_000;

function followedUi() {
  const json = publishedUiJson();
  return json.length > UI_STATE_LIMIT ? undefined : json;
}

function currentHref() {
  return `${window.location.pathname}${window.location.search}`;
}

/** Streams this operator's pointer to Convex while `enabled` (someone follows them). */
export function usePublishOperatorCursor(enabled: boolean) {
  const move = useMutation(api.operatorCursors.move);
  const clear = useMutation(api.operatorCursors.clear);

  useEffect(() => {
    if (!enabled) return;
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
      const rect = element?.getBoundingClientRect();
      const anchored = rect && rect.width > 0 && rect.height > 0;
      lastHref = currentHref();
      void move({
        href: lastHref,
        anchor: anchored ? cursorAnchor(element) : undefined,
        x: anchored ? (at.x - rect.left) / rect.width : 0,
        y: anchored ? (at.y - rect.top) / rect.height : 0,
        viewportX: at.x / innerWidth,
        viewportY: at.y / innerHeight,
        visible: visible && pointer !== null,
        field: focusedField(),
        ui: followedUi(),
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
    // Typing, caret moves and focus changes happen without the pointer.
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("input", schedule, { capture: true });
    window.addEventListener("focusin", schedule, { capture: true });
    window.addEventListener("focusout", schedule, { capture: true });
    // Panels, tabs and other followed state change without the pointer too.
    const unsubscribeUi = subscribePublishedUi(schedule);
    // Client navigation has no event; catch route and tab changes by polling.
    const hrefWatch = window.setInterval(() => {
      if (currentHref() !== lastHref) schedule();
    }, 250);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(hrefWatch);
      unsubscribeUi();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("scroll", schedule, { capture: true });
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("input", schedule, { capture: true });
      window.removeEventListener("focusin", schedule, { capture: true });
      window.removeEventListener("focusout", schedule, { capture: true });
      void clear().catch(() => {});
    };
  }, [enabled, move, clear]);
}
