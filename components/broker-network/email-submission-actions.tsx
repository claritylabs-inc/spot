"use client";

import { useFollowedOpen } from "@/hooks/use-followed-state";
import { FileInput } from "lucide-react";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import type { Id } from "@/convex/_generated/dataModel";
import { AttachmentSubmissionDialog } from "./attachment-submission-dialog";

type Source = {
  threadId: Id<"teamEmailThreads">;
  messageId: Id<"teamEmailMessages">;
  text?: string;
};
type Provider = {
  brokerOrgId?: Id<"organizations">;
  brokerName?: string;
  coverageCodes?: string[];
};

/** The save button and right-click both open the default application form dialog. */
export function EmailSubmissionAttachment({
  file,
  source,
  brokerOrgId,
  brokerName,
  coverageCodes,
}: Provider & {
  source: Source;
  file: {
    name: string;
    contentType: string;
    url: string;
    clientFileId?: Id<"clientFiles">;
    storageId?: Id<"_storage">;
  };
}) {
  const { open, onOpenChange } = useFollowedOpen(
    `email:${source.messageId}:attachment:${file.clientFileId ?? file.storageId}:form`,
  );
  return (
    <>
      <div
        className="inline-flex"
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenChange(true);
        }}
      >
        <ChatAttachmentChip
          attachment={{ filename: file.name, contentType: file.contentType }}
          url={file.url}
          action={{
            label: `Use ${file.name} as default application form`,
            icon: FileInput,
            onClick: () => onOpenChange(true),
          }}
        />
      </div>
      {open ? (
        <AttachmentSubmissionDialog
          open={open}
          onOpenChange={onOpenChange}
          source={source}
          file={file}
          defaultBrokerOrgId={brokerOrgId}
          defaultBrokerName={brokerName}
          defaultCoverageCodes={coverageCodes}
        />
      ) : null}
    </>
  );
}
