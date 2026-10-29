"use client";

/**
 * Undo and redo for every text input and textarea on the page, on Cmd/Ctrl+Z,
 * Cmd/Ctrl+Shift+Z and Ctrl+Y. The browser's own history drops a field's past
 * whenever code sets its value, so filling a box with Spot's suggested reply
 * (or replacing a draft with a new one) could not be undone. Here each field
 * keeps its own steps: typing is recorded from input events, and a value set
 * by code is recorded as its own step the next time the field is edited or
 * undone. A value changed by a teammate (an untrusted input event from the
 * shared-field binding) starts the history over, as the browser does, so undo
 * never reverts someone else's text. Rich editors manage their own history.
 */

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", ""]);
/** Typing of one kind within this long of the last keystroke is one step. */
const GROUP_MS = 1000;
const MAX_STEPS = 200;

type TextField = HTMLInputElement | HTMLTextAreaElement;
type History = {
  steps: string[];
  index: number;
  /** The kind of the edit that made the newest step, and when, for grouping typing. */
  inputType: string | null;
  at: number;
  /** The caret after that edit; typing elsewhere starts a new step. */
  caret: number;
  /** The selection when the current edit began. */
  before: [number, number];
};

const histories = new WeakMap<TextField, History>();
/** Set while this module writes a value, so its own input event is not recorded. */
let restoring = false;

function textField(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (
    target instanceof HTMLInputElement &&
    TEXT_INPUT_TYPES.has(target.getAttribute("type") ?? "")
  ) {
    return target;
  }
  return null;
}

function selectionOf(field: TextField): [number, number] {
  try {
    return [field.selectionStart ?? -1, field.selectionEnd ?? -1];
  } catch {
    return [-1, -1];
  }
}

function caretOf(field: TextField) {
  try {
    return field.selectionEnd ?? field.value.length;
  } catch {
    return field.value.length;
  }
}

function historyOf(field: TextField) {
  let history = histories.get(field);
  if (!history) {
    history = {
      steps: [field.value],
      index: 0,
      inputType: null,
      at: 0,
      caret: -1,
      before: [-1, -1],
    };
    histories.set(field, history);
  }
  return history;
}

function push(history: History, value: string) {
  history.steps.splice(history.index + 1, Infinity, value);
  if (history.steps.length > MAX_STEPS) history.steps.shift();
  history.index = history.steps.length - 1;
}

/** Records a value code set since the last step, so it can be undone too. */
function catchUp(field: TextField, history: History) {
  if (field.value === history.steps[history.index]) return;
  push(history, field.value);
  history.inputType = null;
}

/** Where the caret goes after moving from one value to another: the end of what changed. */
function changedEnd(from: string, to: string) {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) {
    start++;
  }
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  ) {
    end++;
  }
  return to.length - end;
}

/** Sets a value the way typing would, so React's onChange and shared fields see it. */
function restore(field: TextField, from: string, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  restoring = true;
  try {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  } finally {
    restoring = false;
  }
  try {
    const caret = changedEnd(from, value);
    field.setSelectionRange(caret, caret);
  } catch {
    // Email inputs have no selection API.
  }
}

function move(field: TextField, by: -1 | 1) {
  const history = historyOf(field);
  catchUp(field, history);
  const next = history.index + by;
  if (next < 0 || next >= history.steps.length) return;
  const from = field.value;
  history.index = next;
  history.inputType = null;
  restore(field, from, history.steps[next]);
}

function editable(field: TextField) {
  return !field.disabled && !field.readOnly;
}

export function installTextUndo() {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.isComposing) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    const undo = key === "z" && !event.shiftKey;
    const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.metaKey);
    if (!undo && !redo) return;
    const field = textField(event.target);
    if (!field || !editable(field)) return;
    event.preventDefault();
    move(field, undo ? -1 : 1);
  };

  // The Edit menu's Undo and Redo arrive as these.
  const onBeforeInput = (event: InputEvent) => {
    const field = textField(event.target);
    if (!field || !editable(field)) return;
    if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
      event.preventDefault();
      move(field, event.inputType === "historyUndo" ? -1 : 1);
      return;
    }
    const history = historyOf(field);
    catchUp(field, history);
    history.before = selectionOf(field);
  };

  const onInput = (event: Event) => {
    if (restoring) return;
    const field = textField(event.target);
    if (!field) return;
    if (!event.isTrusted) {
      // A teammate's change: start over from it rather than undo their text.
      histories.delete(field);
      return;
    }
    const history = historyOf(field);
    const inputType = (event as InputEvent).inputType ?? "";
    const caret = caretOf(field);
    const now = performance.now();
    const typing = inputType === "insertText" || inputType.startsWith("deleteContent");
    const sameRun =
      typing &&
      history.index === history.steps.length - 1 &&
      inputType === history.inputType &&
      now - history.at < GROUP_MS &&
      history.before[0] === history.caret &&
      history.before[1] === history.caret;
    if (sameRun) history.steps[history.index] = field.value;
    else push(history, field.value);
    history.inputType = typing ? inputType : null;
    history.at = now;
    history.caret = caret;
  };

  // Records each field's starting value before its first edit.
  const onFocus = (event: FocusEvent) => {
    const field = textField(event.target);
    if (field) catchUp(field, historyOf(field));
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("beforeinput", onBeforeInput, { capture: true });
  document.addEventListener("input", onInput, { capture: true });
  document.addEventListener("focusin", onFocus, { capture: true });
  return () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("beforeinput", onBeforeInput, { capture: true });
    document.removeEventListener("input", onInput, { capture: true });
    document.removeEventListener("focusin", onFocus, { capture: true });
  };
}
