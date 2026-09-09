// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { OutreachEditor } from "../components/procurement/procurement-request-workspace";
import type { Id } from "../convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  update: vi.fn(),
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
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => vi.useFakeTimers());
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
  log: "Original log",
  updatedAt: 1,
};

test("saving an open log preserves a status updated by extraction", async () => {
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
    expect(input.value).toBe("Follow up on the limit");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const saved = mocks.update.mock.calls[0][0];
    expect(saved).toMatchObject({
      outreachId: outreach._id,
      log: "Follow up on the limit",
    });
    expect(saved.status).toBeUndefined();
    expect(saved.contactEmail).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
