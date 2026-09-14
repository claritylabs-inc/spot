// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import { ScanSettingsDrawer } from "../components/operator/workspace-scan/scan-settings-drawer";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
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
afterEach(() => vi.clearAllMocks());

const currentOperatorId = "current-operator" as Id<"users">;
const config = {
  enabled: false,
  intervalMinutes: 60 as const,
  authorizationRevision: 2,
  authorizingOperatorId: "disabled-operator" as Id<"users">,
  pausedReason: "Authorizing operator disabled",
};

async function mount(
  props: Partial<React.ComponentProps<typeof ScanSettingsDrawer>> = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSave = vi.fn().mockResolvedValue(null);
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      <ScanSettingsDrawer
        config={config}
        currentOperatorId={currentOperatorId}
        ready
        onSave={onSave}
        onClose={onClose}
        {...props}
      />,
    ),
  );
  return {
    host,
    onSave,
    onClose,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function authorizationButton(host: HTMLElement) {
  return [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Authorize and enable",
  )!;
}

test("opening settings never authorizes writes; enabling reassigns a paused sponsor explicitly", async () => {
  const view = await mount();
  try {
    expect(view.onSave).not.toHaveBeenCalled();
    await act(async () => authorizationButton(view.host).click());
    expect(view.onSave).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      intervalMinutes: 60,
      authorizingOperatorId: currentOperatorId,
    });
    expect(view.onClose).toHaveBeenCalledOnce();
  } finally {
    await view.cleanup();
  }
});

test("unavailable Directory access cannot enable automatic changes", async () => {
  const view = await mount({ ready: false });
  try {
    const button = authorizationButton(view.host);
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(view.onSave).not.toHaveBeenCalled();
  } finally {
    await view.cleanup();
  }
});

test("failed authorization remains open and rapid repeated clicks cannot issue duplicate writes", async () => {
  let rejectSave: (error: Error) => void = () => {};
  const onSave = vi.fn(
    () =>
      new Promise<null>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const view = await mount({ onSave });
  try {
    const button = authorizationButton(view.host);
    await act(async () => {
      button.click();
      button.click();
    });
    expect(onSave).toHaveBeenCalledOnce();
    await act(async () => rejectSave(new Error("Access changed")));
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(authorizationButton(view.host).disabled).toBe(false);
  } finally {
    await view.cleanup();
  }
});
