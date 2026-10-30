"use client";

import { useFollowedOpen } from "@/hooks/use-followed-state";
import { FileInput } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@claritylabs-inc/ui/components/popover";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import type { PdfDocumentSource } from "@/components/pdf-context";
import type { Id } from "@/convex/_generated/dataModel";
import { AttachmentSubmissionForm } from "./attachment-submission-form";

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

function emailAttachmentPdfSource(
  messageId: Id<"teamEmailMessages">,
  file: {
    name: string;
    clientFileId?: Id<"clientFiles">;
    storageId?: Id<"_storage">;
  },
): PdfDocumentSource | undefined {
  if (file.clientFileId)
    return {
      kind: "clientFile",
      clientFileId: file.clientFileId,
      filename: file.name,
    };
  if (file.storageId)
    return {
      kind: "teamEmailAttachment",
      messageId,
      storageId: file.storageId,
      filename: file.name,
    };
  return undefined;
}

/** The save button and right-click both open the default application form popover. */
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
    <Popover open={open} onOpenChange={onOpenChange}>
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
          pdfSource={emailAttachmentPdfSource(source.messageId, file)}
          action={{
            label: `Use ${file.name} as default application form`,
            icon: FileInput,
            renderButton: (button) => <PopoverTrigger render={button} />,
          }}
        />
      </div>
      <PopoverContent align="start" className="w-80 p-3">
        <AttachmentSubmissionForm
          onOpenChange={onOpenChange}
          source={source}
          file={file}
          defaultBrokerOrgId={brokerOrgId}
          defaultBrokerName={brokerName}
          defaultCoverageCodes={coverageCodes}
        />
      </PopoverContent>
    </Popover>
  );
}
