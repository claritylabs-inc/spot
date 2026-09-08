// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { SettingsDrawer } from "@/components/settings/settings-drawer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test("drawer stays in its sidebar and restores keyboard focus after Escape", async () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open record</button>
        <aside>
          <SettingsDrawer open={open} onOpenChange={setOpen} title="Record">
            <input aria-label="Name" />
          </SettingsDrawer>
        </aside>
      </>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Example />));
    const trigger = container.querySelector("button")!;
    await act(async () => {
      trigger.focus();
      trigger.click();
    });
    const dialog = container.querySelector('aside [role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.contains(document.activeElement)).toBe(true);
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector('[role="dialog"]:not([hidden])')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
