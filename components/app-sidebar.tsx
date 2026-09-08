"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { NavItemConfig } from "@/components/app-sidebar/types";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { NotificationsPanel } from "@/components/notifications-panel";
import { MainSidebarContent } from "@/components/app-sidebar/main-sidebar-content";
import { SidebarTooltipProvider } from "@/components/app-sidebar/nav-item";
import {
  AGENT_DOMAIN,
  BROKER_NAV_ITEMS,
  CONNECT_ITEMS,
  INSURANCE_ITEMS,
  SHORTCUT_PREFIX_KEY,
  SHORTCUT_SEQUENCE_TIMEOUT_MS,
} from "@/components/app-sidebar/nav-config";
import { SettingsSidebarContent } from "@/components/app-sidebar/settings-sidebar-content";
import { splitThreadConversations } from "@/lib/thread-display";
import {
  getInitials,
  isEditableTarget,
  useMediaQuery,
} from "@/components/app-sidebar/utils";
import { useCachedQuery, useSetCachedQuery } from "@/lib/sync/use-cached-query";
import { createClientMutationId } from "@/lib/sync/client-mutation-id";
import { useArchivedThreadCacheActions } from "@/lib/sync/spot-cached-queries";
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
  mobileOpen,
  onMobileClose,
  onAskSpot,
  disablePersistentChat = false,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onAskSpot?: () => void;
  disablePersistentChat?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isSettingsMode = pathname.startsWith("/settings");

  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const viewerOrg = useCachedQuery("orgs.viewerOrg", api.orgs.viewerOrg, {});
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const canReadThreads = !!currentOrg && !isBroker && !disablePersistentChat;
  const unifiedThreads = useCachedQuery(
    "threads.list.active",
    api.threads.list,
    canReadThreads ? { archived: false } : "skip",
  );
  const archivedThreads = useCachedQuery(
    "threads.list.archived",
    api.threads.list,
    canReadThreads ? { archived: true } : "skip",
  );
  const setThreadDetail = useSetCachedQuery<
    NonNullable<typeof unifiedThreads>[number],
    { id: Id<"threads"> }
  >("threads.get.current");
  const createThread = useMutation(api.threads.create);
  const archiveThread = useMutation(api.threads.archive);
  const { archiveThreadLocally } = useArchivedThreadCacheActions();
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

  useEffect(() => {
    const rows = [...(unifiedThreads ?? []), ...(archivedThreads ?? [])];
    if (rows.length === 0) return;
    void Promise.all(
      rows.map((thread) => setThreadDetail({ id: thread._id }, thread)),
    );
  }, [archivedThreads, setThreadDetail, unifiedThreads]);

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

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
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
  const { agentConversations, pinnedConversations } = useMemo(
    () => splitThreadConversations(unifiedThreads),
    [unifiedThreads],
  );
  const visibleAgentConversations = useMemo(
    () => (disablePersistentChat ? [] : agentConversations),
    [agentConversations, disablePersistentChat],
  );
  const visiblePinnedConversations = useMemo(
    () => (disablePersistentChat ? [] : pinnedConversations),
    [disablePersistentChat, pinnedConversations],
  );
  const shortcutConversations = useMemo(
    () => [...visiblePinnedConversations, ...visibleAgentConversations],
    [visibleAgentConversations, visiblePinnedConversations],
  );

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("sidebar-collapsed", next ? "1" : "");
    } catch {}
  }

  useEffect(() => {
    onMobileClose?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleArchiveThread(threadId: string, active: boolean) {
    await archiveThreadLocally(threadId as Id<"threads">);
    await archiveThread({ id: threadId as Id<"threads"> });
    if (!active) return;

    const next = shortcutConversations.find((c) => c.id !== threadId);
    if (next) {
      router.push(`/agent/thread/${next.id}`);
      return;
    }

    const nextThreadId = await createThread({
      agentDomain: AGENT_DOMAIN,
      clientMutationId: createClientMutationId("thread"),
    });
    router.push(`/agent/thread/${nextThreadId}`);
  }

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
        return;
      }

      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9 && num <= shortcutConversations.length) {
        e.preventDefault();
        router.push(`/agent/thread/${shortcutConversations[num - 1].id}`);
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
  }, [router, shortcutConversations, pageShortcutMap]);

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
        disablePersistentChat={disablePersistentChat}
        notificationsPanelOpen={notificationsPanelOpen}
        unreadCount={unreadCount}
        isDesktop={isDesktop}
        orgId={currentOrg?.orgId}
        agentConversations={visibleAgentConversations}
        pinnedConversations={visiblePinnedConversations}
        archivedThreadCount={
          disablePersistentChat ? 0 : (archivedThreads?.length ?? 0)
        }
        onToggleCollapse={toggleCollapse}
        onToggleNotifications={() => setNotificationsPanelOpen((v) => !v)}
        onCloseNotifications={() => setNotificationsPanelOpen(false)}
        onAskSpot={disablePersistentChat ? undefined : onAskSpot}
        onArchiveThread={handleArchiveThread}
        onSignOut={() => {
          clearOnboardingCache();
          signOut();
        }}
      />
    );
  }

  function renderBaseActiveContent(contentCollapsed: boolean) {
    let content: React.ReactNode;

    if (isSettingsMode) {
      content = renderSettingsSidebarContent(contentCollapsed);
    } else {
      content = renderSidebarContent(contentCollapsed);
    }

    return <SidebarTooltipProvider>{content}</SidebarTooltipProvider>;
  }

  const activeContent = renderBaseActiveContent(collapsed);
  const mobileActiveContent = renderBaseActiveContent(false);
  const activeMode = isSettingsMode ? "settings" : "main";
  const activeModeMovesRight = activeMode !== "main";

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col shrink-0 h-full overflow-hidden border-r sidebar-transition ${
          collapsed ? "w-14" : "w-[220px]"
        } border-border bg-background`}
      >
        <div className="relative h-full min-h-0 w-full overflow-hidden">
          <AnimatePresence initial={false} mode="sync">
            <motion.div
              key={activeMode}
              initial={
                reduceMotion
                  ? false
                  : {
                      opacity: 0,
                      x: activeModeMovesRight ? 12 : -12,
                    }
              }
              animate={{ opacity: 1, x: 0 }}
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : {
                      opacity: 0,
                      x: activeModeMovesRight ? 6 : -6,
                    }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      opacity: { duration: 0.1, ease: [0.2, 0, 0, 1] },
                      x: { duration: 0.16, ease: [0.2, 0, 0, 1] },
                    }
              }
              className="absolute inset-0 overflow-hidden bg-background will-change-transform"
            >
              {activeContent}
            </motion.div>
          </AnimatePresence>
        </div>
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

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-black/20 z-40 lg:hidden"
              onClick={onMobileClose}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
              className="fixed left-0 top-0 bottom-0 w-[260px] z-50 border-r border-border bg-background lg:hidden"
            >
              {mobileActiveContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
