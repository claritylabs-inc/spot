"use client";

import { useState } from "react";
import JSZip from "jszip";
import { Download, Paperclip } from "lucide-react";
import { useChatAction } from "./use-chat-action";
import { PillButton } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { MessageMetaTag } from "@claritylabs-inc/ui/components/message-meta-tag";
import {
  ChatAttachmentChip,
  ChatAttachmentList,
  type ChatAttachmentChipProps,
} from "./attachment-chip";

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

/** A file toggle and expanded downloads, placed by the surface's message layout. */
export function useChatAttachments(
  attachments: ChatAttachmentChipProps["attachment"][],
  threadId: Id<"threads">,
  gridClassName = "basis-full",
) {
  const [expanded, setExpanded] = useState(false);
  const { pending: preparing, run } = useChatAction();
  const fileIds = attachments.flatMap((file) => (file.fileId ? [file.fileId] : []));
  const urls = useCachedQuery(
    "threads.getAttachmentUrls.message",
    api.threads.getAttachmentUrls,
    expanded && fileIds.length > 1 ? { threadId, fileIds } : "skip",
  );
  const files = urls?.map((entry) => ({
    url: entry.url,
    filename: attachments.find((file) => file.fileId === entry.fileId)?.filename ?? "attachment",
  }));
  return {
    trigger:
      attachments.length === 0 ? null : attachments.length === 1 ? (
        <ChatAttachmentChip attachment={attachments[0]} threadId={threadId} className="w-fit" />
      ) : (
        <MessageMetaTag
          icon={<Paperclip />}
          label="Files"
          count={attachments.length}
          isActive={expanded}
          onClick={() => setExpanded(!expanded)}
        />
      ),
    grid:
      attachments.length > 1 && expanded ? (
        <div className={cn("flex min-w-0 flex-wrap items-start gap-1.5", gridClassName)}>
          <ChatAttachmentList attachments={attachments} threadId={threadId} className="contents" />
          <PillButton
            type="button"
            variant="ghost"
            size="compact"
            disabled={!files?.length || preparing}
            onClick={() => {
              if (files?.length)
                void run(() => downloadAttachmentsZip(files), "Failed to download attachments");
            }}
          >
            <Download className="h-3.5 w-3.5" />
            {preparing ? "Preparing..." : "Download all"}
          </PillButton>
        </div>
      ) : null,
  };
}
