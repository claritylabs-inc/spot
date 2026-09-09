// @vitest-environment happy-dom
import { act, createRef, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import {
  ProcurementEmailDrawer,
  type ProcurementEmailDrawerHandle,
} from "@/components/procurement/procurement-shared";
import type { Id } from "@/convex/_generated/dataModel";

const { update, file, state } = vi.hoisted(() => ({
  update: vi.fn(),
  file: vi.fn(),
  state: { attachments: false, proposalStatus: "reviewed", category: "other" },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/sync/operator-cached-queries", () => ({
  useCachedOperatorBrokers: () => [],
}));
vi.mock("convex/react", () => ({
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(reference) === "procurementRequests:updateEmailThread"
      ? update
      : file,
  useQuery: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name === "procurementRequests:getEmailThread")
      return {
        thread: {
          requestId: "request",
          category: state.category,
          subject: "QA email",
        },
        addressedRequest: {
          title: "QA request",
          forwardingAddress: "qa@example.test",
        },
        messages: [],
      };
    if (name === "procurementProposals:list")
      return [
        {
          _id: "proposal",
          outreachId: "outreach",
          status: state.proposalStatus,
        },
      ];
    return {
      filable: true,
      files: state.attachments
        ? [{ clientFileId: "file", name: "quote.pdf" }]
        : [],
      unfiledFiles: state.attachments
        ? [{ clientFileId: "file", name: "quote.pdf" }]
        : [],
      outreaches: [{ outreachId: "outreach", brokerName: "QA broker" }],
      outreachInference: {
        status: "exact",
        candidates: [{ outreachId: "outreach" }],
      },
    };
  },
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      aria-label="Participant category"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="other">Other</option>
      <option value="broker">Broker</option>
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  }) => (
    <select
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="request">QA request</option>
      <option value="second">Second request</option>
      <option value="outreach">QA broker</option>
    </select>
  ),
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
      <button onClick={() => onOpenChange(false)}>Close</button>
      {children}
      {footer}
    </div>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.resetAllMocks();
  state.attachments = false;
  state.proposalStatus = "reviewed";
  state.category = "other";
});

async function mount(close: () => void) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "email-test" },
    persistence: "memory",
  });
  const drawerRef = createRef<ProcurementEmailDrawerHandle>();
  const render = () =>
    root.render(
      <SyncProvider store={store}>
        <ProcurementEmailDrawer
          ref={drawerRef}
          emailThreadId={"thread" as Id<"procurementEmailThreads">}
          requests={[
            {
              _id: "request" as Id<"procurementRequests">,
              title: "QA request",
            },
          ]}
          readOnly={false}
          onClose={close}
        />
      </SyncProvider>,
    );
  await act(async () => render());
  return {
    container,
    render,
    drawerRef,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
function button(container: Element, text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === text,
  )!;
}

test("classification close retains failed draft and retries only the edited field", async () => {
  update
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(undefined);
  const close = vi.fn();
  const view = await mount(close);
  try {
    const category = view.container.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      category.value = "broker";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(category.value).toBe("broker");
    await act(async () => button(view.container, "Close").click());
    expect(close).not.toHaveBeenCalled();
    expect(category.value).toBe("broker");
    expect(update).toHaveBeenLastCalledWith({
      emailThreadId: "thread",
      category: "broker",
      requestId: undefined,
    });
    await act(async () => button(view.container, "Close").click());
    expect(close).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2);
  } finally {
    await view.cleanup();
  }
});

test("filing a revision supplies the exact prior proposal and selected proposals stay protected", async () => {
  state.attachments = true;
  file.mockResolvedValue({ status: "revised" });
  const view = await mount(vi.fn());
  try {
    await act(async () => button(view.container, "File revision").click());
    expect(file).toHaveBeenCalledWith({
      emailThreadId: "thread",
      outreachId: "outreach",
      clientFileIds: ["file"],
      supersedesProposalId: "proposal",
    });
    state.proposalStatus = "selected";
    await act(async () => view.render());
    expect(button(view.container, "File revision").disabled).toBe(true);
  } finally {
    await view.cleanup();
  }
});

test("acknowledged category follows another operator and is not resent with a later request edit", async () => {
  update.mockResolvedValue(undefined);
  const view = await mount(vi.fn());
  try {
    const category = view.container.querySelector<HTMLSelectElement>(
      'select[aria-label="Participant category"]',
    )!;
    await act(async () => {
      category.value = "broker";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await view.drawerRef.current!.save();
    });
    state.category = "other";
    await act(async () => view.render());
    expect(category.value).toBe("other");
    const request = view.container.querySelector<HTMLSelectElement>(
      'select[aria-label="Choose request"]',
    )!;
    await act(async () => {
      request.value = "second";
      request.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await view.drawerRef.current!.save();
    });
    expect(update).toHaveBeenLastCalledWith({
      emailThreadId: "thread",
      category: undefined,
      requestId: "second",
    });
  } finally {
    await view.cleanup();
  }
});

test("an earlier acknowledgement preserves a newer edit made while saving", async () => {
  let acknowledge!: () => void;
  update
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const view = await mount(vi.fn());
  try {
    const category = view.container.querySelector<HTMLSelectElement>(
      'select[aria-label="Participant category"]',
    )!;
    await act(async () => {
      category.value = "broker";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    let saving!: Promise<boolean>;
    await act(async () => {
      saving = view.drawerRef.current!.save();
    });
    await act(async () => {
      category.value = "other";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      acknowledge();
      await saving;
    });
    expect(category.value).toBe("other");
    await act(async () => {
      await view.drawerRef.current!.save();
    });
    expect(update).toHaveBeenLastCalledWith({
      emailThreadId: "thread",
      category: "other",
      requestId: undefined,
    });
  } finally {
    await view.cleanup();
  }
});
