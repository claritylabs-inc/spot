// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  OutreachEditor,
  ProcurementRequestWorkspace,
} from "../components/procurement/procurement-request-workspace";
import type { Id } from "../convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  update: vi.fn(),
  search: new URLSearchParams(),
  closePdf: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
  useSearchParams: () => mocks.search,
}));
vi.mock("@/components/pdf-context", () => ({
  usePdf: () => ({ closePdf: mocks.closePdf }),
}));
vi.mock("@/lib/sync/operator-cached-queries", () => ({
  useCachedOperatorBrokers: () => [],
}));
vi.mock("convex/react", () => ({
  useQuery: mocks.query,
  useMutation: () => mocks.update,
  useAction: () => vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    children,
    footer,
    onOpenChange,
  }: {
    children: ReactNode;
    footer: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <button onClick={() => onOpenChange(false)}>Close drawer</button>
      {children}
      {footer}
    </div>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.search = new URLSearchParams();
  mocks.replace.mockImplementation((href: string) => {
    window.history.replaceState(null, "", href);
    mocks.search = new URLSearchParams(window.location.search);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

const outreach = {
  _id: "outreach" as Id<"procurementBrokerOutreaches">,
  brokerOrgId: "broker" as Id<"organizations">,
  brokerName: "Example broker",
  contactEmail: "contact@example.com",
  status: "request_sent" as const,
  updatedAt: 1,
};

test("saving contact edits preserves a status updated by extraction", async () => {
  let current = { ...outreach, status: "request_sent" };
  mocks.query.mockImplementation((reference) =>
    getFunctionName(reference) === "procurementRequests:get"
      ? { outreaches: [current] }
      : [],
  );
  mocks.update.mockResolvedValue({});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "procurement-test" },
    persistence: "memory",
  });
  const rerender = () =>
    act(async () =>
      root.render(
        <SyncProvider store={store}>
          <OutreachEditor
            requestId={"request" as Id<"procurementRequests">}
            outreach={outreach}
            brokers={[{ _id: outreach.brokerOrgId, name: outreach.brokerName }]}
            onClose={() => {}}
          />
        </SyncProvider>,
      ),
    );
  try {
    await rerender();
    const input = container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "renewals@example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    current = { ...current, status: "quote_received" };
    await rerender();
    expect(input.value).toBe("renewals@example.com");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const saved = mocks.update.mock.calls[0][0];
    expect(saved).toMatchObject({
      outreachId: outreach._id,
      contactEmail: "renewals@example.com",
    });
    expect(saved.status).toBeUndefined();
    expect(saved.contactName).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

const historicalProposal = {
  _id: "historical" as Id<"procurementProposals">,
  outreachId: outreach._id,
  status: "archived",
  proposalMarkdown: "Historical exact terms",
  sectionHeadings: {},
  documents: [
    {
      _id: "old-document",
      fileName: "historical.pdf",
      url: "https://files.example/historical.pdf",
    },
  ],
  reviews: [],
  extraction: { latest: null },
};
const currentProposal = {
  ...historicalProposal,
  _id: "current" as Id<"procurementProposals">,
  status: "draft",
  documents: [
    {
      _id: "current-document",
      fileName: "current.pdf",
      url: "https://files.example/current.pdf",
    },
  ],
};

function renderHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "proposal-link-test" },
    persistence: "memory",
  });
  return {
    container,
    render: (child: ReactNode) =>
      act(async () =>
        root.render(<SyncProvider store={store}>{child}</SyncProvider>),
      ),
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("pinned historical proposals show their exact files read-only and never fall back to the current proposal", async () => {
  let proposals = [currentProposal, historicalProposal];
  mocks.query.mockImplementation((reference) =>
    getFunctionName(reference) === "procurementRequests:get"
      ? { outreaches: [outreach] }
      : proposals,
  );
  const harness = renderHarness();
  const editor = () => (
    <OutreachEditor
      requestId={"request" as Id<"procurementRequests">}
      outreach={outreach}
      proposalId={historicalProposal._id}
      brokers={[]}
      onClose={() => {}}
    />
  );
  try {
    await harness.render(editor());
    expect(
      harness.container.querySelector(
        'a[href="https://files.example/historical.pdf"]',
      ),
    ).not.toBeNull();
    expect(harness.container.textContent).not.toContain("current.pdf");
    expect(harness.container.querySelector("fieldset")?.disabled).toBe(true);
    expect(harness.container.textContent).not.toContain("Archive");
    proposals = [currentProposal];
    await harness.render(editor());
    expect(harness.container.textContent).toContain("no longer available");
    expect(harness.container.textContent).not.toContain("current.pdf");
    expect(mocks.update).not.toHaveBeenCalled();
  } finally {
    await harness.cleanup();
  }
});

function LinkedWorkspace() {
  const [panel, setPanel] = useState<ReactNode>(null);
  return (
    <>
      <ProcurementRequestWorkspace
        clientOrgId={"client" as Id<"organizations">}
        requestId={"request" as Id<"procurementRequests">}
        basePath="/operator/procurement"
        view="notes"
        readOnly={false}
        onRightPanel={setPanel}
      />
      {panel}
    </>
  );
}

test("proposal links wait for the open editor to close and do not reopen a dismissed link on live updates", async () => {
  window.history.replaceState(
    null,
    "",
    "/operator/procurement/request?view=proposals&proposal=historical",
  );
  mocks.search = new URLSearchParams(window.location.search);
  mocks.query.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "procurementRequests:get")
      return { request: { clientOrgId: "client" }, outreaches: [outreach] };
    if (name === "procurementProposals:list")
      return [currentProposal, historicalProposal];
    return undefined;
  });
  const harness = renderHarness();
  try {
    await harness.render(<LinkedWorkspace />);
    expect(harness.container.textContent).toContain("historical.pdf");
    window.history.replaceState(
      null,
      "",
      "/operator/procurement/request?view=proposals&proposal=current",
    );
    mocks.search = new URLSearchParams(window.location.search);
    await harness.render(<LinkedWorkspace />);
    expect(harness.container.textContent).toContain("historical.pdf");
    expect(harness.container.textContent).not.toContain("current.pdf");
    await act(async () =>
      Array.from(harness.container.querySelectorAll("button"))
        .find((button) => button.textContent === "Close drawer")!
        .click(),
    );
    expect(harness.container.textContent).toContain("current.pdf");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.search.get("proposal")).toBe("current");
    const email = harness.container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(email, "draft@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.update.mockRejectedValueOnce(new Error("Save failed"));
    await act(async () =>
      Array.from(harness.container.querySelectorAll("button"))
        .find((button) => button.textContent === "Close drawer")!
        .click(),
    );
    expect(harness.container.textContent).toContain("current.pdf");
    expect(email.value).toBe("draft@example.com");
    expect(mocks.replace).not.toHaveBeenCalled();
    mocks.update.mockResolvedValue({});
    await act(async () =>
      Array.from(harness.container.querySelectorAll("button"))
        .find((button) => button.textContent === "Close drawer")!
        .click(),
    );
    expect(harness.container.textContent).not.toContain("current.pdf");
    expect(mocks.replace).toHaveBeenCalledWith(
      "/operator/procurement/request?view=proposals",
      { scroll: false },
    );
    await harness.render(<LinkedWorkspace />);
    expect(harness.container.textContent).not.toContain("current.pdf");
    window.history.replaceState(
      null,
      "",
      "/operator/procurement/request?view=proposals&proposal=current",
    );
    mocks.search = new URLSearchParams(window.location.search);
    await harness.render(<LinkedWorkspace />);
    expect(harness.container.textContent).toContain("current.pdf");
  } finally {
    await harness.cleanup();
  }
});
