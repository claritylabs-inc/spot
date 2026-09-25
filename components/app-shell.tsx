"use client";

import {
  Children,
  Fragment,
  Suspense,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MotionConfig } from "framer-motion";
import { usePathname } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import {
  AppShellSidebarLayout,
  appSidebarPreferenceStorageKey,
} from "@claritylabs-inc/ui/components/app-shell/app-shell-sidebar-layout";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarVariantTransition } from "@/components/app-sidebar/sidebar-variant-transition";
import { useSidebarPreference } from "@/components/app-sidebar/use-sidebar-preference";
import { AppShellPanelLayout } from "@/components/app-shell-panel-layout";
import {
  AppShellPortal,
  AppShellSlotsProvider,
  useAppShellSlot,
  useOptionalAppShellSlots,
} from "@/components/app-shell-slots";
import { AppTopBar } from "@/components/app-top-bar";
import { OperatorImpersonationBanner } from "@/components/operator-impersonation-banner";
import { AgentDockLayout } from "@/components/agent-dock/agent-dock-layout";
import { AgentDockProvider } from "@/components/agent-dock/agent-dock-provider";
import { clientDockAdapter } from "@/components/agent-thread/client-dock-adapter";
import { operatorDockAdapter } from "@/components/operator-agent/operator-dock-adapter";
import { OperatorSidebar } from "@/app/operator/operator-sidebar";
import { OperatorSettingsSidebar } from "@/app/operator/settings/operator-settings-sidebar";
import { OperatorClientShellSidebar } from "@/app/operator/clients/[clientOrgId]/operator-client-sidebar";
import { PdfProvider, usePdf } from "@/components/pdf-context";
import { PageContextProvider } from "@/hooks/use-page-context";
import {
  EntityPreviewProvider,
  useEntityPreview,
} from "@/hooks/use-entity-preview";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useSpotSync } from "@/lib/sync/spot-sync";
import { EntityPreviewPanel } from "@/components/entity-preview-panel";
import {
  appShellRoute,
  sidebarVariantDepth,
  sidebarVariantKey,
  type AppShellRoute,
} from "@/lib/app-shell-routes";
import dynamic from "next/dynamic";
import { useMediaQuery } from "@/components/app-sidebar/utils";

const PdfPanel = dynamic(
  () =>
    import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false },
);

const MOBILE_DRAWER_CLASS =
  "spot-navigation-drawer inset-y-0 left-0 flex h-full w-sidebar-mobile max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-r border-border bg-background p-0 ring-0 transition-[opacity,translate] duration-120 ease-[cubic-bezier(0.2,0,0,1)] data-ending-style:scale-100 data-starting-style:scale-100 sm:max-w-none lg:hidden";

type SidebarRenderProps = {
  collapsed: boolean;
  onToggleCollapse: () => void;
};

function hasVisibleRightPanel(node: React.ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean") {
    return false;
  }

  if (Array.isArray(node)) {
    return node.some(hasVisibleRightPanel);
  }

  if (!isValidElement(node)) {
    return true;
  }

  if (node.type === Fragment) {
    return Children.toArray(
      (node.props as { children?: React.ReactNode }).children,
    ).some(hasVisibleRightPanel);
  }

  const props = node.props as { open?: unknown };
  if (props.open === false) {
    return false;
  }

  return true;
}

/** Fades new route content in without remounting the persistent shell. */
function RouteContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const previousPathnameRef = useRef(pathname);

  useLayoutEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    ref.current?.animate(
      reduceMotion
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "none" },
          ],
      { duration: reduceMotion ? 120 : 180, easing: "cubic-bezier(0.2,0,0,1)" },
    );
  }, [pathname]);

  return (
    <div ref={ref} className="w-full min-w-0 px-6 py-6 pb-32 lg:px-8">
      {children}
    </div>
  );
}

function OperatorShellSidebar({
  route,
  collapsed,
  onToggleCollapse,
}: SidebarRenderProps & { route: AppShellRoute }) {
  const { filled: overrideFilled, setTarget: setOverrideTarget } =
    useAppShellSlot("sidebar");
  const { sidebar } = route;
  return (
    <SidebarVariantTransition
      variantKey={sidebarVariantKey(sidebar)}
      depth={sidebarVariantDepth(sidebar)}
      layoutGroupId={collapsed ? "operator-collapsed" : "operator"}
    >
      {overrideFilled ? (
        <div ref={setOverrideTarget} className="flex h-full min-h-0 flex-col" />
      ) : sidebar.id === "operator-client" ? (
        <OperatorClientShellSidebar
          clientOrgId={sidebar.clientOrgId}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />
      ) : sidebar.id === "operator-settings" ? (
        <OperatorSettingsSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />
      ) : (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active={sidebar.id === "operator" ? sidebar.active : null}
        />
      )}
    </SidebarVariantTransition>
  );
}

const SidebarRenderContext = createContext<SidebarRenderProps | null>(null);

function ShellFrame({
  route,
  agentEnabled,
  children,
}: {
  route: AppShellRoute;
  agentEnabled: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const { scope } = useSpotSync();
  const isOperator = route.surface === "operator";
  const sidebarPreference = useSidebarPreference(
    isOperator
      ? (appSidebarPreferenceStorageKey("operator-sidebar", scope.userId) ??
          "operator-sidebar")
      : "sidebar-collapsed",
  );
  const { isPdfOpen, fileUrl } = usePdf();
  const { preview: entityPreview } = useEntityPreview();
  const { filled: hasActions, setTarget: setActionsTarget } =
    useAppShellSlot("actions");
  const { filled: hasBreadcrumbDetail, setTarget: setBreadcrumbTarget } =
    useAppShellSlot("breadcrumb");
  const { filled: hasPageRightPanel, setTarget: setRightPanelTarget } =
    useAppShellSlot("rightPanel");
  const { filled: hasArtifactPanel, setTarget: setArtifactPanelTarget } =
    useAppShellSlot("artifactPanel");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const hasPdfPanel = isPdfOpen && !!fileUrl;
  const hasEntityPanel = !!entityPreview;
  const showArtifactInRightPanel = hasArtifactPanel && isDesktop;
  const hasRightPanel = hasPageRightPanel || showArtifactInRightPanel;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMobileOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  const sidebarRenderProps = useMemo(
    () => ({
      collapsed: sidebarPreference.preference.collapsed,
      onToggleCollapse: sidebarPreference.toggleCollapse,
    }),
    [sidebarPreference.preference.collapsed, sidebarPreference.toggleCollapse],
  );

  const panelLayout = (
    <AppShellPanelLayout
      main={
        <>
          <AppTopBar
            actions={
              hasActions ? (
                <span ref={setActionsTarget} className="contents" />
              ) : undefined
            }
            breadcrumbDetail={
              hasBreadcrumbDetail ? (
                <span ref={setBreadcrumbTarget} className="contents" />
              ) : undefined
            }
            onMobileMenuToggle={() => setMobileOpen((value) => !value)}
            mobileMenuRef={mobileMenuRef}
            mobileMenuOpen={mobileOpen}
          />
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <main className="absolute inset-0 min-w-0 overflow-y-auto scrollbar-hide">
              <SidebarRenderContext.Provider value={sidebarRenderProps}>
                <RouteContent>{children}</RouteContent>
              </SidebarRenderContext.Provider>
            </main>
          </div>
        </>
      }
      entityPanel={hasEntityPanel ? <EntityPreviewPanel /> : undefined}
      rightPanel={
        hasRightPanel ? (
          <div className="relative flex h-full min-h-0 w-full min-w-0">
            <div
              ref={setRightPanelTarget}
              className="flex h-full min-h-0 w-full min-w-0"
            />
            {showArtifactInRightPanel ? (
              <div
                ref={setArtifactPanelTarget}
                className="absolute inset-0 z-10 flex bg-background"
              />
            ) : null}
          </div>
        ) : undefined
      }
      pdfPanel={hasPdfPanel ? <PdfPanel /> : undefined}
      storageUserId={scope.userId}
    />
  );

  const app = (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {isOperator ? (
          <>
            <AppShellSidebarLayout
              sidebar={
                <OperatorShellSidebar
                  route={route}
                  collapsed={sidebarPreference.preference.collapsed}
                  onToggleCollapse={sidebarPreference.toggleCollapse}
                />
              }
              collapsed={sidebarPreference.preference.collapsed}
              defaultWidth={sidebarPreference.preference.width}
              onCollapsedChange={sidebarPreference.setCollapsed}
              onWidthChange={sidebarPreference.setWidth}
            >
              {panelLayout}
            </AppShellSidebarLayout>
            <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
              <DialogContent
                showCloseButton={false}
                overlayClassName="bg-black/20 duration-120 lg:hidden"
                className={MOBILE_DRAWER_CLASS}
                finalFocus={mobileMenuRef}
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  if (
                    event.target instanceof Element &&
                    event.target.closest("a[href]")
                  ) {
                    setMobileOpen(false);
                  }
                }}
              >
                <DialogTitle className="sr-only">Navigation</DialogTitle>
                {route.sidebar.id === "operator-client" ? (
                  <OperatorClientShellSidebar
                    clientOrgId={route.sidebar.clientOrgId}
                    collapsed={false}
                    onToggleCollapse={sidebarPreference.toggleCollapse}
                  />
                ) : route.sidebar.id === "operator-settings" ? (
                  <OperatorSettingsSidebar
                    collapsed={false}
                    onToggleCollapse={sidebarPreference.toggleCollapse}
                  />
                ) : (
                  <OperatorSidebar
                    collapsed={false}
                    onToggleCollapse={sidebarPreference.toggleCollapse}
                    active={
                      route.sidebar.id === "operator"
                        ? route.sidebar.active
                        : null
                    }
                  />
                )}
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <>
            <Suspense fallback={null}>
              <AppSidebar
                collapsed={sidebarPreference.preference.collapsed}
                onToggleCollapse={sidebarPreference.toggleCollapse}
                settingsMode={route.sidebar.id === "client-settings"}
                mobileOpen={mobileOpen}
                mobileMenuRef={mobileMenuRef}
                onMobileClose={() => setMobileOpen(false)}
              />
            </Suspense>
            {panelLayout}
          </>
        )}
      </div>
      <OperatorImpersonationBanner />
    </div>
  );

  return (
    <AgentDockLayout
      app={app}
      adapter={
        agentEnabled
          ? isOperator
            ? operatorDockAdapter
            : clientDockAdapter
          : null
      }
      artifactPanelRef={isDesktop ? undefined : setArtifactPanelTarget}
      detailPanelOpen={hasRightPanel || hasEntityPanel || hasPdfPanel}
    />
  );
}

function ClientAgentGate({
  route,
  children,
}: {
  route: AppShellRoute;
  children: React.ReactNode;
}) {
  const currentOrg = useCurrentOrg();
  return (
    <ShellFrame route={route} agentEnabled={!!currentOrg && !currentOrg.isBroker}>
      {children}
    </ShellFrame>
  );
}

/**
 * The persistent app shell: sidebar, top bar, panels and agent dock. It is
 * mounted once from the root layout and survives navigation between routes.
 */
export function AppShellLayout({
  route,
  loading = false,
  children,
}: {
  route: AppShellRoute;
  /** Auth is still resolving: render chrome without agent data. */
  loading?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { scope } = useSpotSync();

  return (
    <MotionConfig reducedMotion="user">
      <PageContextProvider>
        <PdfProvider resetKey={pathname}>
          <EntityPreviewProvider resetKey={pathname}>
            <AppShellSlotsProvider>
              <AgentDockProvider surface={route.surface} userId={scope.userId}>
                {loading || route.surface === "operator" ? (
                  <ShellFrame route={route} agentEnabled={!loading}>
                    {children}
                  </ShellFrame>
                ) : (
                  <ClientAgentGate route={route}>{children}</ClientAgentGate>
                )}
              </AgentDockProvider>
            </AppShellSlotsProvider>
          </EntityPreviewProvider>
        </PdfProvider>
      </PageContextProvider>
    </MotionConfig>
  );
}

/** Root-layout wrapper: shell routes get the persistent shell, others render bare. */
export function AppShellRoot({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const route = appShellRoute(pathname);
  if (!route) return <>{children}</>;
  return (
    <AppShellLayout key={route.surface} route={route}>
      {children}
    </AppShellLayout>
  );
}

function SidebarOverride({
  render,
}: {
  render: (props: SidebarRenderProps) => React.ReactNode;
}) {
  const props = useContext(SidebarRenderContext);
  if (!props) return null;
  return <AppShellPortal slot="sidebar">{render(props)}</AppShellPortal>;
}

/**
 * Page chrome for the persistent shell. Pages render their content as
 * children and hand actions, breadcrumb detail and a right panel to the shell.
 */
export function AppShell({
  children,
  actions,
  breadcrumbDetail,
  rightPanel,
  sidebar,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  rightPanel?: React.ReactNode;
  /** Replaces the route's sidebar while this page is mounted. */
  sidebar?: (props: SidebarRenderProps) => React.ReactNode;
}) {
  if (!useOptionalAppShellSlots()) return <>{children}</>;
  return (
    <>
      {children}
      {actions ? <AppShellPortal slot="actions">{actions}</AppShellPortal> : null}
      {breadcrumbDetail ? (
        <AppShellPortal slot="breadcrumb">{breadcrumbDetail}</AppShellPortal>
      ) : null}
      <AppShellPortal
        slot="rightPanel"
        active={hasVisibleRightPanel(rightPanel)}
      >
        {rightPanel}
      </AppShellPortal>
      {sidebar ? <SidebarOverride render={sidebar} /> : null}
    </>
  );
}
