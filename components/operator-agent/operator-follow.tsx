"use client";

import { useEffect, useEffectEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import {
  isPrivatePage,
  pointerPoint,
} from "@/components/operator-agent/page-multiplayer";
import { isSharedField } from "@/lib/collab/field-binding";
import { useOperatorColor } from "@/lib/collab/operator-color";
import { setMirroredUi } from "@/hooks/use-followed-state";
import type { Id } from "@/convex/_generated/dataModel";

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

/**
 * Follows another operator: navigates with them, shows their panels and
 * scrolls so their pointer sits where it does on their screen; the page's
 * multiplayer layer draws their pointer and caret, and the top bar shows who
 * is followed with a way to stop. Editing a shared field
 * keeps following; any other scroll, click or key outside follow controls
 * hands control back.
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
  const color = useOperatorColor()(userId);
  const cursor = useQuery(api.operatorCursors.get, { userId });
  const stopFollowing = useEffectEvent(onStop);

  const href = cursor?.href ?? pathname;
  // A private page ends the session rather than following them there.
  const leaderPrivate = isPrivatePage(href.split(/[?#]/)[0]);
  useEffect(() => {
    if (leaderPrivate) {
      toast(`${name} went to a private page`, {
        description: "Following stopped.",
      });
      stopFollowing();
    } else if (href !== currentHref()) {
      router.push(href);
    }
  }, [href, leaderPrivate, name, router]);

  // Show the leader's panels, tabs and filters; keep them when following stops.
  const ui = useQuery(api.operatorCursors.ui, { userId });
  // No row means every value is at its default.
  useEffect(() => setMirroredUi(ui === undefined ? null : (ui ?? "{}")), [ui]);
  useEffect(() => () => setMirroredUi(null), []);

  // Scroll once per pointer update, on the first frame its element exists.
  useEffect(() => {
    if (!cursor) return;
    let frame = 0;
    const tick = () => {
      if (cursor.href !== currentHref()) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const point = pointerPoint(cursor);
      if (!point.element) return;
      const delta = point.top - cursor.viewportY * window.innerHeight;
      const scroller = scrollParent(point.element);
      if (scroller && Math.abs(delta) > 8) scroller.scrollTop += delta;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cursor]);

  useEffect(() => {
    const keepsFollowing = (event: Event) =>
      isSharedField(event.target) ||
      (event.target instanceof Element &&
        !!event.target.closest(`[${FOLLOW_CONTROL_ATTRIBUTE}]`));
    const stop = (event: Event) => {
      if (!keepsFollowing(event)) stopFollowing();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return;
      if (event.key === "Escape") {
        // This Escape only stops following; the adopted panels stay open.
        event.preventDefault();
        event.stopImmediatePropagation();
        stopFollowing();
      } else if (!keepsFollowing(event)) stopFollowing();
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
      {/* The followed operator's color edges the window. */}
      <div
        className="absolute inset-0"
        style={{
          boxShadow: `inset 0 0 0 1.5px ${color}, inset 0 0 24px -6px ${color}`,
        }}
      />
    </div>,
    document.body,
  );
}
