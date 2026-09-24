"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SettingsToggleRow } from "@/components/settings/settings-toggle-row";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";

type SettingsDraft = {
  renewalReissueEnabled: boolean;
};

type SettingsResult = SettingsDraft & {
  row:
    | (Partial<SettingsDraft> & { _id: Id<"certificateWorkflowSettings"> })
    | null;
};

const DEFAULT_SETTINGS: SettingsDraft = {
  renewalReissueEnabled: true,
};

function toDraft(value?: Partial<SettingsDraft> | null): SettingsDraft {
  return {
    renewalReissueEnabled:
      value?.renewalReissueEnabled ?? DEFAULT_SETTINGS.renewalReissueEnabled,
  };
}

export function CertificateWorkflowSection() {
  const currentOrg = useCurrentOrg();
  const result = useQuery(
    api.certificateWorkflowSettings.getEffectiveForCurrentOrg,
    {},
  ) as SettingsResult | undefined;

  if (!result) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <CertificateWorkflowEditor
      key={currentOrg?.orgId ?? "none"}
      result={result}
    />
  );
}

function CertificateWorkflowEditor({ result }: { result: SettingsResult }) {
  const currentOrg = useCurrentOrg();
  const isClient = currentOrg?.orgType === "client";
  const isAdmin = currentOrg?.role === "admin";
  const updateClientOverride = useMutation(
    api.certificateWorkflowSettings.updateClientOverride,
  );
  const initialDraft = toDraft(result.row ?? result);
  const [draft, setDraft] = useState<SettingsDraft>(initialDraft);
  const editable = isAdmin && isClient;

  const autoSave = useLocalFirstAutoSave({
    mutationName: "settings.certificates.updateWorkflow",
    args: draft,
    enabled: editable,
    flush: updateClientOverride,
    errorMessage: "Certificate settings could not be saved.",
  });

  return (
    <div className="space-y-4">
      {editable ? <AutoSaveStatus status={autoSave.status} /> : null}
      <OperationalPanel>
        <OperationalPanelBody className="divide-y divide-border px-5 py-2">
          <SettingsToggleRow
            title="Update certificates on renewal"
            description="When a renewed policy is uploaded, Spot reviews active certificates and prepares updated versions."
            checked={draft.renewalReissueEnabled}
            disabled={!editable}
            onCheckedChange={(renewalReissueEnabled) =>
              setDraft({ ...draft, renewalReissueEnabled })
            }
          />
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
