// @vitest-environment happy-dom

import { act, useState, type ReactNode } from "react";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PacketEditor } from "../components/procurement/packet-workspace";
import { useGuardedRightPanel } from "../lib/use-guarded-right-panel";
import type { Id } from "../convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  save: vi.fn(),
  error: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: mocks.query,
  useMutation: () => mocks.save,
}));
vi.mock("@/components/ui/markdown-editor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    label,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    children,
    actions,
    onOpenChange,
  }: {
    children: ReactNode;
    actions: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      {children}
      {actions}
      <button onClick={() => onOpenChange(false)}>Close editor</button>
    </div>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

test("preserves unsaved packet edits across live updates and a rejected save", async () => {
  const requestId = "request" as Id<"procurementRequests">;
  const packetDocument = {
    filename: "private.md",
    markdown: "Original",
    revision: 1,
  };
  mocks.query.mockReturnValue({ documents: [packetDocument] });
  mocks.save.mockRejectedValue(
    new Error("The packet changed while you were editing"),
  );
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "procurement-test" },
    persistence: "memory",
  });
  const render = () =>
    act(async () => {
      root.render(
        <SyncProvider store={store}>
          <PacketEditor
            filename="private.md"
            requestId={requestId}
            onClose={onClose}
          />
        </SyncProvider>,
      );
    });
  try {
    await render();
    const input = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="private.md"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "My unsaved draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.query.mockReturnValue({
      documents: [
        { ...packetDocument, markdown: "Another operator's edit", revision: 2 },
      ],
    });
    await render();
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="private.md"]',
      )?.value,
    ).toBe("My unsaved draft");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      requestId,
      filename: "private.md",
      expectedRevision: 1,
      markdown: "My unsaved draft",
    });
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="private.md"]',
      )?.value,
    ).toBe("My unsaved draft");
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
    const discard = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Discard edits",
    );
    expect(discard).toBeDefined();
    await act(async () => discard!.click());
    expect(input.value).toBe("Another operator's edit");
    mocks.save.mockResolvedValue({ revision: 3 });
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "Updated from latest draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(600);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.save).toHaveBeenLastCalledWith({
      requestId,
      filename: "private.md",
      expectedRevision: 2,
      markdown: "Updated from latest draft",
    });
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("successive packet autosaves use the acknowledged revision without closing the editor", async () => {
  const requestId = "request" as Id<"procurementRequests">;
  mocks.query.mockReturnValue({
    documents: [
      {
        filename: "private.md",
        markdown: "Original",
        revision: 4,
      },
    ],
  });
  mocks.save
    .mockResolvedValueOnce({ revision: 5 })
    .mockResolvedValueOnce({ revision: 6 });
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "packet-autosave" },
    persistence: "memory",
  });
  try {
    await act(async () =>
      root.render(
        <SyncProvider store={store}>
          <PacketEditor
            filename="private.md"
            requestId={requestId}
            onClose={onClose}
          />
        </SyncProvider>,
      ),
    );
    for (const value of ["First edit", "Second edit"]) {
      await act(async () => {
        const input = container.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="private.md"]',
        )!;
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
    }
    expect(mocks.save.mock.calls.map(([args]) => args)).toEqual([
      {
        requestId,
        filename: "private.md",
        expectedRevision: 4,
        markdown: "First edit",
      },
      {
        requestId,
        filename: "private.md",
        expectedRevision: 5,
        markdown: "Second edit",
      },
    ]);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="private.md"]',
      )?.value,
    ).toBe("Second edit");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("imports a Markdown file into the selected packet document", async () => {
  const requestId = "request" as Id<"procurementRequests">;
  mocks.query.mockReturnValue({
    documents: [
      {
        filename: "private.md",
        markdown: "---\nvisibility: private\n---\nOriginal",
        revision: 2,
      },
    ],
  });
  mocks.save.mockResolvedValue({ revision: 3 });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "packet-import" },
    persistence: "memory",
  });
  try {
    await act(async () =>
      root.render(
        <SyncProvider store={store}>
          <PacketEditor
            filename="private.md"
            requestId={requestId}
            onClose={vi.fn()}
          />
        </SyncProvider>,
      ),
    );
    const fileInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Import private.md"]',
    )!;
    const markdown = "---\nvisibility: private\n---\n# Imported details";
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File([markdown], "private.md", { type: "text/markdown" })],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="private.md"]',
      )?.value,
    ).toBe(markdown);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.save).toHaveBeenCalledWith({
      requestId,
      filename: "private.md",
      expectedRevision: 2,
      markdown,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("failed packet edits block sidebar replacements until explicitly discarded", async () => {
  const requestId = "request" as Id<"procurementRequests">;
  const privateDocument = {
    filename: "private.md",
    markdown: "Original notes",
    revision: 1,
  };
  const sharedDocument = {
    filename: "public.md",
    markdown: "Shared requirements",
    revision: 4,
  };
  mocks.query.mockReturnValue({ documents: [privateDocument, sharedDocument] });
  mocks.save.mockRejectedValue(
    new Error("The packet changed while you were editing"),
  );
  function Workspace() {
    const [filename, setFilename] = useState<"private.md" | "public.md">(
      "private.md",
    );
    const { rightPanel, setRightPanel } = useGuardedRightPanel();
    return (
      <>
        <button onClick={() => setFilename("private.md")}>Notes</button>
        <button onClick={() => setFilename("public.md")}>Shared</button>
        <button
          onClick={() =>
            setRightPanel(
              <PacketEditor
                key={`${requestId}:${filename}`}
                requestId={requestId}
                filename={filename}
                onClose={() => setRightPanel(null)}
              />,
            )
          }
        >
          Edit file
        </button>
        <button onClick={() => setRightPanel(<p>Request settings</p>)}>
          Edit request
        </button>
        {rightPanel}
      </>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "packet-replacements" },
    persistence: "memory",
  });
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  const privateInput = () =>
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="private.md"]',
    );
  try {
    await act(async () =>
      root.render(
        <SyncProvider store={store}>
          <Workspace />
        </SyncProvider>,
      ),
    );
    await click("Edit file");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(privateInput(), "Unsaved private draft");
      privateInput()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      requestId,
      filename: "private.md",
      expectedRevision: 1,
      markdown: "Unsaved private draft",
    });
    await click("Shared");
    await click("Edit file");
    expect(privateInput()?.value).toBe("Unsaved private draft");
    expect(
      container.querySelector('textarea[aria-label="public.md"]'),
    ).toBeNull();
    await click("Notes");
    await click("Edit file");
    expect(privateInput()?.value).toBe("Unsaved private draft");
    await click("Edit request");
    expect(container.textContent).not.toContain("Request settings");
    expect(privateInput()?.value).toBe("Unsaved private draft");
    await click("Close editor");
    expect(privateInput()?.value).toBe("Unsaved private draft");
    expect(
      mocks.save.mock.calls.every(
        ([args]) =>
          args.filename === "private.md" && args.expectedRevision === 1,
      ),
    ).toBe(true);
    await click("Discard edits");
    expect(privateInput()?.value).toBe("Original notes");
    const attempts = mocks.save.mock.calls.length;
    await click("Shared");
    await click("Edit file");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="public.md"]',
      )?.value,
    ).toBe("Shared requirements");
    expect(privateInput()).toBeNull();
    expect(mocks.save).toHaveBeenCalledTimes(attempts);
    await click("Close editor");
    expect(container.querySelector("textarea")).toBeNull();

    await click("Edit file");
    const pendingSave = Promise.withResolvers<{ revision: number }>();
    mocks.save.mockReturnValue(pendingSave.promise);
    await act(async () => {
      const input = container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="public.md"]',
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "Updated shared requirements");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Notes");
    await click("Edit file");
    await click("Edit request");
    expect(
      container.querySelector('textarea[aria-label="public.md"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Request settings");
    await act(async () => pendingSave.resolve({ revision: 5 }));
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Request settings");
    expect(mocks.save).toHaveBeenLastCalledWith({
      requestId,
      filename: "public.md",
      expectedRevision: 4,
      markdown: "Updated shared requirements",
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
