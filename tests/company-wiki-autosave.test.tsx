// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CompanyWikiSection } from "@/components/settings/company-wiki-section";

const { save, wiki } = vi.hoisted(() => ({
  save: vi.fn(),
  wiki: {
    filename: "company-wiki.md",
    markdown: "Original facts",
    body: "Original facts",
    revision: 1,
    proposals: [],
  },
}));
vi.mock("convex/react", () => ({
  useQuery: () => wiki,
  useMutation: () => save,
}));
vi.mock("@/hooks/use-current-org", () => ({
  useCurrentOrg: () => ({ orgId: "org", role: "admin" }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/ui/markdown-editor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    label,
    toolbarActions,
    footer,
    readOnly,
  }: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    toolbarActions: ReactNode;
    footer: ReactNode;
    readOnly: boolean;
  }) => (
    <div>
      {toolbarActions}
      <textarea
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
      {footer}
    </div>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
  Object.assign(wiki, {
    markdown: "Original facts",
    body: "Original facts",
    revision: 1,
  });
});
afterEach(() => vi.useRealTimers());

function setup(readOnly = false) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "wiki-test" },
    persistence: "memory",
  });
  return {
    container,
    render: () =>
      act(async () =>
        root.render(
          <SyncProvider store={store}>
            <CompanyWikiSection readOnly={readOnly} />
          </SyncProvider>,
        ),
      ),
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
    edit: (value: string) =>
      act(async () => {
        const input = container.querySelector("textarea")!;
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    click: (label: string) =>
      act(async () => {
        const button = Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === label,
        );
        expect(button).toBeDefined();
        button!.click();
      }),
  };
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });

test("retains a failed inline draft across live updates and retries until explicit discard", async () => {
  save.mockRejectedValue(new Error("The wiki changed while you were editing"));
  const ui = setup();
  try {
    await ui.render();
    await ui.edit("Changed facts");
    await flush();
    expect(save).toHaveBeenLastCalledWith({
      orgId: "org",
      markdown: "Changed facts",
      expectedRevision: 1,
    });
    Object.assign(wiki, {
      markdown: "Facts from live extraction",
      body: "Facts from live extraction",
      revision: 2,
    });
    await ui.render();
    expect(ui.container.querySelector("textarea")?.value).toBe("Changed facts");
    await ui.click("Retry");
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({
      orgId: "org",
      markdown: "Changed facts",
      expectedRevision: 1,
    });
    await ui.click("Discard edits");
    await flush();
    expect(ui.container.querySelector("textarea")?.value).toBe(
      "Facts from live extraction",
    );
    expect(save).toHaveBeenCalledTimes(2);
    save.mockResolvedValue({ revision: 3 });
    await ui.edit("Updated from latest facts");
    await flush();
    expect(save).toHaveBeenLastCalledWith({
      orgId: "org",
      markdown: "Updated from latest facts",
      expectedRevision: 2,
    });
  } finally {
    await ui.cleanup();
  }
});

test("imports and downloads the current inline Markdown draft", async () => {
  save.mockResolvedValue({ revision: 2 });
  const ui = setup();
  try {
    await ui.render();
    const fileInput = ui.container.querySelector<HTMLInputElement>(
      'input[aria-label="Import company-wiki.md"]',
    )!;
    const markdown = "---\nindustry: Software\n---\n# Imported facts";
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [
        new File([markdown], "company-wiki.md", { type: "text/markdown" }),
      ],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(ui.container.querySelector("textarea")?.value).toBe(markdown);
    expect(
      ui.container
        .querySelector<HTMLAnchorElement>('a[download="company-wiki.md"]')
        ?.getAttribute("href"),
    ).toBe(`data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`);
    await flush();
    expect(save).toHaveBeenLastCalledWith({
      orgId: "org",
      markdown,
      expectedRevision: 1,
    });
  } finally {
    await ui.cleanup();
  }
});

test("an older subscription cannot replace acknowledged edits or reset the next save revision", async () => {
  save
    .mockResolvedValueOnce({ revision: 2 })
    .mockResolvedValue({ revision: 3 });
  const ui = setup();
  try {
    await ui.render();
    await ui.edit("Acknowledged facts");
    await flush();
    expect(save).toHaveBeenCalledExactlyOnceWith({
      orgId: "org",
      markdown: "Acknowledged facts",
      expectedRevision: 1,
    });

    // The mutation has acknowledged revision 2 while the query still has revision 1.
    await ui.edit("Unfinished change");
    await ui.edit("Acknowledged facts");
    await flush();
    expect(ui.container.querySelector("textarea")?.value).toBe(
      "Acknowledged facts",
    );
    expect(save).toHaveBeenCalledTimes(1);

    await ui.edit("Next facts");
    await flush();
    expect(save).toHaveBeenLastCalledWith({
      orgId: "org",
      markdown: "Next facts",
      expectedRevision: 2,
    });
  } finally {
    await ui.cleanup();
  }
});

test.each([false, true])(
  "live wiki updates remain reads with readOnly=%s",
  async (readOnly) => {
    const ui = setup(readOnly);
    try {
      await ui.render();
      Object.assign(wiki, {
        markdown: "New verified facts",
        body: "New verified facts",
        revision: 2,
      });
      await ui.render();
      await flush();
      expect(ui.container.querySelector("textarea")?.value).toBe(
        "New verified facts",
      );
      expect(ui.container.querySelector("textarea")?.readOnly).toBe(readOnly);
      expect(Boolean(ui.container.querySelector('input[type="file"]'))).toBe(
        !readOnly,
      );
      expect(save).not.toHaveBeenCalled();
    } finally {
      await ui.cleanup();
    }
  },
);
