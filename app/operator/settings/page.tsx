"use client";

import { useSearchParams } from "next/navigation";
import { useMcpSettings } from "@/components/operator/mcp-settings";
import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EmailPromptSettings } from "@/components/settings/email-prompt-settings";
import {
  OperatorPageContextRegistration,
  operatorContextSummary,
} from "@/components/operator-agent/operator-page-context";
import { OperatorNotificationRoutes } from "@/components/settings/operator-notification-routes";
import { useOperatorSkillSettings } from "@/components/settings/operator-skill-settings";
import { McpEventSubscriptions } from "@/components/settings/mcp-event-subscriptions";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useOperatorInvite } from "@/components/operator/operator-invite-panel";

const SECTION_SUMMARIES = {
  general: "General: agent approvals, MCP servers and event subscriptions",
  team: "Team: operators and invitations",
  notifications: "Notification routes",
  email: "Email prompts: the operator's email writing rules",
  skills: "Skills: the operator's personal and shared skills",
};

export default function OperatorSettingsPage() {
  const current = useCachedOperatorCurrent();
  const invitations = useOperatorInvite(!current || Boolean(current.activeImpersonation));
  const sectionParam = useSearchParams().get("section");
  const section =
    sectionParam === "team" ||
    sectionParam === "notifications" ||
    sectionParam === "email" ||
    sectionParam === "skills"
      ? sectionParam
      : "general";
  const settings = useCachedQuery(
    "operator.getAgentSettings",
    api.operator.getAgentSettings,
    {},
  );
  const setApproveAll = useMutation(api.operator.setApproveAll);
  const [saving, setSaving] = useState(false);
  const mcp = useMcpSettings(!current || Boolean(current.activeImpersonation));
  const skills = useOperatorSkillSettings(
    !current || Boolean(current.activeImpersonation),
    section === "skills",
  );
  const pageSummary = operatorContextSummary(
    "Operator settings",
    SECTION_SUMMARIES[section],
    section === "general" &&
      settings &&
      `approve all is ${settings.approveAll ? "on" : "off"}`,
    section === "team" && invitations.drawer && "invite operator drawer open",
  );

  return (
    <AppShell
      rightPanel={
        section === "team"
          ? invitations.drawer
          : section === "skills"
            ? skills.drawer
            : mcp.drawer
      }
    >
      <OperatorPageContextRegistration
        context={{ pageType: "operator_settings", summary: pageSummary }}
      />
      {section === "team" ? (
        invitations.panel
      ) : section === "email" ? (
        current ? (
          <EmailPromptSettings disabled={Boolean(current.activeImpersonation)} />
        ) : (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )
      ) : section === "skills" ? (
        skills.panel
      ) : section === "notifications" ? (
        current ? (
          <OperatorNotificationRoutes
            disabled={Boolean(current.activeImpersonation)}
          />
        ) : (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )
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
          <McpEventSubscriptions />
        </div>
      )}
    </AppShell>
  );
}
