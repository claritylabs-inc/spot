"use client";

import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { SettingsActionsContext } from "@/components/settings/settings-actions-context";
import { TeamSection } from "@/components/settings/team-section";

export default function BrokerTeamPage() {
  const [actions, setActions] = useState<React.ReactNode>(null);
  const [rightPanel, setRightPanel] = useState<React.ReactNode>(null);

  return (
    <SettingsActionsContext.Provider value={{ setActions, setRightPanel }}>
      <AppShell
        disablePersistentChat
        disableCommandPalette
        actions={actions}
        rightPanel={rightPanel}
      >
        <TeamSection />
      </AppShell>
    </SettingsActionsContext.Provider>
  );
}
