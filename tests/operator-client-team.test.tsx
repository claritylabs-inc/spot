// @vitest-environment happy-dom
import { act, Profiler, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import OperatorClientPage from "@/app/operator/clients/[clientOrgId]/page";

const fixture = vi.hoisted(() => ({
  client: { _id: "client", name: "Example", operatorStatus: "onboarding" },
  current: { activeImpersonation: null },
  members: [],
  invitations: [],
  viewer: { _id: "operator" },
  mutate: vi.fn(),
  patchClientStatus: vi.fn(),
  patchClientSettings: vi.fn(),
  saveNow: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ clientOrgId: "client" }),
  useSearchParams: () => new URLSearchParams("tab=team"),
}));
vi.mock("convex/react", () => ({
  useQuery: () => fixture.client,
  useMutation: () => fixture.mutate,
  useAction: () => fixture.mutate,
}));
vi.mock("@/lib/sync/operator-cached-queries", () => ({
  useCachedOperatorCurrent: () => fixture.current,
  useCachedOperatorClients: () => [fixture.client],
  useOperatorClientCacheActions: () => ({
    patchClientStatus: fixture.patchClientStatus,
    patchClientSettings: fixture.patchClientSettings,
  }),
}));
vi.mock("@/lib/sync/spot-cached-queries", () => ({
  useCachedViewerOrg: () => null,
}));
vi.mock("@/lib/sync/use-cached-query", () => ({
  useCachedQuery: (key: string) => key.includes("listMembers")
    ? fixture.members : key.includes("listInvitations")
      ? fixture.invitations : fixture.viewer,
  useUpdateCachedQuery: () => fixture.mutate,
}));
vi.mock("@/lib/sync/use-local-first-auto-save", () => ({
  useLocalFirstAutoSave: () => ({ status: "saved", saveNow: fixture.saveNow }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, actions, rightPanel }: {
    children: ReactNode; actions: ReactNode; rightPanel: ReactNode;
  }) => <div>{actions}{children}{rightPanel}</div>,
}));
vi.mock("@/components/operator-agent/operator-page-context", () => ({
  OperatorPageContextRegistration: () => null,
}));
vi.mock("@/components/operator/workspace-scan/scan-activity", () => ({ WorkspaceScanActivity: () => null }));
vi.mock("@/components/settings/agent-channels-section", () => ({ AgentChannelsSection: () => null }));
vi.mock("@/app/operator/clients/[clientOrgId]/wiki/page", () => ({ default: () => null }));
vi.mock("@/app/operator/clients/[clientOrgId]/operator-client-sidebar", () => ({ OperatorClientSidebar: () => null }));
vi.mock("@/app/operator/clients/client-logo-field", () => ({ ClientLogoField: () => null }));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({ open, title, children, footer, onOpenChange }: {
    open: boolean; title: string; children: ReactNode; footer: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => open ? <section aria-label={title}>
    <button onClick={() => onOpenChange(false)}>Close</button>{children}{footer}
  </section> : null,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("client Team settles on entry and remains responsive when opening and closing an invitation", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let commits = 0;
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await act(async () => root.render(
      <Profiler id="team" onRender={() => {
        if (++commits > 40) throw new Error("Team page did not settle");
      }}><OperatorClientPage /></Profiler>,
    ));
    expect(container.textContent).toContain("No team members yet");
    await click("Invite member");
    expect(container.querySelector('[aria-label="Invite team member"]')).not.toBeNull();
    await click("Close");
    expect(container.querySelector('[aria-label="Invite team member"]')).toBeNull();
    expect(fixture.mutate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
