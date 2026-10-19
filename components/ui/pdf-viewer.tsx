"use client";

import { PdfViewer as SharedPdfViewer } from "@claritylabs-inc/ui/components/pdf-viewer";
import type { ComponentProps } from "react";

export function PdfViewer(props: ComponentProps<typeof SharedPdfViewer>) {
  return (
    <div className="ph-no-capture flex min-h-0 min-w-0 flex-1 flex-col">
      <SharedPdfViewer {...props} />
    </div>
  );
}
