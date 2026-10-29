"use client";

import { useFollowedOpen } from "@/hooks/use-followed-state";
import { FileInput, MoreHorizontal, NotebookPen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import type { PdfDocumentSource } from "@/components/pdf-context";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import { AttachmentSubmissionDialog } from "./attachment-submission-dialog";
import { SubmissionDefaultDialog } from "./provider-submission-defaults";

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
        className="inline-flex items-center gap-0.5"
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenChange(true);
        }}
      >
        <ChatAttachmentChip
          attachment={{ filename: file.name, contentType: file.contentType }}
          url={file.url}
          pdfSource={emailAttachmentPdfSource(source.messageId, file)}
        />
        <PillButton
          variant="icon"
          size="compact"
          iconOnly
          label={`Use ${file.name} as default application form`}
          onClick={() => onOpenChange(true)}
        >
          <FileInput />
        </PillButton>
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

export function EmailSubmissionNotes({
  source,
  brokerOrgId,
  brokerName,
}: Provider & { source: Source }) {
  const { open, onOpenChange: setOpen } = useFollowedOpen(
    `email:${source.messageId}:submission-notes`,
  );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <PillButton
              variant="icon"
              size="compact"
              iconOnly
              label="Message options"
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setOpen(true)}>
            <NotebookPen /> Save submission questions or notes…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {open ? (
        <SubmissionDefaultDialog
          open={open}
          onOpenChange={setOpen}
          source={source}
          defaultBrokerOrgId={brokerOrgId}
          defaultBrokerName={brokerName}
        />
      ) : null}
    </>
  );
}
