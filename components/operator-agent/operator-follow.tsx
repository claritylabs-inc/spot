"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { setMirroredUi } from "@/hooks/use-followed-state";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

type FollowedCursor = NonNullable<
  FunctionReturnType<typeof api.operatorCursors.get>
>;

/** Seconds for the drawn pointer to close most of the gap to its target; glides between 20Hz updates. */
const POINTER_EASE_S = 0.07;

const POINTER_PATH = "M4.5 4 16 9.2 10.9 10.9 9.2 16Z";

type MirroredField = NonNullable<FollowedCursor["field"]>;

const MIRRORED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textIndent",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "color",
] as const;

function currentHref() {
  return `${window.location.pathname}${window.location.search}`;
}

/** Elements marked with this keep follow mode on when the follower clicks them. */
export const FOLLOW_CONTROL_ATTRIBUTE = "data-follow-control";

function scrollParent(element: Element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
  }
  return document.scrollingElement;
}

/** Where the leader's pointer falls in this window, anchored to the same element when it exists here. */
function cursorPoint(cursor: FollowedCursor) {
  const element = cursor.anchor ? document.querySelector(cursor.anchor) : null;
  const rect = element?.getBoundingClientRect();
  if (element && rect && rect.width > 0 && rect.height > 0) {
    return {
      element,
      left: rect.left + cursor.x * rect.width,
      top: rect.top + cursor.y * rect.height,
    };
  }
  return {
    element: null,
    left: cursor.viewportX * window.innerWidth,
    top: cursor.viewportY * window.innerHeight,
  };
}

/**
 * Follows another operator: navigates with them, scrolls so their pointer sits
 * where it does on their screen, and draws it. Any scroll, click or key from
 * the follower outside follow controls hands control back.
 */
export function OperatorFollow({
  userId,
  name,
  pathname,
  onStop,
}: {
  userId: Id<"users">;
  name: string;
  /** Leader's page from presence, used until their live cursor arrives. */
  pathname: string;
  onStop: () => void;
}) {
  const router = useRouter();
  const cursor = useQuery(api.operatorCursors.get, { userId });
  const cursorRef = useRef<FollowedCursor | null>(null);
  const pointerRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(false);
  const stopFollowing = useEffectEvent(onStop);

  const href = cursor?.href ?? pathname;
  useEffect(() => {
    if (href !== currentHref()) {
      router.push(href);
    }
  }, [href, router]);

  useEffect(() => {
    cursorRef.current = cursor ?? null;
    pendingScrollRef.current = true;
  }, [cursor]);

  // Show the leader's panels, tabs and filters; keep them when following stops.
  const ui = useQuery(api.operatorCursors.ui, { userId });
  // No row means every value is at its default.
  useEffect(() => setMirroredUi(ui === undefined ? null : (ui ?? "{}")), [ui]);
  useEffect(() => () => setMirroredUi(null), []);

  // Position from the latest cursor every frame so layout shifts, loading
  // content and window resizes keep the pointer on its element.
  useEffect(() => {
    let frame = 0;
    let drawn: { left: number; top: number } | null = null;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const elapsed = (now - last) / 1000;
      last = now;
      const node = pointerRef.current;
      const current = cursorRef.current;
      if (!node) return;
      const samePage = current && current.href === currentHref();
      if (!current || !samePage || !current.visible) {
        node.style.opacity = "0";
        drawn = null;
        return;
      }
      let point = cursorPoint(current);
      // While they type, the field mirror owns scrolling.
      if (pendingScrollRef.current && point.element && !current.field) {
        pendingScrollRef.current = false;
        const delta = point.top - current.viewportY * window.innerHeight;
        const scroller = scrollParent(point.element);
        if (scroller && Math.abs(delta) > 8) {
          scroller.scrollTop += delta;
          point = cursorPoint(current);
        }
      }
      // Appear in place, then ease toward each new point.
      const ease = drawn ? 1 - Math.exp(-elapsed / POINTER_EASE_S) : 1;
      drawn = {
        left:
          (drawn?.left ?? point.left) +
          (point.left - (drawn?.left ?? point.left)) * ease,
        top:
          (drawn?.top ?? point.top) +
          (point.top - (drawn?.top ?? point.top)) * ease,
      };
      node.style.opacity = "1";
      node.style.transform = `translate3d(${drawn.left}px, ${drawn.top}px, 0)`;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const isControl = (event: Event) =>
      event.target instanceof Element &&
      !!event.target.closest(`[${FOLLOW_CONTROL_ATTRIBUTE}]`);
    const stop = (event: Event) => {
      if (!isControl(event)) stopFollowing();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
      if (event.key === "Escape") {
        // This Escape only stops following; the adopted panels stay open.
        event.preventDefault();
        event.stopImmediatePropagation();
        stopFollowing();
      } else if (!isControl(event)) stopFollowing();
    };
    window.addEventListener("pointerdown", stop, { capture: true });
    window.addEventListener("wheel", stop, { capture: true, passive: true });
    window.addEventListener("touchmove", stop, {
      capture: true,
      passive: true,
    });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", stop, { capture: true });
      window.removeEventListener("wheel", stop, { capture: true });
      window.removeEventListener("touchmove", stop, { capture: true });
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100]">
      <div className="absolute inset-0 shadow-[inset_0_0_0_1.5px_var(--color-brand),inset_0_0_24px_-6px_var(--color-brand)]" />
      <div
        {...{ [FOLLOW_CONTROL_ATTRIBUTE]: "" }}
        className={cn(
          "pointer-events-auto absolute top-0 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-b-md bg-brand py-0.5 pr-1 pl-2.5 text-brand-foreground",
          typeStyle("caption.medium"),
        )}
      >
        Following {name}
        <button
          type="button"
          onClick={onStop}
          aria-label={`Stop following ${name}`}
          className="flex size-4 items-center justify-center rounded-sm hover:bg-brand-foreground/15"
        >
          <X className="size-3" />
        </button>
      </div>
      {cursor?.field ? (
        <FieldMirror field={cursor.field} href={cursor.href} name={name} />
      ) : null}
      <div
        ref={pointerRef}
        aria-hidden
        className="absolute top-0 left-0 opacity-0 transition-opacity duration-150 will-change-transform"
      >
        <div className="absolute -top-7 -left-7 size-14 rounded-full bg-[radial-gradient(circle,var(--color-background)_0%,transparent_70%)] opacity-90" />
        <svg
          viewBox="0 0 20 20"
          className="relative -mt-0.5 -ml-0.5 size-5 text-muted-foreground drop-shadow-[0_1px_2px_rgb(0_0_0/0.18)]"
        >
          {/* A background halo stroke, then a fat same-color stroke to round every corner. */}
          <path
            d={POINTER_PATH}
            fill="var(--color-background)"
            stroke="var(--color-background)"
            strokeWidth="5"
            strokeLinejoin="round"
          />
          <path
            d={POINTER_PATH}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinejoin="round"
          />
        </svg>
        <span
          className={cn(
            "absolute top-4 left-3.5 rounded-full bg-muted-foreground/92 px-1.5 py-0.5 whitespace-nowrap text-background shadow-[0_1px_3px_rgb(0_0_0/0.15)]",
            typeStyle("caption.medium"),
          )}
        >
          {name}
        </span>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Read-only copy of the field the leader is typing in, drawn over the same
 * field here with their text, selection and caret. The follower's own input is
 * never written, so their drafts and autosave are untouched.
 */
function FieldMirror({
  field,
  href,
  name,
}: {
  field: MirroredField;
  href: string;
  name: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const flagRef = useRef<HTMLSpanElement>(null);
  const pendingRevealRef = useRef(true);

  useEffect(() => {
    pendingRevealRef.current = true;
  }, [field]);

  useEffect(() => {
    let frame = 0;
    let styled: Element | null = null;
    // Scroll containers and panes that clip the field, such as the page pane
    // above an open agent dock.
    let clippers: Element[] = [];
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const box = boxRef.current;
      const flag = flagRef.current;
      if (!box || !flag) return;
      const target =
        href === currentHref() ? document.querySelector(field.anchor) : null;
      const rect = target?.getBoundingClientRect();
      if (!target || !rect || rect.width === 0 || rect.height === 0) {
        box.style.display = "none";
        flag.style.display = "none";
        styled = null;
        return;
      }
      if (target !== styled) {
        styled = target;
        clippers = [];
        for (let node = target.parentElement; node; node = node.parentElement) {
          const { overflowX, overflowY } = getComputedStyle(node);
          if (overflowX !== "visible" || overflowY !== "visible") {
            clippers.push(node);
          }
        }
        const computed = getComputedStyle(target);
        for (const property of MIRRORED_STYLES) {
          box.style[property] = computed[property];
        }
        const background = computed.backgroundColor;
        box.style.backgroundColor =
          background === "rgba(0, 0, 0, 0)" || background === "transparent"
            ? "var(--color-background)"
            : background;
        const singleLine = target instanceof HTMLInputElement;
        box.style.whiteSpace = singleLine ? "pre" : "pre-wrap";
        box.style.display = singleLine ? "flex" : "block";
      } else if (box.style.display === "none") {
        box.style.display =
          target instanceof HTMLInputElement ? "flex" : "block";
      }
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      const bounds = {
        top: 0,
        left: 0,
        bottom: window.innerHeight,
        right: window.innerWidth,
      };
      for (const clipper of clippers) {
        const clip = clipper.getBoundingClientRect();
        bounds.top = Math.max(bounds.top, clip.top);
        bounds.left = Math.max(bounds.left, clip.left);
        bounds.bottom = Math.min(bounds.bottom, clip.bottom);
        bounds.right = Math.min(bounds.right, clip.right);
      }
      box.style.clipPath = `inset(${Math.max(0, bounds.top - rect.top)}px ${Math.max(0, rect.right - bounds.right)}px ${Math.max(0, rect.bottom - bounds.bottom)}px ${Math.max(0, bounds.left - rect.left)}px)`;
      if (pendingRevealRef.current) {
        pendingRevealRef.current = false;
        // Fields taller than the visible area reveal the caret instead.
        const outside =
          (rect.top < bounds.top || rect.bottom > bounds.bottom) &&
          rect.height <= bounds.bottom - bounds.top;
        if (outside) target.scrollIntoView({ block: "nearest" });
        // Keep the caret inside the box, as the real field would.
        const caret = caretRef.current;
        if (caret) {
          box.scrollTop = 0;
          box.scrollLeft = 0;
          const caretRect = caret.getBoundingClientRect();
          const boxRect = box.getBoundingClientRect();
          box.scrollTop = Math.max(0, caretRect.bottom - boxRect.bottom + 8);
          box.scrollLeft = Math.max(0, caretRect.right - boxRect.right + 8);
          // A field taller than its pane, such as notes, needs the caret
          // itself scrolled into view. Rects are stale after scrollIntoView,
          // so that case waits for the next update.
          const shown = caret.getBoundingClientRect();
          const scroller = outside ? null : scrollParent(target);
          if (scroller && shown.bottom > bounds.bottom) {
            scroller.scrollTop += shown.bottom - bounds.bottom + 8;
          } else if (scroller && shown.top < bounds.top) {
            scroller.scrollTop -= bounds.top - shown.top + 8;
          }
        }
      }
      const caretRect = caretRef.current?.getBoundingClientRect();
      if (
        caretRect &&
        caretRect.bottom > bounds.top &&
        caretRect.top < bounds.bottom
      ) {
        flag.style.display = "block";
        flag.style.transform = `translate3d(${caretRect.left}px, ${caretRect.top}px, 0)`;
      } else {
        flag.style.display = "none";
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [field.anchor, href]);

  const start = Math.min(field.selectionStart, field.selectionEnd);
  const end = Math.max(field.selectionStart, field.selectionEnd);
  return (
    <>
      <div
        ref={boxRef}
        aria-hidden
        className="fixed hidden items-center overflow-hidden border-solid border-transparent [overflow-wrap:anywhere]"
      >
        <span>
          {field.text.slice(0, start)}
          {end > start ? (
            <mark className="rounded-[2px] bg-muted-foreground/25 text-inherit">
              {field.text.slice(start, end)}
            </mark>
          ) : null}
          <span
            ref={caretRef}
            className="relative inline-block h-[1.2em] w-0 align-text-bottom"
          >
            <span className="absolute top-0 -left-px h-full w-0.5 rounded-full bg-muted-foreground" />
          </span>
          {field.text.slice(end)}
        </span>
      </div>
      <span
        ref={flagRef}
        aria-hidden
        className="fixed top-0 left-0 hidden will-change-transform"
      >
        <span
          className={cn(
            "absolute bottom-0 -left-px rounded-full bg-muted-foreground/92 px-1.5 py-0.5 whitespace-nowrap text-background shadow-[0_1px_3px_rgb(0_0_0/0.15)]",
            typeStyle("caption.medium"),
          )}
        >
          {name}
        </span>
      </span>
    </>
  );
}
