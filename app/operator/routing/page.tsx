"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useTabParam } from "@/hooks/use-tab-param";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDisplayDate } from "@/lib/date-format";
import {
  useCachedOperatorGlobalModelSettings,
  useOperatorRouterCapabilities,
} from "@/lib/sync/operator-cached-queries";
import { OperatorSidebar } from "../operator-sidebar";
import { ModelsTab } from "./models-tab";
import { RoutingTab, useRouterDashboard } from "./routing-tab";
import { ToolsTab } from "./tools-tab";
import { typeStyle } from "@/lib/typography";

const ROUTING_PAGE_TABS = ["routing", "models", "tools"] as const;

export default function OperatorRoutingPage() {
  const modelSettings = useCachedOperatorGlobalModelSettings() as
    | { updatedAt: number | null }
    | undefined;
  const {
    dashboard,
    loading,
    loadError,
    refresh,
    freezeLoading,
    setGlobalFreeze,
  } = useRouterDashboard();
  const { capabilities } = useOperatorRouterCapabilities();

  const [activeTab, selectTab] = useTabParam(ROUTING_PAGE_TABS);

  const actions =
    activeTab === "routing" ? (
      <PillButton
        variant="secondary"
        size="compact"
        label={loading ? "Refreshing…" : "Refresh"}
        expandLabel
        disabled={loading}
        onClick={() => void refresh()}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
      </PillButton>
    ) : activeTab === "models" && modelSettings?.updatedAt ? (
      <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        Updated {formatDisplayDate(modelSettings.updatedAt)}
      </span>
    ) : undefined;

  return (
    <AppShell
      actions={actions}
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="routing"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
    >
      <main className="flex w-full flex-col">
        <Tabs value={activeTab} onValueChange={selectTab} className="gap-4">
          <TabsList variant="pill" aria-label="Routing section">
            <TabsTrigger value="routing">Routing</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
          </TabsList>
          <TabsContent value="routing">
            <RoutingTab
              dashboard={dashboard}
              loading={loading}
              loadError={loadError}
              freezeLoading={freezeLoading}
              setGlobalFreeze={setGlobalFreeze}
            />
          </TabsContent>
          <TabsContent value="models">
            <ModelsTab capabilities={capabilities} />
          </TabsContent>
          <TabsContent value="tools">
            <ToolsTab capabilities={capabilities} />
          </TabsContent>
        </Tabs>
      </main>
    </AppShell>
  );
}
