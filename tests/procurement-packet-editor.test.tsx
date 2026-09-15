// @vitest-environment happy-dom

import { act, useRef, useState, type ReactNode } from "react";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PacketWorkspace,
  type PacketEditorHandle,
} from "../components/procurement/packet-workspace";
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
    footer,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    footer?: ReactNode;
  }) => (
    <>
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {footer}
    </>
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
          <PacketWorkspace filename="private.md" requestId={requestId} />
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
          <PacketWorkspace filename="private.md" requestId={requestId} />
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
          <PacketWorkspace filename="private.md" requestId={requestId} />
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

test("failed inline drafts block file changes until discard, then save the selected file", async () => {
  const requestId = "request" as Id<"procurementRequests">;
  mocks.query.mockReturnValue({
    documents: [
      { filename: "private.md", markdown: "Original notes", revision: 1 },
      { filename: "public.md", markdown: "Shared requirements", revision: 4 },
    ],
  });
  mocks.save.mockRejectedValue(new Error("Revision conflict"));
  function Workspace() {
    const [filename, setFilename] = useState<"private.md" | "public.md">(
      "private.md",
    );
    const editor = useRef<PacketEditorHandle>(null);
    return (
      <>
        <button
          onClick={async () => {
            if (await editor.current?.save()) setFilename("public.md");
          }}
        >
          Shared
        </button>
        <PacketWorkspace
          ref={editor}
          requestId={requestId}
          filename={filename}
        />
      </>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "inline-packet" },
    persistence: "memory",
  });
  const click = async (text: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === text,
    )!;
    await act(async () => button.click());
  };
  const edit = async (value: string) => {
    const input = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  try {
    await act(async () =>
      root.render(
        <SyncProvider store={store}>
          <Workspace />
        </SyncProvider>,
      ),
    );
    await edit("Unsaved private draft");
    await click("Shared");
    expect(container.querySelector("textarea")?.value).toBe(
      "Unsaved private draft",
    );
    expect(
      container.querySelector('textarea[aria-label="public.md"]'),
    ).toBeNull();
    await click("Discard edits");
    await click("Shared");
    expect(container.querySelector("textarea")?.value).toBe(
      "Shared requirements",
    );
    mocks.save.mockResolvedValue({ revision: 5 });
    await edit("New shared requirements");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.save).toHaveBeenLastCalledWith({
      requestId,
      filename: "public.md",
      markdown: "New shared requirements",
      expectedRevision: 4,
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
