"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2 } from "lucide-react";
import { SettingsToggleRow } from "@/components/settings/settings-toggle-row";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import {
  patchCachedViewerOrg,
  useCachedViewerOrg,
} from "@/lib/sync/spot-cached-queries";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { typeStyle } from "@/lib/typography";

type AgentSettingsArgs = {
  chatEmailNotifications: boolean;
  bccRequesterOnAgentEmails: boolean;
  emailSendDelay: number;
};

export function AgentBehaviorSection() {
  const viewerOrg = useCachedViewerOrg();
  const updateOrg = useMutation(api.orgs.updateOrg);

  const org = viewerOrg?.org as
    | {
        chatEmailNotifications?: boolean;
        bccRequesterOnAgentEmails?: boolean;
        emailSendDelay?: number;
      }
    | undefined;

  const [chatEmailNotifications, setChatEmailNotifications] = useState(false);
  const [bccRequesterOnAgentEmails, setBccRequesterOnAgentEmails] =
    useState(true);
  const [emailSendDelay, setEmailSendDelay] = useState<number>(5);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const hydratedRef = useRef(false);

  useEffect(() => {
    if (org && !hydratedRef.current) {
      setChatEmailNotifications(org.chatEmailNotifications ?? false);
      setBccRequesterOnAgentEmails(org.bccRequesterOnAgentEmails ?? true);
      setEmailSendDelay(org.emailSendDelay ?? 5);
      hydratedRef.current = true;
      setSettingsHydrated(true);
    }
  }, [org]);

  const settingsValueKey = useMemo(
    () =>
      JSON.stringify({
        chatEmailNotifications,
        bccRequesterOnAgentEmails,
        emailSendDelay,
      }),
    [bccRequesterOnAgentEmails, chatEmailNotifications, emailSendDelay],
  );

  const saveAgentSettings = useCallback(
    async (args: AgentSettingsArgs) => {
      await updateOrg(args);
    },
    [updateOrg],
  );

  const settingsAutoSave = useLocalFirstAutoSave({
    mutationName: "settings.agent.updateOrg",
    args: {
      chatEmailNotifications,
      bccRequesterOnAgentEmails,
      emailSendDelay,
    },
    valueKey: settingsValueKey,
    enabled: settingsHydrated,
    applyLocal: (store, args) => patchCachedViewerOrg(store, args),
    flush: saveAgentSettings,
    errorMessage: "Agent settings could not be saved.",
  });

  if (viewerOrg === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const delayOptions = [0, 3, 5, 10, 15];
  return (
    <div className="space-y-4">
      <AutoSaveStatus status={settingsAutoSave.status} />

      <OperationalPanel>
        <OperationalPanelHeader title="Email behavior" />
        <OperationalPanelBody className="divide-y divide-border px-5 py-2">
          <SettingsToggleRow
            title="Email notifications for chat responses"
            description="Send the requesting team member an email copy when the agent replies in chat."
            checked={chatEmailNotifications}
            onCheckedChange={setChatEmailNotifications}
          />
          <SettingsToggleRow
            title="BCC requester"
            description="Blind copy the team member who asked the agent to send an email."
            checked={bccRequesterOnAgentEmails}
            onCheckedChange={setBccRequesterOnAgentEmails}
          />
          <div className="py-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Send delay
                </p>
                <p className={`mt-0.5 max-w-md text-muted-foreground/60 ${typeStyle("caption.default")}`}>
                  Undo window before outgoing emails are sent.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:ml-4">
                {delayOptions.map((value) => {
                  const selected = emailSendDelay === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEmailSendDelay(value)}
                      className={`rounded-lg border px-3 py-1.5 transition-colors ${typeStyle("control.button")} ${
                        selected
                          ? "border-border-focus bg-foreground/3 text-foreground"
                          : "border-input bg-popover text-muted-foreground hover:border-border-hover"
                      }`}
                    >
                      {value === 0 ? "Off" : `${value}s`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
