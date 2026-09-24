"use client";

import {
  Children,
  Fragment,
  Suspense,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@claritylabs-inc/ui/components/sheet";
import { PanelRightClose } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShellPanelLayout } from "@/components/app-shell-panel-layout";
import {
  AppShellSidebarLayout,
  APP_SIDEBAR_DEFAULT_WIDTH,
  appSidebarPreferenceStorageKey,
} from "@claritylabs-inc/ui/components/app-shell/app-shell-sidebar-layout";
import { useAppSidebarPreference } from "@claritylabs-inc/ui/components/app-shell/app-shell";
import { AppTopBar, type PresenceUser } from "@/components/app-top-bar";
import { OperatorImpersonationBanner } from "@/components/operator-impersonation-banner";
import { OperatorAgentPanel } from "@/components/operator-agent/operator-agent-panel";
import { useOptionalOperatorAgent } from "@/components/operator-agent/operator-agent-provider";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PillButton } from "@/components/ui/pill-button";

import { PdfProvider, usePdf } from "@/components/pdf-context";
import { PageContextProvider } from "@/hooks/use-page-context";
import {
  EntityPreviewProvider,
  useEntityPreview,
} from "@/hooks/use-entity-preview";
import { useSpotSync } from "@/lib/sync/spot-sync";
import { EntityPreviewPanel } from "@/components/entity-preview-panel";
import {
  CommandPalette,
  openCommandPalette,
} from "@/components/command-palette";
import dynamic from "next/dynamic";
import { useMediaQuery } from "@/components/app-sidebar/utils";

const PdfPanel = dynamic(
  () =>
    import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false },
);

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

function ShellContent({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
  rightPanel,
  customSidebar,
  customSidebarPreferenceStorageKey,
  storageUserId,
  disablePersistentChat = false,
  disableCommandPalette = false,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  presenceUsers?: PresenceUser[];
  rightPanel?: React.ReactNode;
  customSidebar?: (props: {
    collapsed: boolean;
    onToggleCollapse: () => void;
  }) => React.ReactNode;
  customSidebarPreferenceStorageKey: string | null;
  storageUserId?: string;
  disablePersistentChat?: boolean;
  disableCommandPalette?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMobileOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  // Register before the shared hook's restoration effect.
  useEffect(() => {
    if (customSidebar) return;
    try {
      const legacy = localStorage.getItem("sidebar-collapsed");
      if (legacy === "1" || legacy === "") {
        localStorage.setItem(
          "sidebar-collapsed",
          JSON.stringify({
            collapsed: legacy === "1",
            width: APP_SIDEBAR_DEFAULT_WIDTH,
          }),
        );
      }
    } catch {
      // Restricted storage leaves the shared hook's in-memory defaults intact.
    }
  }, [customSidebar]);
  const {
    ready: sidebarReady,
    preference: customSidebarPreference,
    toggleCollapse: toggleCustomSidebarCollapse,
    setCollapsed: updateCustomSidebarCollapsed,
    setWidth: updateCustomSidebarWidth,
  } = useAppSidebarPreference(
    customSidebar ? customSidebarPreferenceStorageKey : "sidebar-collapsed",
  );
  const { isPdfOpen, fileUrl } = usePdf();
  const { preview: entityPreview } = useEntityPreview();
  const operatorAgent = useOptionalOperatorAgent();
  const viewportReady = useMediaQuery("(min-width: 0px)");
  const isLarge = useMediaQuery("(min-width: 1024px)");
  const isExtraLarge = useMediaQuery("(min-width: 1280px)");
  const hasRoomForPreviewAndAgent = useMediaQuery("(min-width: 1800px)");
  const hasPdfPanel = isPdfOpen && !!fileUrl;
  const hasEntityPanel = !!entityPreview;
  const hasRightPanel = hasVisibleRightPanel(rightPanel);
  const constrainedPreviewOpen =
    isExtraLarge &&
    !hasRoomForPreviewAndAgent &&
    (hasPdfPanel || hasEntityPanel);
  const previewWasOpenRef = useRef(false);
  const operatorAgentPinned = Boolean(
    viewportReady &&
    operatorAgent?.open &&
    isExtraLarge &&
    !constrainedPreviewOpen,
  );
  const operatorAgentOverlayVisible = Boolean(
    viewportReady && operatorAgent?.open && !operatorAgentPinned,
  );

  useEffect(() => {
    const previewJustOpened =
      constrainedPreviewOpen && !previewWasOpenRef.current;
    previewWasOpenRef.current = constrainedPreviewOpen;
    if (!previewJustOpened) return;

    const frame = window.requestAnimationFrame(() => {
      if (operatorAgent?.open) operatorAgent.close();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [constrainedPreviewOpen, operatorAgent]);

  useEffect(() => {
    if (!operatorAgent?.open || !mobileOpen) return;
    const frame = window.requestAnimationFrame(() => setMobileOpen(false));
    return () => window.cancelAnimationFrame(frame);
  }, [mobileOpen, operatorAgent?.open]);

  if (!sidebarReady) {
    return <div className="h-dvh w-full bg-background" aria-busy="true" />;
  }

  const renderedCustomSidebar = customSidebar?.({
    collapsed: customSidebarPreference.collapsed,
    onToggleCollapse: toggleCustomSidebarCollapse,
  });
  const renderedMobileCustomSidebar = customSidebar?.({
    collapsed: false,
    onToggleCollapse: toggleCustomSidebarCollapse,
  });
  const operatorAgentToggle = operatorAgent?.enabled ? (
    <PillButton
      variant="primary"
      iconOnly
      label={
        operatorAgent.open ? "Minimize operator agent" : "Open operator agent"
      }
      aria-pressed={operatorAgent.open}
      onClick={operatorAgent.toggle}
    >
      {operatorAgent.open ? (
        <PanelRightClose className="size-3.5" />
      ) : (
        <LogoIcon size={15} static />
      )}
    </PillButton>
  ) : null;
  const effectiveRightPanel = operatorAgentPinned ? (
    <OperatorAgentPanel pagePanel={hasRightPanel ? rightPanel : undefined} />
  ) : operatorAgentOverlayVisible ? undefined : hasRightPanel ? (
    rightPanel
  ) : undefined;
  const panelLayout = (
    <AppShellPanelLayout
      main={
        <>
          <AppTopBar
            actions={
              operatorAgentToggle || actions ? (
                <>
                  {actions}
                  {operatorAgentToggle}
                </>
              ) : undefined
            }
            breadcrumbDetail={breadcrumbDetail}
            presenceUsers={presenceUsers}
            onMobileMenuToggle={() => setMobileOpen((v) => !v)}
            mobileMenuRef={mobileMenuRef}
            mobileMenuOpen={mobileOpen}
          />
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <main className="absolute inset-0 min-w-0 overflow-y-auto scrollbar-hide">
              <div className="w-full min-w-0 px-6 py-6 pb-32 lg:px-8">
                {children}
              </div>
            </main>
            {disableCommandPalette ? null : <CommandPalette />}
          </div>
        </>
      }
      entityPanel={hasEntityPanel ? <EntityPreviewPanel /> : undefined}
      rightPanel={effectiveRightPanel}
      rightPanelLabel={
        operatorAgentPinned ? "Resize operator agent" : undefined
      }
      preserveAuxiliaryPixelWidths={operatorAgentPinned}
      pdfPanel={hasPdfPanel ? <PdfPanel /> : undefined}
      storageUserId={storageUserId}
    />
  );

  return (
    <div className="flex h-dvh w-full min-w-0 flex-col overflow-hidden">
      <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {customSidebar ? (
          <>
            <AppShellSidebarLayout
              sidebar={renderedCustomSidebar}
              collapsed={customSidebarPreference.collapsed}
              defaultWidth={customSidebarPreference.width}
              onCollapsedChange={updateCustomSidebarCollapsed}
              onWidthChange={updateCustomSidebarWidth}
            >
              {panelLayout}
            </AppShellSidebarLayout>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent
                side="left"
                showCloseButton={false}
                className="w-[260px]! gap-0 bg-background lg:hidden"
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
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                {renderedMobileCustomSidebar}
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <>
            <Suspense fallback={null}>
              <AppSidebar
                collapsed={customSidebarPreference.collapsed}
                onToggleCollapse={toggleCustomSidebarCollapse}
                mobileOpen={mobileOpen}
                mobileMenuRef={mobileMenuRef}
                onMobileClose={() => setMobileOpen(false)}
                disablePersistentChat={disablePersistentChat}
                onAskSpot={
                  disableCommandPalette ? undefined : openCommandPalette
                }
              />
            </Suspense>
            {panelLayout}
          </>
        )}
      </div>
      <AnimatePresence>
        {operatorAgentOverlayVisible ? (
          <>
            {isLarge ? (
              <motion.button
                type="button"
                aria-label="Close operator agent"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-x-0 bottom-0 top-12 z-30 bg-black/20"
                onClick={() => operatorAgent?.close()}
              />
            ) : null}
            <motion.aside
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              className="fixed bottom-0 right-0 top-12 z-40 flex w-[420px] max-lg:left-0 max-lg:w-full"
              aria-label="Operator agent"
            >
              <OperatorAgentPanel
                pagePanel={hasRightPanel ? rightPanel : undefined}
              />
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
      <OperatorImpersonationBanner />
    </div>
  );
}

export function AppShell({
  children,
  actions,
  breadcrumbDetail,
  presenceUsers,
  rightPanel,
  customSidebar,
  customSidebarStorageKey,
  disablePersistentChat,
  disableCommandPalette,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbDetail?: React.ReactNode;
  presenceUsers?: PresenceUser[];
  rightPanel?: React.ReactNode;
  customSidebar?: (props: {
    collapsed: boolean;
    onToggleCollapse: () => void;
  }) => React.ReactNode;
  customSidebarStorageKey?: string;
  disablePersistentChat?: boolean;
  disableCommandPalette?: boolean;
}) {
  const { scope } = useSpotSync();
  const customSidebarPreferenceStorageKey = customSidebar
    ? appSidebarPreferenceStorageKey(
        customSidebarStorageKey ?? "custom-sidebar",
        scope.userId,
      )
    : null;

  return (
    <PageContextProvider>
      <PdfProvider>
        <EntityPreviewProvider>
          <ShellContent
            key={customSidebarPreferenceStorageKey ?? "default-app-shell"}
            actions={actions}
            breadcrumbDetail={breadcrumbDetail}
            presenceUsers={presenceUsers}
            rightPanel={rightPanel}
            customSidebar={customSidebar}
            customSidebarPreferenceStorageKey={
              customSidebarPreferenceStorageKey
            }
            storageUserId={scope.userId}
            disablePersistentChat={disablePersistentChat}
            disableCommandPalette={disableCommandPalette}
          >
            {children}
          </ShellContent>
        </EntityPreviewProvider>
      </PdfProvider>
    </PageContextProvider>
  );
}
