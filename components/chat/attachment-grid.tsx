"use client";

import { useState, type ReactNode } from "react";
import JSZip from "jszip";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";

export type DownloadableAttachment = { url: string; filename: string };

export function uniqueZipFilename(filename: string, usedNames: Set<string>) {
  const trimmed = filename.trim() || "attachment";
  if (!usedNames.has(trimmed)) {
    usedNames.add(trimmed);
    return trimmed;
  }

  const dotIndex = trimmed.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const basename = hasExtension ? trimmed.slice(0, dotIndex) : trimmed;
  const extension = hasExtension ? trimmed.slice(dotIndex) : "";
  let index = 2;
  let candidate = `${basename} (${index})${extension}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${basename} (${index})${extension}`;
  }
  usedNames.add(candidate);
  return candidate;
}

async function downloadAttachmentsZip(files: DownloadableAttachment[]) {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const file of files) {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error(`Failed to download ${file.filename}`);
    zip.file(uniqueZipFilename(file.filename, usedNames), await response.blob());
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "thread-attachments.zip";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/** Expanded attachment chips followed by a zip download of every file. */
export function ChatAttachmentGrid({
  files,
  className,
  children,
}: {
  files: DownloadableAttachment[] | undefined;
  className?: string;
  children: ReactNode;
}) {
  const [preparing, setPreparing] = useState(false);
  return (
    <div className={cn("flex min-w-0 flex-wrap items-start gap-1.5", className)}>
      {children}
      <PillButton
        type="button"
        variant="ghost"
        size="compact"
        disabled={!files?.length || preparing}
        onClick={async () => {
          if (!files?.length) return;
          setPreparing(true);
          try {
            await downloadAttachmentsZip(files);
          } catch {
            toast.error("Failed to download attachments");
          } finally {
            setPreparing(false);
          }
        }}
      >
        <Download className="h-3.5 w-3.5" />
        {preparing ? "Preparing..." : "Download all"}
      </PillButton>
    </div>
  );
}
