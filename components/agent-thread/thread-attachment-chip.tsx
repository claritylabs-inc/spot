"use client";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ChatAttachmentChip,
  type ChatAttachmentChipProps,
} from "@/components/chat/attachment-chip";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

export function ThreadAttachmentChip({
  threadId,
  ...props
}: Omit<ChatAttachmentChipProps, "url"> & {
  attachment: { fileId?: Id<"_storage"> };
  threadId?: Id<"threads">;
}) {
  const url = useCachedQuery(
    "threads.getAttachmentUrl",
    api.threads.getAttachmentUrl,
    threadId && props.attachment.fileId
      ? { threadId, fileId: props.attachment.fileId }
      : "skip",
  );
  return <ChatAttachmentChip {...props} url={url} />;
}
