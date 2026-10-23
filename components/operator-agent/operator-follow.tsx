"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

type FollowedCursor = NonNullable<
  FunctionReturnType<typeof api.operatorCursors.get>
>;

/** Seconds for the drawn pointer to close most of the gap to its target; glides between 20Hz updates. */
const POINTER_EASE_S = 0.07;

const POINTER_PATH = "M4.5 4 16 9.2 10.9 10.9 9.2 16Z";

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
    if (href !== `${window.location.pathname}${window.location.search}`) {
      router.push(href);
    }
  }, [href, router]);

  useEffect(() => {
    cursorRef.current = cursor ?? null;
    pendingScrollRef.current = true;
  }, [cursor]);

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
      const samePage =
        current &&
        current.href === `${window.location.pathname}${window.location.search}`;
      if (!current || !samePage || !current.visible) {
        node.style.opacity = "0";
        drawn = null;
        return;
      }
      let point = cursorPoint(current);
      if (pendingScrollRef.current && point.element) {
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
      if (event.key === "Escape" || !isControl(event)) stopFollowing();
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
