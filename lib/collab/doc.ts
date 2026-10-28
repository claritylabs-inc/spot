"use client";

import { useSyncExternalStore } from "react";
import * as Y from "yjs";

/**
 * The shared Yjs document of the page this operator shares with teammates.
 * Every shared field lives in one `fields` map: text as `Y.Text`, rich text as
 * `Y.XmlFragment`, toggles as booleans and other values as JSON strings. Keys start with the pathname.
 */

/** Transaction origin for edits made in this browser. */
export const LOCAL = Symbol("collab-local");
/** Transaction origin for updates received from the room. */
export const REMOTE = Symbol("collab-remote");

export type SharedValue = Y.Text | Y.XmlFragment | boolean | string;

export function sharedFields(doc: Y.Doc) {
  return doc.getMap<SharedValue>("fields");
}

/** Where the value a shared text started from is kept, for merging edits into it. */
export function startKey(key: string) {
  return `${key}#start`;
}

/**
 * Starts a field. Setting a fresh `Y.Text` on the map, rather than inserting
 * into one, means two operators starting it at once keep one value instead of
 * both concatenated; its starting value is kept beside it.
 */
export function startText(doc: Y.Doc, key: string, value: string) {
  doc.transact(() => {
    sharedFields(doc).set(key, new Y.Text(value));
    sharedFields(doc).set(startKey(key), value);
  }, LOCAL);
}

/**
 * Joins this browser's text to shared text. `base` is this browser's value
 * before its unsaved edits (`local`). When `synced`, `base` is the last value
 * this browser shared with the room (a rejoin), a common ancestor, so the
 * edits always merge. Otherwise (edits made before ever joining) they merge
 * when the shared text started from the same value or still holds it, and the
 * shared text wins if not. Text started empty (still loading elsewhere) takes
 * `local` whole.
 */
export function joinText(
  doc: Y.Doc,
  key: string,
  text: Y.Text,
  base: string,
  local: string,
  synced = false,
) {
  const shared = text.toString();
  const start = sharedFields(doc).get(startKey(key));
  if (synced) mergeEdits(text, base, local);
  else if (shared === "" && (start === "" || start === undefined)) {
    mergeEdits(text, "", local);
  } else if (base === start) mergeEdits(text, base, local);
  else if (base === shared) mergeEdits(text, shared, local);
}

/**
 * The smallest single replacement turning `current` into `next`, so editors
 * can apply a teammate's text without moving the caret.
 */
export function textSplice(current: string, next: string) {
  let start = 0;
  while (
    start < current.length &&
    start < next.length &&
    current[start] === next[start]
  ) {
    start++;
  }
  let endCurrent = current.length;
  let endNext = next.length;
  while (
    endCurrent > start &&
    endNext > start &&
    current[endCurrent - 1] === next[endNext - 1]
  ) {
    endCurrent--;
    endNext--;
  }
  return { from: start, to: endCurrent, insert: next.slice(start, endNext) };
}

/** Applies a local edit to shared text as the smallest splice. */
export function spliceText(text: Y.Text, next: string) {
  const current = text.toString();
  if (current === next) return;
  const { from, to, insert } = textSplice(current, next);
  text.doc!.transact(() => {
    if (to > from) text.delete(from, to - from);
    if (insert) text.insert(from, insert);
  }, LOCAL);
}

/**
 * Adds this browser's unsaved edit (from `base`, the value when the page
 * loaded, to `local`) to shared text that teammates may have edited from the
 * same base, so both survive instead of one replacing the other. An edit that
 * overlaps theirs goes right after it.
 */
export function mergeEdits(text: Y.Text, base: string, local: string) {
  spliceText(text, mergeText(base, local, text.toString()));
}

/** `mergeEdits` on plain strings: `shared` with this browser's edit from `base` to `local` added. */
export function mergeText(base: string, local: string, shared: string) {
  if (shared === local) return shared;
  const mine = textSplice(base, local);
  if (mine.from === mine.to && !mine.insert) return shared;
  const theirs = textSplice(base, shared);
  const shift = theirs.insert.length - (theirs.to - theirs.from);
  let { from, to } = mine;
  if (from >= theirs.to && (from > theirs.from || theirs.to > theirs.from)) {
    from += shift;
    to += shift;
  } else if (to > theirs.from && from < theirs.to) {
    from = to = theirs.from + theirs.insert.length;
  }
  from = Math.min(from, shared.length);
  to = Math.min(Math.max(to, from), shared.length);
  return shared.slice(0, from) + mine.insert + shared.slice(to);
}

/** Where an offset lands after a remote change; text typed at the caret goes after it. */
export function shiftOffset(offset: number, delta: Y.YTextEvent["delta"]) {
  let index = 0;
  let shifted = offset;
  for (const op of delta) {
    if (op.retain) index += op.retain;
    else if (op.insert !== undefined) {
      const length = typeof op.insert === "string" ? op.insert.length : 1;
      if (index < offset) shifted += length;
    } else if (op.delete) {
      if (index < offset) shifted -= Math.min(op.delete, offset - index);
      index += op.delete;
    }
  }
  return shifted;
}

/**
 * A teammate's edit is written into this browser's controls through the same
 * paths as typing. Autosave asks `changedByTeammate()` so only the browser
 * that made an edit saves it; the window covers the render that follows.
 */
const TEAMMATE_CHANGE_WINDOW_MS = 150;
let teammateAppliedAt = -Infinity;
let localEditAt = -Infinity;

/** Called just before a teammate's value is written into a control. */
export function noteTeammateChange() {
  teammateAppliedAt = performance.now();
}

/** Whether the latest change to this page's controls came from a teammate. */
export function changedByTeammate() {
  const now = performance.now();
  return (
    current !== null &&
    teammateAppliedAt > localEditAt &&
    now - teammateAppliedAt < TEAMMATE_CHANGE_WINDOW_MS
  );
}

const noteLocalEdit = (_update: Uint8Array, origin: unknown) => {
  if (origin !== REMOTE) localEditAt = performance.now();
};

let current: Y.Doc | null = null;
let leading = () => true;
const listeners = new Set<() => void>();

/**
 * Whether this browser starts shared documents on the page right away (one
 * operator, by id, does), so two never start the same one at once.
 */
export function leadsSharedRoom() {
  return leading();
}

/** Set by the page's room once its first sync has landed; null when alone. */
export function setSharedDoc(
  doc: Y.Doc | null,
  leads: () => boolean = () => true,
) {
  leading = leads;
  current?.off("update", noteLocalEdit);
  current = doc;
  current?.on("update", noteLocalEdit);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useSharedDoc() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
