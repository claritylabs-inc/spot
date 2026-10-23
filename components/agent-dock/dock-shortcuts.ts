import type { AgentDockMode } from "./dock-state";

export type AgentDockShortcut =
  | "toggle"
  | "toggleFull"
  | "stepDown"
  | "newChat"
  | "showHistory"
  | "closeChat"
  | "tab1"
  | "tab2"
  | "tab3";

type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "defaultPrevented"
>;

const MODAL_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';

/** Esc belongs to the dialog or menu that has focus. */
export function isInsideModal(target: EventTarget | null) {
  return target instanceof Element && target.closest(MODAL_SELECTOR) !== null;
}

/** Option/Alt chords, matched on the physical key so ⌥ on macOS still works. */
const OPTION_SHORTCUTS: Record<string, AgentDockShortcut> = {
  KeyJ: "toggle",
  KeyN: "newChat",
  KeyH: "showHistory",
  KeyE: "toggleFull",
  KeyW: "closeChat",
  Digit1: "tab1",
  Digit2: "tab2",
  Digit3: "tab3",
};

/**
 * ⌥J toggles the dock, Esc steps down, ⌥N new chat, ⌥H all chats, ⌥E expand, ⌥W close chat, ⌥1–3 switch to that chat tab.
 */
export function agentDockShortcut(
  event: ShortcutEvent,
  { mode, inModal }: { mode: AgentDockMode; inModal: boolean },
): AgentDockShortcut | null {
  if (event.defaultPrevented) return null;
  if (event.altKey) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || inModal) return null;
    return OPTION_SHORTCUTS[event.code] ?? null;
  }
  if (
    event.key === "Escape" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    mode !== "collapsed" &&
    !inModal
  ) {
    return "stepDown";
  }
  return null;
}
