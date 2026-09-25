import type { AgentDockMode } from "./dock-state";

export type AgentDockShortcut = "toggle" | "toggleFull" | "stepDown";

type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "defaultPrevented"
>;

const MODAL_SELECTOR =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';

/** Esc belongs to the dialog or menu that has focus. */
export function isInsideModal(target: EventTarget | null) {
  return target instanceof Element && target.closest(MODAL_SELECTOR) !== null;
}

/** ⌘J / Ctrl+J toggles the dock, ⌘⇧J toggles full screen, Esc steps down. */
export function agentDockShortcut(
  event: ShortcutEvent,
  { mode, inModal }: { mode: AgentDockMode; inModal: boolean },
): AgentDockShortcut | null {
  if (event.defaultPrevented || event.altKey) return null;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
    return event.shiftKey ? "toggleFull" : "toggle";
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
