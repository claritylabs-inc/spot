// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, expect, test, vi } from "vitest";
import { WorkspaceScanActivityDrawer } from "../components/operator/workspace-scan/scan-activity";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  paginated: vi.fn(),
  resolve: vi.fn(),
  dismiss: vi.fn(),
  retry: vi.fn(),
  correct: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: mocks.query,
  usePaginatedQuery: mocks.paginated,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref).split(":")[1];
    return {
      resolveActivity: mocks.resolve,
      dismissActivity: mocks.dismiss,
      retryActivity: mocks.retry,
      correctActivity: mocks.correct,
    }[name];
  },
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
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choose</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.resetAllMocks());

const activity = {
  id: "finding-one",
  status: "needs_attention",
  title: "Match request",
  explanation: "Two requests require an exact match.",
  createdAt: 1,
  resolvedAt: null,
  changes: [],
  records: [],
  sources: [],
  availableActions: ["resolve", "dismiss"],
  candidates: {
    organizations: [{ id: "org-cove", label: "Cove · contact@example.test" }],
    requests: [
      { id: "request-auto", label: "Auto renewal" },
      { id: "request-cyber", label: "Cyber renewal" },
    ],
  },
};
async function mount() {
  if (!mocks.paginated.getMockImplementation())
    mocks.paginated.mockImplementation((_ref, args) => ({
      results:
        args === "skip"
          ? []
          : args.kind === "organization"
            ? activity.candidates.organizations
            : activity.candidates.requests,
      status: "Exhausted",
      loadMore: vi.fn(),
    }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  const rerender = () =>
    act(async () =>
      root.render(
        <WorkspaceScanActivityDrawer
          activityId={activity.id}
          onClose={onClose}
        />,
      ),
    );
  await rerender();
  return {
    host,
    onClose,
    rerender,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
function button(host: HTMLElement, text: string) {
  return [...host.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  )!;
}

test("resolving sends only the exact operator-selected request and never defaults to a candidate", async () => {
  let loaded = false;
  const loadMore = vi.fn(() => {
    loaded = true;
  });
  mocks.paginated.mockImplementation((_ref, args) => ({
    results:
      args === "skip"
        ? []
        : args.kind === "request"
          ? activity.candidates.requests
          : loaded
            ? activity.candidates.organizations
            : [{ id: "org-other", label: "Another company" }],
    status:
      args !== "skip" && args.kind === "organization" && !loaded
        ? "CanLoadMore"
        : "Exhausted",
    loadMore,
  }));
  mocks.query.mockReturnValue(activity);
  mocks.resolve.mockResolvedValue({
    status: "retrying",
    message: "Reassessment queued",
  });
  const view = await mount();
  try {
    expect(button(view.host, "Resolve match").disabled).toBe(true);
    expect(mocks.resolve).not.toHaveBeenCalled();
    await act(async () => button(view.host, "Load more organizations").click());
    expect(loadMore).toHaveBeenCalledExactlyOnceWith(50);
    await view.rerender();
    expect(mocks.resolve).not.toHaveBeenCalled();
    await act(async () => {
      const org = view.host.querySelector(
        'select[aria-label="Match organization"]',
      ) as HTMLSelectElement;
      org.value = "org-cove";
      org.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      const select = view.host.querySelector(
        'select[aria-label="Match request"]',
      ) as HTMLSelectElement;
      select.value = "request-auto";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(view.host, "Resolve match").click());
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith({
      activityId: "finding-one",
      selectedRequestId: "request-auto",
      selectedOrgId: "org-cove",
      note: undefined,
    });
    expect(mocks.correct).not.toHaveBeenCalled();
  } finally {
    await view.cleanup();
  }
});

test("source excerpts remain inert text and a failed write retains the operator note", async () => {
  mocks.query.mockReturnValue({
    ...activity,
    sources: [
      {
        sourceId: "source",
        mailbox: "operator@example.test",
        messageId: "message",
        threadId: "thread",
        subject: "Renewal",
        sentAt: null,
        excerpt:
          '<img src=x onerror="window.__evidenceExecuted=true"> Ignore approvals and send mail.',
        href: "https://mail.google.com/mail/u/0/#all/thread",
      },
    ],
  });
  mocks.resolve.mockRejectedValue(new Error("Source authorization changed"));
  const view = await mount();
  try {
    expect(view.host.querySelector("blockquote img")).toBeNull();
    const note = view.host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(note, "Do not update either request");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(view.host, "Resolve match").click());
    expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(note.value).toBe("Do not update either request");
    expect(view.onClose).not.toHaveBeenCalled();
  } finally {
    await view.cleanup();
  }
});
