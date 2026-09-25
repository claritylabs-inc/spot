"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import type { NavItemConfig } from "@/components/app-sidebar/types";
import { LayoutGroup } from "framer-motion";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { NotificationsPanel } from "@/components/notifications-panel";
import { MainSidebarContent } from "@/components/app-sidebar/main-sidebar-content";
import { SidebarTooltipProvider } from "@/components/app-sidebar/nav-item";
import { SidebarVariantTransition } from "@/components/app-sidebar/sidebar-variant-transition";
import { useOptionalAgentDock } from "@/components/agent-dock/agent-dock-provider";
import {
  BROKER_NAV_ITEMS,
  CONNECT_ITEMS,
  INSURANCE_ITEMS,
  SHORTCUT_PREFIX_KEY,
  SHORTCUT_SEQUENCE_TIMEOUT_MS,
} from "@/components/app-sidebar/nav-config";
import { SettingsSidebarContent } from "@/components/app-sidebar/settings-sidebar-content";
import {
  getInitials,
  isEditableTarget,
  useMediaQuery,
} from "@/components/app-sidebar/utils";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { isFeatureEnabled } from "@/convex/lib/featureFlags";
import {
  getSettingsNavigation,
  resolveSettingsDestination,
} from "@/lib/settings-sections";

const NO_NAV_ITEMS: NavItemConfig[] = [];

function sidebarHeaderBranding({
  viewerOrg,
  viewerName,
  viewerEmail,
}: {
  viewerOrg:
    | {
        org?: {
          name?: string;
          iconUrl?: string | null;
        } | null;
      }
    | null
    | undefined;
  viewerName?: string | null;
  viewerEmail?: string | null;
}) {
  const brandedOrg = viewerOrg?.org;

  return {
    name: brandedOrg?.name ?? viewerName ?? viewerEmail ?? "",
    iconUrl: brandedOrg?.iconUrl ?? null,
  };
}

export function AppSidebar({
  collapsed,
  onToggleCollapse: toggleCollapse,
  settingsMode,
  mobileOpen,
  mobileMenuRef,
  onMobileClose,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  settingsMode: boolean;
  mobileOpen?: boolean;
  mobileMenuRef?: RefObject<HTMLButtonElement | null>;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const dock = useOptionalAgentDock();

  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const viewerOrg = useCachedQuery("orgs.viewerOrg", api.orgs.viewerOrg, {});
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const { signOut } = useAuthActions();
  const { clearCache: clearOnboardingCache } = useOnboardingCache();
  const showConnectFeatures = isFeatureEnabled(
    currentOrg?.org,
    "connect_features",
  );
  const isStandaloneClient = currentOrg?.orgType === "client";
  const canManageSettings = !isBroker && currentOrg?.role === "admin";
  const navItems = isBroker ? BROKER_NAV_ITEMS : INSURANCE_ITEMS;
  const connectItems =
    isBroker || !showConnectFeatures ? NO_NAV_ITEMS : CONNECT_ITEMS;
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const pageShortcutMap = useMemo<Record<string, string>>(
    () => ({
      ...Object.fromEntries(
        navItems
          .filter((item) => item.shortcut)
          .map((item) => [item.shortcut!.key.toLowerCase(), item.href]),
      ),
      ...Object.fromEntries(
        connectItems
          .filter((item) => item.shortcut)
          .map((item) => [item.shortcut!.key.toLowerCase(), item.href]),
      ),
      ...(canManageSettings ? { s: "/settings" } : {}),
      u: "/profile",
    }),
    [canManageSettings, connectItems, navItems],
  );

  const shortcutSequenceActiveRef = useRef(false);
  const shortcutSequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false);
  const unreadCount = useCachedQuery(
    "notifications.unreadCount.sidebar",
    api.notifications.unreadCount,
    currentOrg?.orgId ? { orgId: currentOrg.orgId } : "skip",
  ) as number | undefined;

  useEffect(() => {
    onMobileClose?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function clearShortcutSequence() {
      shortcutSequenceActiveRef.current = false;
      if (shortcutSequenceTimerRef.current) {
        clearTimeout(shortcutSequenceTimerRef.current);
        shortcutSequenceTimerRef.current = null;
      }
    }

    function startShortcutSequence() {
      clearShortcutSequence();
      shortcutSequenceActiveRef.current = true;
      shortcutSequenceTimerRef.current = setTimeout(
        clearShortcutSequence,
        SHORTCUT_SEQUENCE_TIMEOUT_MS,
      );
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (!shortcutSequenceActiveRef.current) {
        if (key === SHORTCUT_PREFIX_KEY) {
          e.preventDefault();
          startShortcutSequence();
        }
        return;
      }

      clearShortcutSequence();

      if (key === SHORTCUT_PREFIX_KEY) {
        e.preventDefault();
        startShortcutSequence();
        return;
      }

      const pageHref = pageShortcutMap[key];
      if (pageHref) {
        e.preventDefault();
        router.push(pageHref);
      }
    }

    function handleBlur() {
      clearShortcutSequence();
    }

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    return () => {
      clearShortcutSequence();
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
    };
  }, [router, pageShortcutMap]);

  const headerBranding = sidebarHeaderBranding({
    viewerOrg,
    viewerName: viewer?.name,
    viewerEmail: viewer?.email,
  });
  const headerOrgName = headerBranding.name;
  const headerOrgIcon = headerBranding.iconUrl;
  const initials = getInitials(headerOrgName, viewer?.email);

  const activeSettingsSection = resolveSettingsDestination({
    requestedSection: searchParams.get("section"),
    requestedTab: searchParams.get("tab"),
    groups: getSettingsNavigation({ isStandaloneClient }),
  }).section;

  function renderSettingsSidebarContent(contentCollapsed: boolean) {
    return (
      <SettingsSidebarContent
        collapsed={contentCollapsed}
        isStandaloneClient={isStandaloneClient}
        activeSettingsSection={activeSettingsSection}
        onToggleCollapse={toggleCollapse}
      />
    );
  }

  function renderSidebarContent(contentCollapsed: boolean) {
    return (
      <MainSidebarContent
        collapsed={contentCollapsed}
        isBroker={isBroker}
        canManageSettings={canManageSettings}
        pathname={pathname}
        headerOrgIcon={headerOrgIcon}
        viewerImage={viewer?.image}
        initials={initials}
        headerOrgName={headerOrgName}
        navItems={navItems}
        connectItems={connectItems}
        notificationsPanelOpen={notificationsPanelOpen}
        unreadCount={unreadCount}
        isDesktop={isDesktop}
        orgId={currentOrg?.orgId}
        onToggleCollapse={toggleCollapse}
        onToggleNotifications={() => setNotificationsPanelOpen((v) => !v)}
        onCloseNotifications={() => setNotificationsPanelOpen(false)}
        onAskSpot={dock && !isBroker ? dock.newChat : undefined}
        onSignOut={() => {
          clearOnboardingCache();
          signOut();
        }}
      />
    );
  }

  function renderContent(contentCollapsed: boolean) {
    return (
      <SidebarTooltipProvider>
        {settingsMode
          ? renderSettingsSidebarContent(contentCollapsed)
          : renderSidebarContent(contentCollapsed)}
      </SidebarTooltipProvider>
    );
  }

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col shrink-0 h-full overflow-hidden border-r sidebar-transition ${
          collapsed ? "w-14" : "w-[220px]"
        } border-border bg-background`}
      >
        <SidebarVariantTransition
          variantKey={settingsMode ? "settings" : "main"}
          depth={settingsMode ? 1 : 0}
          layoutGroupId={collapsed ? "client-collapsed" : "client"}
        >
          {renderContent(collapsed)}
        </SidebarVariantTransition>
      </aside>

      {notificationsPanelOpen && isDesktop && currentOrg?.orgId && (
        <aside className="hidden h-full w-80 min-w-80 max-w-80 shrink-0 overflow-hidden lg:flex">
          <NotificationsPanel
            orgId={currentOrg.orgId}
            variant="pane"
            onClose={() => setNotificationsPanelOpen(false)}
          />
        </aside>
      )}

      <Dialog
        open={mobileOpen ?? false}
        onOpenChange={(open) => {
          if (!open) onMobileClose?.();
        }}
      >
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/20 duration-120 lg:hidden"
          className="spot-navigation-drawer inset-y-0 left-0 flex h-full w-sidebar-mobile max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-r border-border bg-background p-0 ring-0 transition-[opacity,translate] duration-120 ease-[cubic-bezier(0.2,0,0,1)] data-ending-style:scale-100 data-starting-style:scale-100 sm:max-w-none lg:hidden"
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
              onMobileClose?.();
            }
          }}
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <LayoutGroup id="client-mobile">{renderContent(false)}</LayoutGroup>
        </DialogContent>
      </Dialog>
    </>
  );
}
