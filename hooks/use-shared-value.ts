"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import * as Y from "yjs";
import {
  leadsSharedRoom,
  LOCAL,
  type SharedValue,
  noteTeammateChange,
  sharedFields,
  useSharedDoc,
} from "@/lib/collab/doc";

/**
 * Shares a controlled value with teammates on the same page, for controls the
 * page's field binding cannot see (selects, comboboxes, state such as an
 * expanded Cc row). Keep your own `useState`; this joins the room's value when
 * it already has one, publishes your changes and calls `onChange` with
 * theirs. A value changed while alone wins over an untouched one when a
 * teammate arrives. Keys follow the `useFollowedState` rules and include the
 * draft or record id. Values must be JSON-serializable; rich text editors use
 * `useSharedFragment`.
 */
export function useSharedValue<T>(
  key: string,
  value: T,
  onChange: (value: T) => void,
) {
  const doc = useSharedDoc();
  const pathname = usePathname();
  const fieldKey = `${pathname}|value:${key}`;
  const json = JSON.stringify(value);
  // What this browser last sent or received for the key in the current room.
  const known = useRef<{ doc: Y.Doc; key: string; value: string } | null>(null);
  // The last value of this browser's own control, so joining never echoes it.
  const seen = useRef(json);
  // The value last shared with a room (or the first one), to tell a change
  // made while alone from an untouched value.
  const base = useRef(json);
  const change = useEffectEvent((remote: string) =>
    onChange(JSON.parse(remote) as T),
  );
  const current = useEffectEvent(() => json);

  useEffect(() => {
    if (!doc) return;
    const fields = sharedFields(doc);
    const remote = () => {
      const shared = fields.get(fieldKey);
      return typeof shared === "string" ? shared : null;
    };
    const adopt = () => {
      const next = remote();
      if (next === null || next === known.current?.value) return;
      known.current = { doc, key: fieldKey, value: next };
      base.current = next;
      if (next !== current()) {
        noteTeammateChange();
        change(next);
      }
    };
    const local = current();
    if (remote() !== null && local === base.current) adopt();
    else {
      known.current = { doc, key: fieldKey, value: local };
      base.current = local;
      doc.transact(() => fields.set(fieldKey, local), LOCAL);
    }
    const observer = (
      event: Y.YMapEvent<SharedValue>,
      transaction: Y.Transaction,
    ) => {
      if (transaction.origin !== LOCAL && event.keysChanged.has(fieldKey)) {
        adopt();
      }
    };
    fields.observe(observer);
    return () => fields.unobserve(observer);
  }, [doc, fieldKey]);

  useEffect(() => {
    if (json === seen.current) return;
    seen.current = json;
    const joined = known.current;
    if (!doc || joined?.doc !== doc || joined.key !== fieldKey) return;
    if (json === joined.value) return;
    joined.value = json;
    base.current = json;
    doc.transact(() => sharedFields(doc).set(fieldKey, json), LOCAL);
  }, [doc, fieldKey, json]);
}

/** How long a page waits for the leading operator to start a shared document. */
const FOLLOWER_START_DELAY_MS = 1_500;

// Fragments this browser created and has not filled yet.
const unseeded = new WeakSet<Y.XmlFragment>();

/**
 * The page's shared rich-text document for `key`, for a ProseMirror (Tiptap)
 * editor to bind with the Collaboration extension; null when alone. The first
 * browser creates it as a whole new fragment, so two starting at once keep one
 * instead of both contents, and fills it once (`takeSeed`). A null key opts
 * out.
 */
export function useSharedFragment(key: string | null) {
  const shared = useSharedDoc();
  const doc = key === null ? null : shared;
  const pathname = usePathname();
  const fieldKey = `${pathname}|fragment:${key}`;
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!doc) return () => {};
      const fields = sharedFields(doc);
      const observer = (event: Y.YMapEvent<SharedValue>) => {
        if (event.keysChanged.has(fieldKey)) onStoreChange();
      };
      fields.observe(observer);
      return () => fields.unobserve(observer);
    },
    [doc, fieldKey],
  );
  const fragment = useSyncExternalStore(
    subscribe,
    () => {
      const shared = doc ? sharedFields(doc).get(fieldKey) : null;
      return shared instanceof Y.XmlFragment ? shared : null;
    },
    () => null,
  );
  useEffect(() => {
    if (!doc) return;
    const fields = sharedFields(doc);
    const create = () => {
      if (fields.get(fieldKey) instanceof Y.XmlFragment) return;
      doc.transact(() => {
        const created = new Y.XmlFragment();
        fields.set(fieldKey, created);
        unseeded.add(created);
      }, LOCAL);
    };
    // One operator starts it at once; the others wait for theirs to arrive
    // and start it only if it does not (they may not have it open).
    if (leadsSharedRoom()) {
      create();
      return;
    }
    const timer = window.setTimeout(create, FOLLOWER_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [doc, fieldKey]);
  return fragment;
}

/** True once, for the browser that created `fragment`: it fills it with its content. */
export function takeSeed(fragment: Y.XmlFragment) {
  return unseeded.delete(fragment);
}
