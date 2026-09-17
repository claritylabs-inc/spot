// @vitest-environment happy-dom

import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../convex/_generated/dataModel";
import {
  AUTOMATION_ENABLED,
  AUTOMATION_DISABLED,
  automationSummary,
  configuredAutomation,
  type ConnectedEmailAccountRow,
} from "../components/settings/email-connection-ui";
import { MailboxSettingsDrawer } from "../components/settings/email-connection-drawers";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  autoSave: vi.fn(),
  saveNow: vi.fn(),
  scanMailboxRange: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => mocks.scanMailboxRange,
  useMutation: () => mocks.mutation,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/lib/sync/use-local-first-auto-save", () => ({
  useLocalFirstAutoSave: (options: unknown) => {
    mocks.autoSave(options);
    return {
      saveNow: mocks.saveNow,
      saving: false,
      status: "saving",
    };
  },
}));

vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    actions,
    children,
    footer,
  }: {
    actions?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
  }) => (
    <div>
      {actions}
      {footer}
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/dialog", () => {
  const Section = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );

  return {
    Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
      open ? <div data-testid="scan-dialog">{children}</div> : null,
    DialogContent: Section,
    DialogDescription: Section,
    DialogFooter: Section,
    DialogHeader: Section,
    DialogTitle: Section,
  };
});

vi.mock("@/components/ui/pill-button", () => ({
  PillButton: ({
    children,
    variant,
    ...props
  }: ComponentProps<"button"> & { variant?: string }) => (
    <button data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT: ConnectedEmailAccountRow = {
  _id: "mailbox-1" as Id<"connectedEmailAccounts">,
  orgId: "org-1" as Id<"organizations">,
  scope: "user",
  emailAddress: "owner@example.com",
  host: "imap.example.com",
  port: 993,
  secure: true,
  username: "owner@example.com",
  status: "active",
  automation: {
    policyImports: true,
    requirementImports: true,
  },
  automationConfigured: true,
  createdAt: 1,
  updatedAt: 1,
};

let mountedRoot: Root | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function buttonWithText(container: ParentNode, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Could not find button: ${text}`);
  return button;
}

async function mountDrawer(options?: {
  canManageMailbox?: boolean;
  onSaveBarrierChange?: (barrier: (() => Promise<boolean>) | null) => void;
}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;

  await act(async () => {
    root.render(
      <MailboxSettingsDrawer
        account={ACCOUNT}
        canManageMailbox={options?.canManageMailbox ?? true}
        canManageOrgMailboxes
        onOpenChange={vi.fn()}
        onSaved={vi.fn(async () => undefined)}
        onDisconnected={vi.fn(async () => undefined)}
        onSaveBarrierChange={options?.onSaveBarrierChange ?? vi.fn()}
      />,
    );
  });

  return container;
}

async function renderDrawer() {
  const container = await mountDrawer();

  await act(async () => {
    buttonWithText(container, "Scan mailbox").click();
  });

  const dialog = container.querySelector('[data-testid="scan-dialog"]');
  if (!dialog) throw new Error("Scan dialog did not open");
  return { container, dialog };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
});

describe("MailboxSettingsDrawer manual scan", () => {
  it("waits for an A -> B -> A compensation before scanning", async () => {
    const saveGate = deferred<boolean>();
    const scanStarted = deferred<void>();
    const events: string[] = [];
    mocks.saveNow.mockImplementation(async () => {
      events.push("save-start");
      const saved = await saveGate.promise;
      events.push("save-complete");
      return saved;
    });
    mocks.scanMailboxRange.mockImplementation(async () => {
      events.push("scan");
      scanStarted.resolve();
      return {
        alreadyProcessedCount: 0,
        attentionCount: 0,
        matchedCount: 0,
        scannedCount: 0,
        truncated: false,
      };
    });
    const { dialog } = await renderDrawer();

    await act(async () => {
      buttonWithText(dialog, "Scan mailbox").click();
      await Promise.resolve();
    });

    expect(mocks.saveNow).toHaveBeenCalledWith({ force: false });
    expect(mocks.scanMailboxRange).not.toHaveBeenCalled();
    expect(events).toEqual(["save-start"]);

    await act(async () => {
      saveGate.resolve(true);
      await scanStarted.promise;
    });

    expect(events).toEqual(["save-start", "save-complete", "scan"]);
    expect(mocks.scanMailboxRange).toHaveBeenCalledOnce();
  });

  it("does not scan when the compensating save fails", async () => {
    const saveGate = deferred<boolean>();
    mocks.saveNow.mockImplementation(() => saveGate.promise);
    const { container, dialog } = await renderDrawer();

    await act(async () => {
      buttonWithText(dialog, "Scan mailbox").click();
      await Promise.resolve();
    });
    expect(mocks.scanMailboxRange).not.toHaveBeenCalled();

    await act(async () => {
      saveGate.resolve(false);
      await saveGate.promise;
      await Promise.resolve();
    });

    expect(mocks.scanMailboxRange).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="scan-dialog"]'),
    ).not.toBeNull();
    expect(
      buttonWithText(
        container.querySelector('[data-testid="scan-dialog"]')!,
        "Scan mailbox",
      ).disabled,
    ).toBe(false);
  });
});

it("offers and saves only policy and requirement controls, including stale legacy input", async () => {
  expect(AUTOMATION_ENABLED).toEqual({
    policyImports: true,
    requirementImports: true,
  });
  expect(AUTOMATION_DISABLED).toEqual({
    policyImports: false,
    requirementImports: false,
  });
  const legacy = {
    ...ACCOUNT,
    automation: { ...AUTOMATION_DISABLED, companyMemory: true },
  };
  expect(configuredAutomation(legacy)).toEqual(AUTOMATION_DISABLED);
  expect(automationSummary(legacy)).toBe("Monitoring off");
  const container = await mountDrawer();
  expect(container.querySelectorAll('[role="switch"]')).toHaveLength(2);
  expect(container.textContent).not.toContain("Company wiki");
  await act(async () => {
    (
      container.querySelector(
        '[aria-label="Monitor policy documents"]',
      ) as HTMLButtonElement
    ).click();
  });
  const options = mocks.autoSave.mock.lastCall?.[0];
  expect(options.args.automation).toEqual({
    policyImports: false,
    requirementImports: true,
  });
  await options.flush(options.args);
  expect(mocks.mutation).toHaveBeenCalledWith({
    accountId: ACCOUNT._id,
    scope: "user",
    automation: { policyImports: false, requirementImports: true },
  });
});
