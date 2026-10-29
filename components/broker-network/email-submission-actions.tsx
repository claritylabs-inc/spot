"use client";

import { useRef } from "react";

import { useFollowedOpen } from "@/hooks/use-followed-state";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import { PillButton } from "@/components/ui/pill-button";
import type { Id } from "@/convex/_generated/dataModel";
import { AttachmentSubmissionMenu } from "./attachment-submission-menu";

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
