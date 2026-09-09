// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { FileDropZone } from "@/components/ui/file-drop";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test("a disabled dropzone cannot replace an upload in progress", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onFile = vi.fn();
  const file = new File(["replacement"], "replacement.pdf", {
    type: "application/pdf",
  });
  const drop = () => {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    container.querySelector("button")!.dispatchEvent(event);
  };
  try {
    await act(async () =>
      root.render(<FileDropZone disabled idleLabel="Upload" onFile={onFile} />),
    );
    await act(async () => drop());
    expect(onFile).not.toHaveBeenCalled();
    await act(async () =>
      root.render(<FileDropZone idleLabel="Upload" onFile={onFile} />),
    );
    await act(async () => drop());
    expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
