"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ClientFilesWorkspace } from "@/components/client-files/client-files-workspace";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { useCachedViewerOrg } from "@/lib/sync/spot-cached-queries";

export default function FilesPage() {
  const viewerOrg = useCachedViewerOrg();
  const [rightPanel, setRightPanel] = useState<ReactNode>(null);
  const clientOrg =
    viewerOrg?.org?.type === "client" ? viewerOrg.org : undefined;

  return (
    <AppShell rightPanel={rightPanel}>
      {viewerOrg === undefined ? (
        <OperationalPanel as="div" className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </OperationalPanel>
      ) : !clientOrg ? (
        <OperationalPanel>
          <OperationalPanelHeader title="Client files are not available" />
          <OperationalPanelBody className="text-muted-foreground">
            This dropbox is available to client organizations.
          </OperationalPanelBody>
        </OperationalPanel>
      ) : (
        <ClientFilesWorkspace
          clientOrgId={clientOrg._id}
          readOnly
          onRightPanel={setRightPanel}
        />
      )}
    </AppShell>
  );
}
