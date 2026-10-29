"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import { usePdf } from "@/components/pdf-context";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import {
  PDF_DOCUMENT_PAGE_TYPE,
  pdfFormSourceId,
} from "@/convex/lib/pdfFormSource";
import { usePageContext } from "@/hooks/use-page-context";
import { usePdfFormEditing } from "@/components/ui/pdf-form-editing";

const EASE = [0.2, 0, 0, 1] as const;
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
  const reduceMotion = useReducedMotion();
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
  const formEditing = usePdfFormEditing({
    source,
    onSaved: (saved) =>
      openWithUrl(saved.url, currentPage, undefined, {
        kind: "operatorAttachment",
        fileId: saved.fileId,
        filename: saved.filename,
      }),
  });

  if (!fileUrl || !isPdfOpen) return null;

  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden">
      <motion.div
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.1, ease: EASE }}
        className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col border-l border-border bg-background"
      >
        <PdfViewer
          fileUrl={fileUrl}
          currentPage={currentPage}
          highlightedPage={highlightedPage}
          highlightBoxes={highlightBoxes}
          onPageChange={navigateToPage}
          onDocumentLoad={setNumPages}
          onClose={closePdf}
          {...(formEditing.active
            ? {
                toolbarActions: formEditing.toolbarActions,
                ...formEditing.viewerProps,
              }
            : {})}
        />
      </motion.div>
    </div>
  );
}
