"use client";

import { useState } from "react";
import { FileSearch, PanelRightOpen } from "lucide-react";
import { PolicyPreview } from "@/components/preview/policy-preview";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { PillButton } from "@/components/ui/pill-button";
import { usePdf, type PdfHighlightBox } from "@/components/pdf-context";
import type { Id } from "@/convex/_generated/dataModel";
import {
  policyContextSummary,
  relatedRecords,
  usePageContextLayer,
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
  policyId,
  onClose,
}: {
  clientOrgId: string;
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
    related: relatedRecords([{ kind: "organization", id: clientOrgId }]),
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
              className="w-full sm:w-auto"
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
            className="w-full sm:w-auto"
          >
            <PanelRightOpen className="size-3.5" />
            Open full workspace
          </PillButton>
        </>
      }
    >
      <PolicyPreview id={policyId} onFooterActions={setPreviewActions} />
    </SettingsDrawer>
  );
}
