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
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import { SubmissionDefaultDialog } from "./provider-submission-defaults";

type Source = {
  threadId: Id<"teamEmailThreads">;
  messageId: Id<"teamEmailMessages">;
  text?: string;
};
type Provider = { brokerOrgId?: Id<"organizations">; brokerName?: string };

/** The same menu supports right-click, keyboard and the visible more button. */
export function EmailSubmissionAttachment({
  file,
  source,
  brokerOrgId,
  brokerName,
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
  const { open: menuOpen, onOpenChange: setMenuOpen } = useFollowedOpen(
    `email:${source.messageId}:attachment:${file.clientFileId ?? file.storageId}:menu`,
  );
  const { open, onOpenChange: setOpen } = useFollowedOpen(
    `email:${source.messageId}:attachment:${file.clientFileId ?? file.storageId}:submission`,
  );
  return (
    <>
      <div
        className="inline-flex items-center gap-0.5"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen(true);
        }}
      >
        <ChatAttachmentChip
          attachment={{ filename: file.name, contentType: file.contentType }}
          url={file.url}
        />
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            render={
              <PillButton
                variant="icon"
                size="compact"
                iconOnly
                label={`Options for ${file.name}`}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setOpen(true)}>
              <FileInput /> Use as default application form…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open ? (
        <SubmissionDefaultDialog
          open={open}
          onOpenChange={setOpen}
          source={{
            ...source,
            attachment: {
              name: file.name,
              clientFileId: file.clientFileId,
              storageId: file.storageId,
            },
          }}
          defaultBrokerOrgId={brokerOrgId}
          defaultBrokerName={brokerName}
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
