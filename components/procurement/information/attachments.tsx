"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import { type Panel } from "./shared";

export function InformationAttachments({
  ids,
  files,
}: {
  ids: readonly string[];
  files: Panel["files"];
}) {
  if (!ids.length) return null;
  return (
    <div
      className="flex flex-wrap gap-2 px-3 pb-2 pt-1"
      aria-label="Supporting documents"
    >
      {ids.map((id) => {
        const file = files.find((file) => file.id === id);
        return file ? <InformationAttachment key={id} file={file} /> : null;
      })}
    </div>
  );
}

function InformationAttachment({ file }: { file: Panel["files"][number] }) {
  const url = useQuery(api.clientFiles.getUrl, {
    clientFileId: file.clientFileId,
  });
  return (
    <ChatAttachmentChip
      attachment={{ filename: file.name, contentType: file.contentType }}
      url={url}
      isLoading={url === undefined}
      className="min-h-9 border border-border px-3"
    />
  );
}
