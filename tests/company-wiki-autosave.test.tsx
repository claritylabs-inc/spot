// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { expect, test, vi } from "vitest";
import { CompanyWikiSection } from "@/components/settings/company-wiki-section";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";

const { save, wiki } = vi.hoisted(() => ({
  save: vi.fn(),
  wiki: {
    sections: [
      {
        key: "operations",
        heading: "Operations",
        body: "Original facts",
        source: "operator",
        updatedAt: 1,
      },
    ],
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
vi.mock("@/components/prose-markdown", () => ({
  ProseMarkdown: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <aside>
      <button onClick={() => onOpenChange(false)}>Close</button>
      {children}
    </aside>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const setActions = () => {};

function Workspace() {
  const [panel, setRightPanel] = useState<ReactNode>(null);
  return (
    <SettingsActionsContext.Provider value={{ setActions, setRightPanel }}>
      <CompanyWikiSection />
      {panel}
    </SettingsActionsContext.Provider>
  );
}

test("wiki close flushes the latest draft, retains it after a failed save and live update, and retries", async () => {
  save.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "wiki-test" },
    persistence: "memory",
  });
  const render = () =>
    root.render(
      <SyncProvider store={store}>
        <Workspace />
      </SyncProvider>,
    );
  try {
    await act(async () => render());
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit Operations"]')!
        .click(),
    );
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "Changed facts");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>("aside button")!.click(),
    );
    expect(container.querySelector("textarea")?.value).toBe("Changed facts");
    expect(save).toHaveBeenLastCalledWith({
      orgId: "org",
      key: "operations",
      body: "Changed facts",
    });
    wiki.sections[0].body = "Facts from live extraction";
    await act(async () => render());
    expect(container.querySelector("textarea")?.value).toBe("Changed facts");
    await act(async () =>
      container.querySelector<HTMLButtonElement>("aside button")!.click(),
    );
    expect(container.querySelector("textarea")).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
