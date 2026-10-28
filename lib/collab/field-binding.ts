"use client";

import * as Y from "yjs";
import {
  joinText,
  LOCAL,
  noteTeammateChange,
  sharedFields,
  shiftOffset,
  spliceText,
  startText,
  type SharedValue,
} from "@/lib/collab/doc";

/**
 * Binds every text field and toggle on the page to the shared document, so
 * operators on the same page edit the same values. Works on the DOM, so no
 * form needs wiring: local values are polled (catching programmatic changes
 * too) and remote values are written through the native setter plus an
 * `input` event, which React treats as the user typing. Controls without a
 * native value (selects, comboboxes) use `useSharedValue`, and rich editors
 * `useSharedFragment`.
 *
 * A field is keyed by its scope (the nearest `data-collab-scope`, dialog or
 * `main`), its label and its order among fields with the same label there, so
 * the same field matches in every browser. Give forms for something new a `data-collab-scope` with the
 * draft's id so two separate drafts never share fields. Rows can sit in a
 * different order for each operator, so a field in a table row is keyed by
 * the row's record: a `data-collab-scope` on or inside the row, else the
 * row's first link; rows with neither stay local. Row selection checkboxes
 * are `data-collab-ignore` (selection already follows through
 * `useRowSelection`). Passwords, one-time codes and
 * anything inside `data-follow-private` or `data-collab-ignore` stay local.
 */

const SELECTOR =
  "input, textarea, [role=checkbox], [role=switch], [role=radio]";
const SCOPES = "[data-collab-scope], [role=dialog], [role=alertdialog], main";
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
]);
const SCAN_INTERVAL_MS = 150;
/**
 * A remote toggle waits this long before clicking: a switch that saves on
 * click also arrives through its own query, and clicking again would save twice.
 */
const TOGGLE_SETTLE_MS = 600;

type Kind = "text" | "toggle";
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;
type Bound = {
  key: string;
  kind: Kind;
  last: string | boolean;
  /** The shared text this field joined; a different one means a teammate's start won. */
  text?: Y.Text;
  /** The value this field's unsaved edits were made from when it joined. */
  base?: string;
};
/** `synced`: `base` is the last value shared with a room, not the page-load value. */
type Origin = { base: string | boolean; edited: boolean; synced?: boolean };

function kindOf(element: Element): Kind | null {
  if (element.closest("[data-follow-private], [data-collab-ignore]")) {
    return null;
  }
  if (element instanceof HTMLTextAreaElement) return "text";
  if (element instanceof HTMLInputElement) {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") {
      return null;
    }
    if (/one-time-code|password/.test(element.autocomplete)) return null;
    if (element.type === "checkbox" || element.type === "radio") {
      return "toggle";
    }
    return TEXT_INPUT_TYPES.has(element.type) ? "text" : null;
  }
  return element.hasAttribute("aria-checked") ? "toggle" : null;
}

/** Whether an event target is a field the page shares, so editing it is not a reason to stop following. */
export function isSharedField(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const field = target.closest(SELECTOR);
  return !!field && kindOf(field) !== null;
}

function scopeName(scope: Element) {
  const named = scope.getAttribute("data-collab-scope");
  if (named) return named;
  if (scope.tagName === "MAIN") return "main";
  if (scope === document.body) return "body";
  const labelledBy = scope.getAttribute("aria-labelledby");
  const title = labelledBy
    ? document.getElementById(labelledBy)?.textContent
    : null;
  return `dialog:${scope.getAttribute("aria-label") ?? title ?? ""}`;
}

/**
 * Everything but the ordinal of a field's key: its scope, kind and label. The
 * ordinal among fields with the same signature completes it, so an extra
 * banner or button in one browser never shifts which field is which.
 */
function fieldSignature(element: Element, pathname: string) {
  const scope = element.parentElement?.closest(SCOPES) ?? document.body;
  const row = element.closest("tr, [role=row]");
  let name: string;
  if (row && !row.contains(scope)) {
    // A row is the same record everywhere only when it says which one.
    const record = row.querySelector("a[href]")?.getAttribute("href");
    if (!record) return undefined;
    name = `row:${record}`;
  } else name = scopeName(scope);
  const label =
    element.getAttribute("aria-label") ??
    element.getAttribute("name") ??
    element.getAttribute("role") ??
    "";
  const type = element instanceof HTMLInputElement ? element.type : "";
  return `${pathname}|${name}|${element.tagName}:${type}|${label}`;
}

function read(element: Field, kind: Kind): string | boolean {
  if (kind === "text") return (element as HTMLInputElement).value;
  if (element instanceof HTMLInputElement) return element.checked;
  return element.getAttribute("aria-checked") === "true";
}

function editable(element: Field) {
  return !(
    (element as HTMLInputElement).disabled ||
    (element as HTMLInputElement).readOnly ||
    element.getAttribute("aria-disabled") === "true" ||
    element.hasAttribute("data-disabled")
  );
}

function isRadio(element: Field) {
  return element instanceof HTMLInputElement
    ? element.type === "radio"
    : element.getAttribute("role") === "radio";
}

/** Sets a value the way typing would, so React's onChange sees it. */
function setText(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  delta: Y.YTextEvent["delta"] | null,
) {
  const focused = document.activeElement === element;
  let selection: [number, number] | null = null;
  if (focused) {
    try {
      const start = element.selectionStart ?? text.length;
      const end = element.selectionEnd ?? start;
      selection = delta
        ? [shiftOffset(start, delta), shiftOffset(end, delta)]
        : [Math.min(start, text.length), Math.min(end, text.length)];
    } catch {
      // Number and email inputs have no selection API.
    }
  }
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  if (selection) {
    try {
      element.setSelectionRange(...selection);
    } catch {}
  }
}

// Each field's value from before this operator's unsaved edits, by field
// key, kept even while they are alone on the page and across remounts (a
// draft restored on return), so the edits merge into a teammate's when one
// arrives instead of either replacing the other. Cleared once a field joins.
const origins = new Map<string, Origin>();
const keysByElement = new WeakMap<Element, string>();

/** Every shared-eligible field on the page with its key, in document order. */
function pageFields(pathname: string) {
  const found: { element: Field; kind: Kind; key: string }[] = [];
  const ordinals = new Map<string, number>();
  for (const element of document.querySelectorAll<Field>(SELECTOR)) {
    const kind = kindOf(element);
    const signature = kind && fieldSignature(element, pathname);
    if (!kind || !signature) continue;
    const ordinal = ordinals.get(signature) ?? 0;
    ordinals.set(signature, ordinal + 1);
    found.push({ element, kind, key: `${signature}|${ordinal}` });
  }
  return found;
}

function recordOrigins() {
  for (const { element, kind, key } of pageFields(window.location.pathname)) {
    keysByElement.set(element, key);
    const origin = origins.get(key);
    // Until edited, the value tracks what loads or arrives from teammates.
    if (!origin) origins.set(key, { base: read(element, kind), edited: false });
    else if (!origin.edited) origin.base = read(element, kind);
  }
}

/**
 * Records each field's value before this operator edits it. Runs on every
 * operator page, with or without teammates.
 */
export function trackFieldOrigins() {
  // Before the value changes, so the recorded base is the earlier one.
  const onEdit = (event: Event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const field = event.target.closest(SELECTOR);
    if (!field) return;
    const text = kindOf(field) === "text";
    if (text !== (event.type === "beforeinput")) return;
    if (!keysByElement.has(field)) recordOrigins();
    const origin = origins.get(keysByElement.get(field) ?? "");
    if (origin) origin.edited = true;
  };
  recordOrigins();
  const interval = window.setInterval(recordOrigins, SCAN_INTERVAL_MS * 2);
  for (const type of ["beforeinput", "pointerdown", "keydown"]) {
    window.addEventListener(type, onEdit, { capture: true });
  }
  return () => {
    window.clearInterval(interval);
    for (const type of ["beforeinput", "pointerdown", "keydown"]) {
      window.removeEventListener(type, onEdit, { capture: true });
    }
  };
}

export type FieldBinding = ReturnType<typeof bindSharedFields>;

export function bindSharedFields(doc: Y.Doc, pathname: string) {
  const fields = sharedFields(doc);
  const bound = new WeakMap<Element, Bound>();
  let elements = new Map<string, Field>();

  // Whatever this field last shared with the room is what later edits, made
  // if the room drops for a while, are merged against when it rejoins.
  const synced = (key: string, value: string | boolean) =>
    origins.set(key, { base: value, edited: false, synced: true });

  const write = (key: string, kind: Kind, value: string | boolean) => {
    synced(key, value);
    const shared = fields.get(key);
    if (kind === "text") {
      if (shared instanceof Y.Text) spliceText(shared, value as string);
      else startText(doc, key, value as string);
    } else if (shared !== value) {
      doc.transact(() => fields.set(key, value), LOCAL);
    }
  };

  const apply = (
    element: Field,
    state: Bound,
    shared: SharedValue | undefined,
    delta: Y.YTextEvent["delta"] | null = null,
  ) => {
    if (!editable(element)) return;
    if (state.kind === "text") {
      if (!(shared instanceof Y.Text)) return;
      const text = shared.toString();
      state.last = text;
      synced(state.key, text);
      if ((element as HTMLInputElement).value !== text) {
        noteTeammateChange();
        setText(element as HTMLInputElement, text, delta);
      }
    } else if (typeof shared === "boolean") {
      state.last = shared;
      synced(state.key, shared);
      window.setTimeout(() => {
        // Radios are unchecked by checking another one.
        if (
          element.isConnected &&
          fields.get(state.key) === shared &&
          read(element, "toggle") !== shared &&
          (shared || !isRadio(element))
        ) {
          noteTeammateChange();
          element.click();
        }
      }, TOGGLE_SETTLE_MS);
    }
  };

  // Joins a field to the room: shared text keeps both browsers' unsaved
  // edits, and a toggle this operator changed wins over one left untouched.
  // `base` repeats an earlier join whose text lost to a teammate's start.
  const join = (element: Field, state: Bound, base?: string) => {
    const origin = origins.get(state.key);
    const shared = fields.get(state.key);
    if (state.kind === "toggle") {
      if (typeof shared !== "boolean" || origin?.edited) {
        if (editable(element)) write(state.key, "toggle", state.last);
      } else apply(element, state, shared);
      return;
    }
    const local = state.last as string;
    const before = base ?? (origin?.edited ? (origin.base as string) : local);
    if (!(shared instanceof Y.Text)) {
      if (!editable(element)) return;
      startText(doc, state.key, before);
    }
    const text = fields.get(state.key) as Y.Text;
    if (editable(element)) {
      joinText(doc, state.key, text, before, local, !base && origin?.synced);
    }
    state.text = text;
    state.base = before;
    apply(element, state, text);
  };

  const scan = () => {
    const next = new Map<string, Field>();
    for (const { element, kind, key } of pageFields(pathname)) {
      next.set(key, element);
      let state = bound.get(element);
      if (!state || state.key !== key) {
        state = { key, kind, last: read(element, kind) };
        bound.set(element, state);
        join(element, state);
        continue;
      }
      if (!editable(element)) continue;
      const value = read(element, kind);
      if (value !== state.last) {
        state.last = value;
        write(key, kind, value);
      }
    }
    elements = next;
  };

  const observer = (
    events: Y.YEvent<Y.AbstractType<unknown>>[],
    transaction: Y.Transaction,
  ) => {
    if (transaction.origin === LOCAL) return;
    for (const event of events) {
      const changes: [string, Y.YTextEvent["delta"] | null][] =
        event.target === fields
          ? [...(event as Y.YMapEvent<SharedValue>).keysChanged].map((key) => [
              key,
              null,
            ])
          : [[String(event.path[0]), (event as Y.YTextEvent).delta]];
      for (const [key, delta] of changes) {
        const element = elements.get(key);
        const state = element && bound.get(element);
        if (!element || !state) continue;
        const shared = fields.get(key);
        // Two browsers started this field at once and the other's text won:
        // add this browser's edits to it.
        if (
          state.kind === "text" &&
          shared instanceof Y.Text &&
          shared !== state.text
        ) {
          state.last = (element as HTMLInputElement).value;
          join(element, state, state.base);
        } else apply(element, state, shared, delta);
      }
    }
  };

  // Clicks settle after React re-renders the toggle.
  const scanSoon = () => window.setTimeout(scan, 0);
  // Not inline: this starts from an effect, and writing a field while React
  // commits gets its old value restored.
  const firstScan = window.setTimeout(scan, 0);
  fields.observeDeep(observer);
  const interval = window.setInterval(scan, SCAN_INTERVAL_MS);
  window.addEventListener("input", scan, { capture: true });
  window.addEventListener("change", scanSoon, { capture: true });
  window.addEventListener("click", scanSoon, { capture: true });

  return {
    stop() {
      window.clearTimeout(firstScan);
      fields.unobserveDeep(observer);
      window.clearInterval(interval);
      window.removeEventListener("input", scan, { capture: true });
      window.removeEventListener("change", scanSoon, { capture: true });
      window.removeEventListener("click", scanSoon, { capture: true });
    },
    /** The bound element for a key, if it is on this page now. */
    element(key: string) {
      const element = elements.get(key);
      return element?.isConnected ? element : null;
    },
    /** The shared text field this operator's caret is in. */
    focused() {
      const element = document.activeElement;
      const state = element && bound.get(element);
      if (
        !state ||
        state.kind !== "text" ||
        elements.get(state.key) !== element
      ) {
        return null;
      }
      const input = element as HTMLInputElement;
      let selectionStart = input.value.length;
      let selectionEnd = selectionStart;
      try {
        selectionStart = input.selectionStart ?? selectionStart;
        selectionEnd = input.selectionEnd ?? selectionEnd;
      } catch {}
      return { key: state.key, selectionStart, selectionEnd };
    },
  };
}
