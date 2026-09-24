"use client";

import { useModelOverrides } from "./model-overrides";
import { useSearchParams } from "next/navigation";
import { SidebarHeader } from "@/components/app-sidebar/sidebar-header";
import {
  SidebarMenuItem,
  SidebarTooltipProvider,
} from "@/components/app-sidebar/nav-item";
import { Settings, Route, Users } from "lucide-react";
import { useMcpSettings } from "@/components/operator/mcp-settings";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { api } from "@/convex/_generated/api";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useOperatorInvite } from "@/components/operator/operator-invite-panel";

export default function OperatorSettingsPage() {
  const current = useCachedOperatorCurrent();
  const invitations = useOperatorInvite(!current || Boolean(current.activeImpersonation));
  const sectionParam = useSearchParams().get("section");
  const section =
    sectionParam === "models" || sectionParam === "team"
      ? sectionParam
      : "general";
  const overrides = useModelOverrides(
    !current || Boolean(current.activeImpersonation),
  );
  const settings = useQuery(api.operator.getAgentSettings);
  const setApproveAll = useMutation(api.operator.setApproveAll);
  const [saving, setSaving] = useState(false);
  const mcp = useMcpSettings(!current || Boolean(current.activeImpersonation));

  return (
    <AppShell
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <SidebarTooltipProvider>
          <SidebarHeader
            collapsed={collapsed}
            initials="OP"
            headerOrgName="Settings"
            onToggleCollapse={onToggleCollapse}
            backHref="/operator/threads"
          />
          <div className="space-y-1 p-2">
            <SidebarMenuItem
              href="/operator/settings"
              icon={Settings}
              label="General"
              active={section === "general"}
              collapsed={collapsed}
            />
            <SidebarMenuItem
              href="/operator/settings?section=models"
              icon={Route}
              label="Model overrides"
              active={section === "models"}
              collapsed={collapsed}
            />
            <SidebarMenuItem
              href="/operator/settings?section=team"
              icon={Users}
              label="Team"
              active={section === "team"}
              collapsed={collapsed}
            />
          </div>
        </SidebarTooltipProvider>
      )}
      customSidebarStorageKey="operator-sidebar"
      rightPanel={
        section === "models"
          ? overrides.drawer
          : section === "team"
            ? invitations.drawer
            : mcp.drawer
      }
      actions={section === "models" ? overrides.action : undefined}
      disablePersistentChat
      disableCommandPalette
    >
      {section === "models" ? (
        overrides.panel
      ) : section === "team" ? (
        invitations.panel
      ) : !settings || !current ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          <OperationalPanel>
            <OperationalPanelHeader title="Agent approvals" />
            <OperationalPanelBody>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className={typeStyle("body.medium")}>Approve all</p>
                  <p
                    className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    Run agent actions without asking for approval, including
                    sends and deletions. Applies to all operators across every
                    channel. Existing pending approvals still need a decision.
                  </p>
                </div>
                <SettingsSwitch
                  label="Approve all"
                  checked={settings.approveAll}
                  disabled={saving || Boolean(current.activeImpersonation)}
                  onCheckedChange={() => {
                    setSaving(true);
                    void setApproveAll({ approveAll: !settings.approveAll })
                      .catch((error) => {
                        toast.error(
                          getUserFacingErrorMessage(
                            error,
                            "Approval settings could not be saved.",
                          ),
                        );
                      })
                      .finally(() => setSaving(false));
                  }}
                />
              </div>
            </OperationalPanelBody>
          </OperationalPanel>
          {mcp.panel}
        </div>
      )}
    </AppShell>
  );
}
