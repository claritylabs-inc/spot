"use client";

import { useRef } from "react";

import { useFollowedOpen } from "@/hooks/use-followed-state";
import { MoreHorizontal, NotebookPen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import { AttachmentSubmissionMenu } from "./attachment-submission-menu";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const { open: menuOpen, onOpenChange: setMenuOpen } = useFollowedOpen(
    `email:${source.messageId}:attachment:${file.clientFileId ?? file.storageId}:menu`,
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
          <DropdownMenuContent ref={menuRef} align="start">
            {menuOpen ? (
              <AttachmentSubmissionMenu
                parentMenuRef={menuRef}
                source={source}
                file={file}
                defaultBrokerOrgId={brokerOrgId}
                defaultBrokerName={brokerName}
                onSaved={() => setMenuOpen(false)}
              />
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
