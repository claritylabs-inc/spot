"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";
import {
  getSettingsNavigation,
  resolveSettingsDestination,
  settingsPages,
  type SettingsPageId,
  type SettingsTabId,
} from "@/lib/settings-sections";
import { OrganizationSection } from "@/components/settings/organization-section";
import { TeamSection } from "@/components/settings/team-section";
import { EmailConnectionsSection } from "@/components/settings/email-connections-section";
import { ConnectionsSection } from "@/components/settings/connections-section";
import { CompanyWikiSection } from "@/components/settings/company-wiki-section";
import { AgentBehaviorSection } from "@/components/settings/agent-behavior-section";
import { BetaFeaturesSection } from "@/components/settings/beta-features-section";
import { NotificationPreferencesSection } from "@/components/settings/notification-preferences-section";
import { AgentChannelsSection } from "@/components/settings/agent-channels-section";

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);
  const currentOrg = useCurrentOrg();
  const isBroker = currentOrg?.isBroker ?? false;
  const isStandaloneClient = currentOrg?.orgType === "client";
  const groups = useMemo(
    () => getSettingsNavigation({ isStandaloneClient }),
    [isStandaloneClient],
  );
  const pages = useMemo(() => settingsPages(groups), [groups]);
  const destination = resolveSettingsDestination({
    requestedSection: searchParams.get("section"),
    requestedTab: searchParams.get("tab"),
    groups,
  });

  useEffect(() => {
    if (!currentOrg) return;
    if (isBroker) {
      router.replace("/broker");
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", destination.section);
    // A single-tab page has nothing to disambiguate, so its tab stays out of the URL.
    if (destination.page.tabs.length > 1) params.set("tab", destination.tab);
    else params.delete("tab");
    const next = params.toString();
    if (next === searchParams.toString()) return;
    router.replace(`/settings?${next}`);
  }, [
    currentOrg,
    destination.page,
    destination.section,
    destination.tab,
    isBroker,
    router,
    searchParams,
  ]);

  function navigate(section: SettingsPageId, tab: SettingsTabId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", section);
    params.set("tab", tab);
    router.push(`/settings?${params.toString()}`);
  }

  function handlePageChange(section: SettingsPageId) {
    const page = pages.find((item) => item.id === section);
    if (page) navigate(page.id, page.tabs[0].id);
  }

  if (isBroker) return null;

  return (
    <SettingsActionsContext.Provider
      value={{ setActions: setHeaderActions, setRightPanel }}
    >
      <AppShell
        breadcrumbDetail={destination.page.label}
        actions={headerActions}
        rightPanel={rightPanel}
      >
        <div className="-mx-6 mb-6 overflow-x-auto px-6 scrollbar-hide lg:hidden">
          <Tabs
            value={destination.section}
            onValueChange={(value) => handlePageChange(value as SettingsPageId)}
          >
            <TabsList variant="pill" className="min-w-max">
              {pages.map((page) => {
                const Icon = page.icon;
                return (
                  <TabsTrigger key={page.id} value={page.id}>
                    <Icon className="size-3.5 shrink-0" />
                    {page.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        {destination.page.tabs.length > 1 ? (
          <Tabs
            value={destination.tab}
            onValueChange={(value) =>
              navigate(destination.section, value as SettingsTabId)
            }
            className="mb-6"
          >
            <TabsList variant="pill">
              {destination.page.tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}

        <SectionContent section={destination.section} tab={destination.tab} />
      </AppShell>
    </SettingsActionsContext.Provider>
  );
}

function SectionContent({
  section,
  tab,
}: {
  section: SettingsPageId;
  tab: SettingsTabId;
}) {
  const currentOrg = useCurrentOrg();

  if (section === "organization") {
    return <OrganizationSection />;
  }
  if (section === "team") return <TeamSection />;
  if (section === "agent") {
    if (tab === "channels") {
      if (currentOrg?.orgId) {
        return <AgentChannelsSection clientOrgId={currentOrg.orgId} />;
      }
    }
    if (tab === "wiki") return <CompanyWikiSection />;
    return <AgentBehaviorSection />;
  }
  if (section === "workflows") {
    if (!currentOrg?.orgId) return null;
    return (
      <NotificationPreferencesSection
        orgId={currentOrg.orgId}
        orgType="client"
      />
    );
  }
  if (section === "integrations") return <ConnectionsSection />;
  if (section === "mailboxes") return <EmailConnectionsSection />;
  return <BetaFeaturesSection />;
}
