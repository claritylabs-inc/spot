"use client";

import { useEffect } from "react";
import { usePdf } from "@/components/pdf-context";
import { FileDownloadButton } from "@claritylabs-inc/ui/components/file-download-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import {
  PDF_DOCUMENT_PAGE_TYPE,
  pdfFormSourceId,
} from "@/convex/lib/pdfFormSource";
import { usePageContext } from "@/hooks/use-page-context";
import { usePdfFormActions } from "@/components/ui/pdf-form-actions";

export function PdfPanel() {
  const {
    isPdfOpen,
    closePdf,
    fileUrl,
    currentPage,
    navigateToPage,
    setNumPages,
    highlightedPage,
    highlightBoxes,
    source,
    openWithUrl,
  } = usePdf();
  // The agent panel works on the open PDF (e.g. filling a form) while it is shown.
  const { pushPageContext } = usePageContext();
  const open = Boolean(fileUrl && isPdfOpen);
  const sourceId = source ? pdfFormSourceId(source) : null;
  const filename = source?.filename;
  useEffect(() => {
    if (!open || !sourceId) return;
    return pushPageContext({
      pageType: PDF_DOCUMENT_PAGE_TYPE,
      entityId: sourceId,
      summary: `PDF: ${filename?.slice(0, 200) ?? "document"}`,
    });
  }, [filename, open, pushPageContext, sourceId]);
  const formActions = usePdfFormActions({
    source,
    onOpen: (document) =>
      openWithUrl(document.url, currentPage, undefined, document.source),
  });

  if (!fileUrl || !isPdfOpen) return null;

  return (
    <SettingsDrawer
      open
      title={filename ?? "Document"}
      body="fill"
      onOpenChange={(next) => {
        if (!next) closePdf();
      }}
      footer={formActions.active ? formActions.footer : undefined}
    >
      <PdfViewer
        fileUrl={fileUrl}
        currentPage={currentPage}
        highlightedPage={highlightedPage}
        highlightBoxes={highlightBoxes}
        onPageChange={navigateToPage}
        onDocumentLoad={setNumPages}
        {...(formActions.active ? formActions.viewerProps : {})}
        toolbarActions={
          <>
            {formActions.active ? formActions.toolbarActions : null}
            <FileDownloadButton
              href={fileUrl}
              fileName={filename ?? "document.pdf"}
              iconOnly
            />
          </>
        }
      />
    </SettingsDrawer>
  );
}
