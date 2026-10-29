"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import * as Y from "yjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { browserTabId } from "@/hooks/use-operator-presence";
import { REMOTE, setSharedDoc } from "@/lib/collab/doc";
import { useOperatorColor } from "@/lib/collab/operator-color";
import {
  bindSharedFields,
  type FieldBinding,
} from "@/lib/collab/field-binding";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Rejoining keeps the room alive; a room nobody rejoins is reset for the next visit. */
const JOIN_INTERVAL_MS = 15_000;
/** Local edits are batched into one push this often. */
const PUSH_DELAY_MS = 50;
const RETRY_DELAY_MS = 1_000;
/** After local edits, the whole document is resent this often. */
const FULL_STATE_INTERVAL_MS = 10_000;
const CARET_DELAY_MS = 50;
/**
 * Updates are fetched with this overlap: a slower transaction can commit an
 * update stamped before one already seen. Yjs ignores repeats.
 */
const UPDATE_OVERLAP_MS = 2_000;
/** Seconds for a drawn pointer to close most of the gap to its target; glides between 20Hz updates. */
const POINTER_EASE_S = 0.07;
const POINTER_PATH = "M4.5 4 16 9.2 10.9 10.9 9.2 16Z";

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
] as const;

/**
 * Pages where each operator sees their own records (personal settings):
 * teammates still see each other's pointers but never share fields.
 */
const PERSONAL_PATHNAMES = new Set(["/operator/settings"]);

/** Private pages (profile): teammates neither share fields nor see pointers there. */
const PRIVATE_PATHNAMES = new Set(["/operator/profile"]);

export function isPrivatePage(pathname: string) {
  return PRIVATE_PATHNAMES.has(pathname);
}

/**
 * Whether this operator's pointer is somewhere teammates must not see it: a
 * private page or a `data-follow-private` region (such as a chat not yet sent).
 */
export function pointerIsPrivate(element: Element | null) {
  return (
    isPrivatePage(window.location.pathname) ||
    !!element?.closest("[data-follow-private]")
  );
}

export type PagePeer = { userId: Id<"users">; name: string };
type PeerCursorRow = NonNullable<
  FunctionReturnType<typeof api.operatorCursors.get>
>;
type Caret = FunctionReturnType<typeof api.collab.carets>[number];

function currentHref() {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Multiplayer for a page this operator shares with teammates: everyone's
 * pointer and caret, and every field edited together through one Yjs room.
 */
export function PageMultiplayer({
  pathname,
  peers,
  selfId,
  followingUserId,
}: {
  pathname: string;
  selfId: Id<"users">;
  peers: PagePeer[];
  followingUserId: Id<"users"> | null;
}) {
  const join = useMutation(api.collab.join);
  const [roomId, setRoomId] = useState<Id<"collabRooms"> | null>(null);
  const joinNow = useRef<() => void>(() => {});

  const personal = PERSONAL_PATHNAMES.has(pathname);
  useEffect(() => {
    if (personal) return;
    let active = true;
    const beat = () =>
      join({ pathname })
        .then((id) => {
          if (active) setRoomId(id);
        })
        .catch(() => {});
    void beat();
    joinNow.current = () => void beat();
    const interval = window.setInterval(beat, JOIN_INTERVAL_MS);
    return () => {
      active = false;
      joinNow.current = () => {};
      window.clearInterval(interval);
    };
  }, [join, pathname, personal]);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100]">
      {roomId && !personal ? (
        <SharedRoom
          key={roomId}
          roomId={roomId}
          pathname={pathname}
          peers={peers}
          selfId={selfId}
          followingUserId={followingUserId}
          onRoomGone={() => joinNow.current()}
        />
      ) : null}
      {peers.map((peer) => (
        <PeerPointer
          key={peer.userId}
          userId={peer.userId}
          name={peer.name}
          followed={peer.userId === followingUserId}
        />
      ))}
    </div>,
    document.body,
  );
}

function SharedRoom({
  roomId,
  pathname,
  peers,
  selfId,
  followingUserId,
  onRoomGone,
}: {
  roomId: Id<"collabRooms">;
  selfId: Id<"users">;
  pathname: string;
  peers: PagePeer[];
  followingUserId: Id<"users"> | null;
  /** The room was reset under this browser: join the current one now. */
  onRoomGone: () => void;
}) {
  const [doc] = useState(() => new Y.Doc());
  const [after, setAfter] = useState(0);
  const page = useQuery(api.collab.updates, {
    roomId,
    after: Math.max(0, after - UPDATE_OVERLAP_MS),
  });
  // True once the room's content so far is in `doc`; stays true while later
  // pages load under new arguments.
  const [synced, setSynced] = useState(false);
  const push = useMutation(api.collab.push);
  const publishCaret = useMutation(api.collab.caret);
  const carets = useQuery(api.collab.carets, { roomId });
  const bindingRef = useRef<FieldBinding | null>(null);
  const peersRef = useRef(peers);
  useEffect(() => {
    peersRef.current = peers;
  });

  // One merged update per page, so fields change once instead of once per
  // keystroke. Applied after React's effects: a field written while React is
  // committing gets its old value restored, which jumps the caret. Only then
  // does the cursor move on, so no page is skipped before it lands.
  useEffect(() => {
    if (!page) return;
    window.setTimeout(() => {
      if (page.updates.length) {
        Y.applyUpdate(
          doc,
          Y.mergeUpdates(page.updates.map((update) => new Uint8Array(update))),
          REMOTE,
        );
      }
      setSynced(true);
      setAfter((current) => Math.max(current, page.last));
    }, 0);
  }, [doc, page]);

  // Every update depends on the ones before it, so a lost one stalls this
  // browser's later edits for everyone: failed sends are retried, a reset
  // room is rejoined at once, and after local edits the whole state is resent
  // now and then to fill any gap.
  const rejoin = useEffectEvent(onRoomGone);
  useEffect(() => {
    let pending: Uint8Array[] = [];
    let timer: number | null = null;
    let changedSinceFullState = false;
    const send = (update: Uint8Array) =>
      push({ roomId, update: update.slice().buffer })
        .then((result) => {
          if (!result.ok) rejoin();
        })
        .catch(() => {
          pending.unshift(update);
          schedule(RETRY_DELAY_MS);
        });
    const flush = () => {
      timer = null;
      if (!pending.length) return;
      const update = Y.mergeUpdates(pending);
      pending = [];
      void send(update);
    };
    const schedule = (delay: number) => {
      timer ??= window.setTimeout(flush, delay);
    };
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      pending.push(update);
      changedSinceFullState = true;
      schedule(PUSH_DELAY_MS);
    };
    const fullState = window.setInterval(() => {
      if (!changedSinceFullState) return;
      changedSinceFullState = false;
      void send(Y.encodeStateAsUpdate(doc));
    }, FULL_STATE_INTERVAL_MS);
    doc.on("update", onUpdate);
    return () => {
      doc.off("update", onUpdate);
      window.clearInterval(fullState);
      if (timer !== null) window.clearTimeout(timer);
      flush();
    };
  }, [doc, push, roomId]);

  // Fields bind only after the room's state has landed, so this browser joins
  // existing values instead of starting its own.
  // Fields and editors see the room only once its content is in `doc`.
  useEffect(() => {
    if (!synced) return;
    let binding: FieldBinding | null = null;
    // One operator, by id, starts shared documents; among their tabs on this
    // page, the one holding this lock.
    let holdsLock = !("locks" in navigator);
    let releaseLock = () => {};
    const lockRequest = new AbortController();
    if (!holdsLock) {
      navigator.locks
        .request(
          `collab:lead:${pathname}`,
          { signal: lockRequest.signal },
          () => {
            holdsLock = true;
            return new Promise<void>((resolve) => {
              releaseLock = resolve;
            });
          },
        )
        .catch(() => {});
    }
    const timer = window.setTimeout(() => {
      binding = bindSharedFields(doc, pathname);
      bindingRef.current = binding;
      setSharedDoc(
        doc,
        () =>
          holdsLock && peersRef.current.every((peer) => selfId < peer.userId),
      );
    }, 0);
    return () => {
      lockRequest.abort();
      releaseLock();
      window.clearTimeout(timer);
      if (!binding) return;
      binding.stop();
      bindingRef.current = null;
      setSharedDoc(null);
    };
  }, [doc, pathname, roomId, selfId, synced]);

  useEffect(() => {
    let sent = "null";
    let timer: number | null = null;
    const send = () => {
      timer = null;
      const field = bindingRef.current?.focused() ?? null;
      const json = JSON.stringify(field);
      if (json === sent) return;
      sent = json;
      void browserTabId().then((tabId) =>
        publishCaret({ roomId, tabId, field }).catch(() => {}),
      );
    };
    const schedule = () => {
      timer ??= window.setTimeout(send, CARET_DELAY_MS);
    };
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("input", schedule, { capture: true });
    window.addEventListener("focusin", schedule, { capture: true });
    window.addEventListener("focusout", schedule, { capture: true });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("input", schedule, { capture: true });
      window.removeEventListener("focusin", schedule, { capture: true });
      window.removeEventListener("focusout", schedule, { capture: true });
      void browserTabId().then((tabId) =>
        publishCaret({ roomId, tabId, field: null }).catch(() => {}),
      );
    };
  }, [publishCaret, roomId]);

  const names = new Map(peers.map((peer) => [peer.userId, peer.name]));
  return (
    <>
      {(carets ?? []).map((caret) =>
        names.has(caret.userId) ? (
          <FieldCaret
            key={caret.userId}
            caret={caret}
            name={names.get(caret.userId)!}
            followed={caret.userId === followingUserId}
            bindingRef={bindingRef}
          />
        ) : null,
      )}
    </>
  );
}

/** A teammate's pointer, anchored to the same element in this window when it exists here. */
function PeerPointer({
  userId,
  name,
  followed,
}: {
  userId: Id<"users">;
  name: string;
  followed: boolean;
}) {
  const cursor = useQuery(api.operatorCursors.get, { userId });
  const color = useOperatorColor()(userId);
  const cursorRef = useRef<PeerCursorRow | null>(null);
  const pointerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cursorRef.current = cursor ?? null;
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
      if (!current || current.href !== currentHref() || !current.visible) {
        node.style.opacity = "0";
        drawn = null;
        return;
      }
      const point = pointerPoint(current);
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

  return (
    <div
      ref={pointerRef}
      aria-hidden
      className="absolute top-0 left-0 opacity-0 transition-opacity duration-150 will-change-transform"
    >
      <div className="absolute -top-7 -left-7 size-14 rounded-full bg-[radial-gradient(circle,var(--color-background)_0%,transparent_70%)] opacity-90" />
      <svg
        viewBox="0 0 20 20"
        className="relative -mt-0.5 -ml-0.5 size-5 drop-shadow-[0_1px_2px_rgb(0_0_0/0.18)]"
        style={{ color }}
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
          "absolute top-4 left-3.5 rounded-full px-1.5 py-0.5 whitespace-nowrap text-white shadow-[0_1px_3px_rgb(0_0_0/0.15)]",
          followed && "ring-2 ring-background",
          typeStyle("caption.medium"),
        )}
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  );
}

/** Where a pointer falls in this window, anchored to the same element when it exists here. */
export function pointerPoint(cursor: {
  anchor: string | null;
  x: number;
  y: number;
  viewportX: number;
  viewportY: number;
}) {
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
 * A teammate's caret and selection in a shared field. The field already holds
 * the shared text, so an invisible copy laid over it only places the caret.
 * The followed teammate's caret is kept in view.
 */
function FieldCaret({
  caret,
  name,
  followed,
  bindingRef,
}: {
  caret: Caret;
  name: string;
  followed: boolean;
  bindingRef: React.RefObject<FieldBinding | null>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLSpanElement>(null);
  const selectedRef = useRef<HTMLElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const afterRef = useRef<HTMLSpanElement>(null);
  const flagRef = useRef<HTMLSpanElement>(null);
  const caretState = useRef(caret);
  const pendingReveal = useRef(followed);
  const color = useOperatorColor()(caret.userId);

  useEffect(() => {
    caretState.current = caret;
    pendingReveal.current = followed;
  }, [caret, followed]);

  useEffect(() => {
    let frame = 0;
    let styled: Element | null = null;
    // Scroll containers and panes that clip the field.
    let clippers: Element[] = [];
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const box = boxRef.current;
      const flag = flagRef.current;
      if (!box || !flag) return;
      const current = caretState.current;
      const target = bindingRef.current?.element(current.key) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      const rect = target?.getBoundingClientRect();
      if (!target || !rect || rect.width === 0 || rect.height === 0) {
        box.style.display = "none";
        flag.style.display = "none";
        styled = null;
        return;
      }
      const singleLine = target instanceof HTMLInputElement;
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
        box.style.whiteSpace = singleLine ? "pre" : "pre-wrap";
      }
      box.style.display = singleLine ? "flex" : "block";
      const text = target.value;
      const start = Math.min(
        current.selectionStart,
        current.selectionEnd,
        text.length,
      );
      const end = Math.min(
        Math.max(current.selectionStart, current.selectionEnd),
        text.length,
      );
      const parts = [
        text.slice(0, start),
        text.slice(start, end),
        text.slice(end),
      ];
      [beforeRef, selectedRef, afterRef].forEach((ref, index) => {
        if (ref.current!.textContent !== parts[index]) {
          ref.current!.textContent = parts[index];
        }
      });
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      box.scrollTop = target.scrollTop;
      box.scrollLeft = target.scrollLeft;
      const bounds = {
        top: Math.max(0, rect.top),
        left: Math.max(0, rect.left),
        bottom: Math.min(window.innerHeight, rect.bottom),
        right: Math.min(window.innerWidth, rect.right),
      };
      for (const clipper of clippers) {
        const clip = clipper.getBoundingClientRect();
        bounds.top = Math.max(bounds.top, clip.top);
        bounds.left = Math.max(bounds.left, clip.left);
        bounds.bottom = Math.min(bounds.bottom, clip.bottom);
        bounds.right = Math.min(bounds.right, clip.right);
      }
      box.style.clipPath = `inset(${Math.max(0, bounds.top - rect.top)}px ${Math.max(0, rect.right - bounds.right)}px ${Math.max(0, rect.bottom - bounds.bottom)}px ${Math.max(0, bounds.left - rect.left)}px)`;
      const caretRect = caretRef.current!.getBoundingClientRect();
      if (pendingReveal.current) {
        pendingReveal.current = false;
        if (caretRect.bottom > bounds.bottom || caretRect.top < bounds.top) {
          caretRef.current!.scrollIntoView({ block: "nearest" });
        }
      }
      const shown =
        caretRect.bottom > bounds.top &&
        caretRect.top < bounds.bottom &&
        caretRect.left >= bounds.left - 1 &&
        caretRect.left <= bounds.right + 1;
      flag.style.display = shown ? "block" : "none";
      caretRef.current!.style.visibility = shown ? "visible" : "hidden";
      if (shown) {
        flag.style.transform = `translate3d(${caretRect.left}px, ${caretRect.top}px, 0)`;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [bindingRef]);

  return (
    <>
      <div
        ref={boxRef}
        aria-hidden
        className="fixed hidden items-center overflow-hidden border-solid border-transparent text-transparent [overflow-wrap:anywhere]"
      >
        <span>
          <span ref={beforeRef} />
          <mark
            ref={selectedRef}
            className="rounded-[2px] text-transparent"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)`,
            }}
          />
          <span
            ref={caretRef}
            className="relative inline-block h-[1.2em] w-0 align-text-bottom"
          >
            <span
              className="absolute top-0 -left-px h-full w-0.5 rounded-full"
              style={{ backgroundColor: color }}
            />
          </span>
          <span ref={afterRef} />
        </span>
      </div>
      <span
        ref={flagRef}
        aria-hidden
        className="fixed top-0 left-0 hidden will-change-transform"
      >
        <span
          className={cn(
            "absolute bottom-0 -left-px rounded-full px-1.5 py-0.5 whitespace-nowrap text-white shadow-[0_1px_3px_rgb(0_0_0/0.15)]",
            typeStyle("caption.medium"),
          )}
          style={{ backgroundColor: color }}
        >
          {name}
        </span>
      </span>
    </>
  );
}
