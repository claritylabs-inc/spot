"use client";

import { useSearchParams } from "next/navigation";
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
} from "@claritylabs-inc/ui/components/operational-panel";
import { api } from "@/convex/_generated/api";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useOperatorInvite } from "@/components/operator/operator-invite-panel";

export default function OperatorSettingsPage() {
  const current = useCachedOperatorCurrent();
  const invitations = useOperatorInvite(!current || Boolean(current.activeImpersonation));
  const sectionParam = useSearchParams().get("section");
  const section = sectionParam === "team" ? sectionParam : "general";
  const settings = useQuery(api.operator.getAgentSettings);
  const setApproveAll = useMutation(api.operator.setApproveAll);
  const [saving, setSaving] = useState(false);
  const mcp = useMcpSettings(!current || Boolean(current.activeImpersonation));

  return (
    <AppShell
      rightPanel={section === "team" ? invitations.drawer : mcp.drawer}
    >
      {section === "team" ? (
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
