"use client";
import { RootLoading } from "@/components/root-loading";

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
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
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
import { OperatorPresence } from "@/components/operator-agent/operator-presence";
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

/** Top-level section of a path, so moves within one section don't re-animate. */
function routeSection(pathname: string) {
  return pathname.split("/").slice(0, 3).join("/");
}

/** Softly fades content in when switching sections; moves within a section swap in place. */
function RouteContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const previousPathnameRef = useRef(pathname);

  useLayoutEffect(() => {
    const previous = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (routeSection(previous) === routeSection(pathname)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ref.current?.animate([{ opacity: 0.5 }, { opacity: 1 }], {
      duration: 120,
      easing: "ease-out",
    });
  }, [pathname]);

  return (
    <div ref={ref} className="w-full min-w-0 px-6 py-6 lg:px-8">
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
  const { filled: hasSecondaryNav, setTarget: setSecondaryNavTarget } =
    useAppShellSlot("secondaryNav");
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const hasPdfPanel = isPdfOpen && !!fileUrl;
  const hasEntityPanel = !!entityPreview;
  const hasRightPanel = hasPageRightPanel;

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
            presence={
              isOperator && agentEnabled ? <OperatorPresence /> : undefined
            }
            onMobileMenuToggle={() => setMobileOpen((value) => !value)}
            mobileMenuRef={mobileMenuRef}
            mobileMenuOpen={mobileOpen}
          />
          {/* A page menu sits under the top bar, edged like the app sidebar. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {hasSecondaryNav ? (
              <aside
                ref={setSecondaryNavTarget}
                className="hidden h-full shrink-0 border-r border-border bg-background lg:flex"
              />
            ) : null}
            <div className="relative min-w-0 flex-1">
              <main className="absolute inset-0 min-w-0 overflow-y-auto scrollbar-hide">
                <SidebarRenderContext.Provider value={sidebarRenderProps}>
                  <RouteContent>{children}</RouteContent>
                </SidebarRenderContext.Provider>
              </main>
            </div>
          </div>
        </>
      }
      entityPanel={hasEntityPanel ? <EntityPreviewPanel /> : undefined}
      rightPanel={
        hasRightPanel ? (
          // Safari can scroll the resizable panel when a nested popup receives
          // focus. Clip at its positioned wrapper without creating a scrollport.
          <div className="relative flex h-full min-h-0 w-full min-w-0 lg:overflow-clip">
            <div
              ref={setRightPanelTarget}
              className="flex h-full min-h-0 w-full min-w-0"
            />
          </div>
        ) : undefined
      }
      pdfPanel={hasPdfPanel ? <PdfPanel /> : undefined}
      storageUserId={scope.userId}
    />
  );

  const app = (
    <div
      data-app-surface={route.surface}
      className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background"
    >
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
      artifactPanelRef={agentEnabled ? setArtifactPanelTarget : undefined}
      artifactPlacement={isDesktop ? "side" : "overlay"}
      artifactOpen={hasArtifactPanel}
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
    <ShellFrame
      route={route}
      agentEnabled={!!currentOrg && !currentOrg.isBroker}
    >
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
  const router = useRouter();
  const route = appShellRoute(pathname);
  const viewer = useQuery(api.users.viewer, {});
  const currentOrg = useCurrentOrg();
  const clientSurface = route?.surface === "client" || pathname === "/";
  const intakeOnly =
    !!viewer?.intakeRestricted ||
    (!!currentOrg &&
      !currentOrg.isBroker &&
      !currentOrg.isPartner &&
      currentOrg.org.clientAccessStatus !== "active");
  useEffect(() => {
    if (clientSurface && intakeOnly) router.replace("/signup");
  }, [clientSurface, intakeOnly, router]);
  if (clientSurface && (!viewer || !currentOrg || intakeOnly))
    return pathname === "/" ? <RootLoading /> : null;
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
      {actions ? (
        <AppShellPortal slot="actions">{actions}</AppShellPortal>
      ) : null}
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
