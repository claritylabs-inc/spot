"use client";

import { useModelOverrides } from "./model-overrides";
import { useSearchParams } from "next/navigation";
import { OperatorSettingsSidebar } from "./settings-sidebar";
import OperatorChannelsPage from "./channels";
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

export default function OperatorSettingsPage() {
  const requested = useSearchParams().get("section");
  if (requested === "channels") return <OperatorChannelsPage />;
  const section =
    requested === "models" || requested === "mcp" ? requested : "general";
  return <OperatorSettingsContent key={section} section={section} />;
}

function OperatorSettingsContent({
  section,
}: {
  section: "general" | "models" | "mcp";
}) {
  const current = useCachedOperatorCurrent();
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
        <OperatorSettingsSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active={section}
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      rightPanel={
        section === "models"
          ? overrides.drawer
          : section === "mcp"
            ? mcp.drawer
            : undefined
      }
      actions={section === "models" ? overrides.action : undefined}
      disablePersistentChat
      disableCommandPalette
    >
      {section === "models" ? (
        overrides.panel
      ) : section === "mcp" ? (
        mcp.panel
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
        </div>
      )}
    </AppShell>
  );
}
