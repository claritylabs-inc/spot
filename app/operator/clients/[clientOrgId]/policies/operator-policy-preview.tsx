"use client";

import { useState } from "react";
import { FileSearch, PanelRightOpen } from "lucide-react";
import { PolicyPreview } from "@/components/preview/policy-preview";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { PillButton } from "@/components/ui/pill-button";
import { usePdf, type PdfHighlightBox } from "@/components/pdf-context";
import type { Id } from "@/convex/_generated/dataModel";
import { usePageContextLayer } from "@/hooks/use-page-context";
import {
  policyContextSummary,
  relatedRecords,
} from "@/lib/policy-page-context";
import { useCachedPolicySummary } from "@/lib/sync/spot-cached-queries";

type PreviewActions = {
  fileUrl?: string;
  policyId: string;
  page?: number;
  highlightBoxes?: PdfHighlightBox[];
};

export function OperatorPolicyPreview({
  clientOrgId,
  clientLabel,
  policyId,
  onClose,
}: {
  clientOrgId: string;
  /** Labels the client in the agent page context. */
  clientLabel?: string;
  policyId: string;
  onClose: () => void;
}) {
  const [previewActions, setPreviewActions] = useState<PreviewActions | null>(
    null,
  );
  const { openWithUrl } = usePdf();
  // The AI panel works on the previewed policy while the drawer is open.
  const policy = useCachedPolicySummary(policyId as Id<"policies">);
  usePageContextLayer({
    pageType: "policy",
    entityId: policyId,
    summary: policyContextSummary(policy ?? {}, ["preview drawer"]),
    related: relatedRecords([
      { kind: "organization", id: clientOrgId, label: clientLabel },
    ]),
  });
  const activeActions =
    previewActions?.policyId === policyId ? previewActions : null;

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Policy preview"
      footer={
        <>
          {activeActions?.fileUrl ? (
            <PillButton
              type="button"
              size="compact"
              variant="secondary"
              onClick={() =>
                openWithUrl(
                  activeActions.fileUrl!,
                  activeActions.page,
                  activeActions.highlightBoxes,
                )
              }
            >
              <FileSearch className="size-3.5" />
              View PDF
            </PillButton>
          ) : null}
          <PillButton
            href={`/operator/clients/${clientOrgId}/policies/${policyId}`}
            size="compact"
          >
            <PanelRightOpen className="size-3.5" />
            Open policy
          </PillButton>
        </>
      }
    >
      <PolicyPreview id={policyId} onFooterActions={setPreviewActions} />
    </SettingsDrawer>
  );
}
