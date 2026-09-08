// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { OutreachEditor } from "../components/procurement/procurement-request-workspace";
import type { Id } from "../convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mocks.query(...args),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(reference).endsWith(":confirmReview")
      ? mocks.confirm
      : mocks.update,
  useAction: () => vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("@/components/ui/org-brand-icon", () => ({ OrgBrandIcon: () => null }));
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: () => null,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectValue: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const outreach = {
  _id: "outreach" as Id<"procurementBrokerOutreaches">,
  brokerOrgId: "broker" as Id<"organizations">,
  brokerName: "Example broker",
  contactEmail: "contact@example.com",
  status: "request_sent" as const,
  log: "Original log",
  updatedAt: 1,
};

async function renderSidebar(
  run: (container: HTMLElement, rerender: () => Promise<void>) => Promise<void>,
) {
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
    await run(container, rerender);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  }
}

function button(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  )!;
}

test("saving an open log preserves a status updated by extraction", async () => {
  let current = { ...outreach, status: "request_sent" };
  mocks.query.mockImplementation((reference) =>
    getFunctionName(reference) === "procurementRequests:get"
      ? { outreaches: [current] }
      : [],
  );
  mocks.update.mockResolvedValue({});
  await renderSidebar(async (container, rerender) => {
    const input = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "Follow up on the limit");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    current = { ...current, status: "quote_received" };
    await rerender();
    expect(container.textContent).toContain("Quote received");
    expect(input.value).toBe("Follow up on the limit");
    expect(button(container, "Save broker")).toBeUndefined();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    const saved = mocks.update.mock.calls[0][0];
    expect(saved).toMatchObject({
      outreachId: outreach._id,
      log: "Follow up on the limit",
    });
    expect(saved.status).toBeUndefined();
    expect(saved.contactEmail).toBeUndefined();
  });
});

test("a confirmed review immediately stops offering confirmation in the open sidebar", async () => {
  const review = {
    _id: "review",
    modelConclusion: "has_gaps",
    stale: false,
    findings: [],
  };
  let proposal = {
    _id: "proposal",
    outreachId: outreach._id,
    status: "review_ready",
    extractedOffer: {},
    proposalMarkdown: "",
    sectionHeadings: {},
    documents: [],
    reviews: [review],
    extraction: { latest: null },
  };
  mocks.query.mockImplementation((reference) =>
    getFunctionName(reference) === "procurementRequests:get"
      ? { outreaches: [outreach] }
      : [proposal],
  );
  mocks.confirm.mockResolvedValue({});
  await renderSidebar(async (container, rerender) => {
    await act(async () => button(container, "Terms").click());
    await act(async () => button(container, "Confirm conclusion").click());
    expect(mocks.confirm).toHaveBeenCalledWith({
      reviewId: "review",
      conclusion: "has_gaps",
    });
    proposal = {
      ...proposal,
      status: "reviewed",
      reviews: [{ ...review, staffConclusion: "has_gaps" } as typeof review],
    };
    await rerender();
    expect(button(container, "Confirm conclusion")).toBeUndefined();
    expect(container.textContent).toContain("Confirmed");
  });
});
