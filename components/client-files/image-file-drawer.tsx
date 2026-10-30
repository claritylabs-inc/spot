"use client";

import { FileDownloadButton } from "@claritylabs-inc/ui/components/file-download-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { typeStyle } from "@/lib/typography";

/** An image file in a side panel, with its download. */
export function ImageFileDrawer({
  file,
  onClose,
}: {
  file: { name: string; url?: string | null };
  onClose: () => void;
}) {
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={file.name}
      footer={
        file.url ? (
          <FileDownloadButton href={file.url} fileName={file.name} />
        ) : null
      }
    >
      {file.url ? (
        <div className="relative flex min-h-80 items-center justify-center overflow-hidden rounded-lg border border-border bg-foreground/[0.02]">
          {/* Convex storage URLs are dynamic and intentionally bypass Next image optimization. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.url}
            alt={file.name}
            className="h-auto max-h-[calc(100vh-11rem)] w-auto max-w-full object-contain"
          />
        </div>
      ) : (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This image is no longer available.
        </p>
      )}
    </SettingsDrawer>
  );
}
