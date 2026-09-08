"use client";

import { useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";

export function FileDownloadButton({
  href,
  fileName,
  children,
  iconOnly = false,
}: {
  href: string;
  fileName: string;
  children?: ReactNode;
  iconOnly?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  return (
    <PillButton
      href={href}
      download={fileName}
      variant={iconOnly ? "icon" : "secondary"}
      size={iconOnly ? "compact" : undefined}
      label={iconOnly ? "Download" : undefined}
      disabled={downloading}
      onClick={async (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        setDownloading(true);
        const toastId = toast.loading("Downloading file…");
        try {
          const response = await fetch(href);
          if (!response.ok) throw new Error("Download failed");
          const blobUrl = URL.createObjectURL(await response.blob());
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = fileName;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
          toast.dismiss(toastId);
        } catch {
          toast.error("Could not download the file. Try again.", {
            id: toastId,
          });
        } finally {
          setDownloading(false);
        }
      }}
    >
      <Download className="size-3.5" />
      {!iconOnly && (children ?? "Download")}
    </PillButton>
  );
}
