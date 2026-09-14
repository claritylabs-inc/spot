"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { OperatorSidebar } from "@/app/operator/operator-sidebar";
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
  const current = useCachedOperatorCurrent();
  const settings = useQuery(api.operator.getAgentSettings);
  const setApproveAll = useMutation(api.operator.setApproveAll);
  const [saving, setSaving] = useState(false);

  return (
    <AppShell
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="settings"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
    >
      {!settings || !current ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <OperationalPanel>
          <OperationalPanelHeader title="Agent approvals" />
          <OperationalPanelBody>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={typeStyle("body.medium")}>Approve all</p>
                <p
                  className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
                >
                  Run agent actions without asking for approval, including sends
                  and deletions. Applies to all operators across every channel.
                  Existing pending approvals still need a decision.
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
      )}
    </AppShell>
  );
}
