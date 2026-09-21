// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CompliancePage, OperatorComplianceWorkspace } from "@/components/compliance-page";
import type { Id } from "@/convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  search: new URLSearchParams(),
  query: vi.fn(),
  save: vi.fn(),
  updateCache: vi.fn(),
  toast: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.search,
  usePathname: () => "/compliance",
  useRouter: () => mocks.router,
}));
vi.mock("convex/react", () => ({ useMutation: () => mocks.save, useAction: () => vi.fn() }));
vi.mock("@/lib/hooks/use-active-org-context", () => ({ useActiveOrgContext: () => null }));
vi.mock("@/lib/sync/use-cached-query", () => ({
  useCachedQuery: mocks.query,
  useUpdateCachedQuery: () => mocks.updateCache,
}));
vi.mock("@/lib/sync/spot-cached-queries", () => ({ useCachedConnectedVendors: () => [] }));
vi.mock("@/components/pdf-context", () => ({ usePdf: () => ({ openWithUrl: vi.fn() }) }));
vi.mock("@/components/ui/address-autofill-input", () => ({ AddressAutofillInput: () => null }));
vi.mock("sonner", () => ({ toast: { error: mocks.toast } }));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({ children, title, open, onOpenChange }: {
    children: ReactNode; title: string; open: boolean; onOpenChange: (open: boolean) => void;
  }) => open ? <section data-drawer={title}><button onClick={() => onOpenChange(false)}>Close drawer</button>{children}</section> : null,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const orgId = "org" as Id<"organizations">;
const requirements = ["first", "exact"].map(id => ({
  _id: id as Id<"insuranceRequirements">,
  orgId,
  kind: "coverage" as const,
  scope: "own_org" as const,
  title: `${id} requirement`,
  requirementText: "Carry cyber insurance.",
  lineOfBusiness: "CYBER",
  limits: [{ kind: "aggregate" as const, amount: 1_000_000 }],
  updatedAt: 1,
}));
const sources = ["first-source", "exact-source"].map(id => ({
  _id: id as Id<"requirementSourceDocuments">,
  orgId,
  title: id,
  sourceType: "vendor_requirements" as const,
  status: "complete" as const,
  requirementCount: 0,
  createdAt: 1,
  updatedAt: 1,
}));
let loaded: boolean;
beforeEach(() => {
  vi.useFakeTimers();
  loaded = true;
  mocks.search = new URLSearchParams();
  mocks.save.mockResolvedValue(undefined);
  mocks.query.mockImplementation((key: string) => {
    if (key === "compliance.listRequirements") return loaded ? requirements : undefined;
    if (key === "compliance.listRequirementSources") return loaded ? sources : undefined;
    return [];
  });
});
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

function mount(operator = false, admin = false) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({ scope: { appId: "compliance-link-test" }, persistence: "memory" });
  const Component = operator ? OperatorComplianceWorkspace : CompliancePage;
  return {
    container,
    render: () => act(async () => root.render(
      <SyncProvider store={store}>
        <Component orgContext={{ orgId, orgType: "client", role: admin ? "admin" : "member", isReadOnlyImpersonation: false }}
          renderShell={({ rightPanel, children }) => <>{children}{rightPanel}</>} />
      </SyncProvider>,
    )),
    close: () => act(async () => container.querySelector<HTMLButtonElement>("[data-drawer] button")!.click()),
    dispose: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

test.each([false, true])("requirement query waits for authorized data, selects exactly, and stays closed (operator=%s)", async operator => {
  mocks.search = new URLSearchParams("requirement=exact");
  loaded = false;
  const page = mount(operator);
  try {
    await page.render();
    expect(page.container.querySelector("[data-drawer]")).toBeNull();
    loaded = true;
    await page.render();
    expect(page.container.querySelector("[data-drawer]")?.getAttribute("data-drawer")).toBe("exact requirement");
    await page.close();
    await page.render();
    expect(page.container.querySelector("[data-drawer]")).toBeNull();
    mocks.search = new URLSearchParams();
    await page.render();
    mocks.search = new URLSearchParams("requirement=exact");
    await page.render();
    expect(page.container.querySelector("[data-drawer]")?.getAttribute("data-drawer")).toBe("exact requirement");
  } finally { await page.dispose(); }
});

test("source query selects only the exact authorized source and consumes missing or ambiguous links", async () => {
  mocks.search = new URLSearchParams("source=exact-source");
  const page = mount();
  try {
    await page.render();
    expect(page.container.querySelector<HTMLInputElement>("[data-drawer] input")?.value).toBe("exact-source");
    await page.close();
    await page.render();
    expect(page.container.querySelector("[data-drawer]")).toBeNull();
    for (const query of ["source=foreign-source", "requirement=foreign-requirement", "requirement=exact&source=exact-source"]) {
      mocks.search = new URLSearchParams(query);
      await page.render();
      await page.render();
      expect(page.container.querySelector("[data-drawer]")).toBeNull();
    }
    expect(mocks.toast).toHaveBeenCalledTimes(3);
    expect(mocks.save).not.toHaveBeenCalled();
  } finally { await page.dispose(); }
});

test("a new requirement link waits for the existing draft to save successfully", async () => {
  mocks.search = new URLSearchParams("requirement=first");
  const page = mount(true, true);
  try {
    await page.render();
    const title = page.container.querySelector<HTMLInputElement>("[data-drawer] input")!;
    await act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Unsaved edit");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.search = new URLSearchParams("requirement=exact");
    await page.render();
    expect(title.value).toBe("Unsaved edit");
    expect(page.container.querySelector("[data-drawer]")?.getAttribute("data-drawer")).toBe("first requirement");
    mocks.save.mockRejectedValueOnce(new Error("Offline"));
    await page.close();
    expect(title.isConnected).toBe(true);
    expect(title.value).toBe("Unsaved edit");
    await page.close();
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ requirementId: "first", title: "Unsaved edit" }));
    expect(page.container.querySelector("[data-drawer]")?.getAttribute("data-drawer")).toBe("exact requirement");
    await page.close();
    await page.render();
    expect(page.container.querySelector("[data-drawer]")).toBeNull();
  } finally { await page.dispose(); }
});

test("an editable source keeps its draft and pending navigation after a failed close", async () => {
  mocks.search = new URLSearchParams("source=exact-source");
  const page = mount(true, true);
  try {
    await page.render();
    const title = page.container.querySelector<HTMLInputElement>("[data-drawer] input")!;
    await act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Edited source");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.search = new URLSearchParams("requirement=exact");
    await page.render();
    mocks.save.mockRejectedValueOnce(new Error("Offline"));
    await page.close();
    expect(title.isConnected).toBe(true);
    expect(title.value).toBe("Edited source");
    await page.close();
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceDocumentId: "exact-source", title: "Edited source" }));
    expect(page.container.querySelector("[data-drawer]")?.getAttribute("data-drawer")).toBe("exact requirement");
  } finally { await page.dispose(); }
});
