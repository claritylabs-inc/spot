"use client";

/**
 * Entity preview panel content rendered inside the app shell panel layout.
 * Content components are in components/preview/.
 */

import { useState } from "react";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf, type PdfHighlightBox } from "@/components/pdf-context";
import { PolicyPreview } from "./preview/policy-preview";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";

type HighlightBox = PdfHighlightBox;

export function EntityPreviewPanel() {
  const { preview, closePreview } = useEntityPreview();
  const [footerActions, setFooterActions] = useState<{
    fileUrl?: string;
    policyId: string;
    page?: number;
    highlightBoxes?: HighlightBox[];
  } | null>(null);
  const currentFooterActions =
    preview && footerActions?.policyId === preview.id ? footerActions : null;

  if (!preview) return null;

  return (
    <SettingsDrawer
      open
      title="Policy preview"
      onOpenChange={(open) => {
        if (!open) closePreview();
      }}
      footer={
        currentFooterActions ? (
          <PolicyPreviewButtons
            fileUrl={currentFooterActions.fileUrl}
            policyId={currentFooterActions.policyId}
            page={currentFooterActions.page}
            highlightBoxes={currentFooterActions.highlightBoxes}
          />
        ) : undefined
      }
    >
      <PolicyPreview
        id={preview.id}
        page={preview.page}
        citedSections={preview.citedSections}
        citedCoverageNames={preview.citedCoverageNames}
        citedSourceSpanIds={preview.citedSourceSpanIds}
        onFooterActions={setFooterActions}
      />
    </SettingsDrawer>
  );
}

// Separate component to handle the PDF context that requires being inside the provider
function PolicyPreviewButtons({
  fileUrl,
  policyId,
  page,
  highlightBoxes,
}: {
  fileUrl?: string;
  policyId: string;
  page?: number;
  highlightBoxes?: HighlightBox[];
}) {
  const { openWithUrl } = usePdf();

  return (
    <>
      {fileUrl && (
        <PillButton
          size="compact"
          variant="secondary"
          onClick={() => openWithUrl(fileUrl, page, highlightBoxes)}
        >
          View PDF
        </PillButton>
      )}
      <PillButton
        href={`/policies/${policyId}`}
        size="compact"
        variant="secondary"
      >
        Details
      </PillButton>
    </>
  );
}
