"use client";

import { LockKeyhole, MessageSquare } from "lucide-react";
import { ChatChannelIcon, chatChannelLabel } from "@/components/chat/channel-icon";
import {
  ActionSurface,
  ActionSurfaceLink,
} from "@/components/ui/action-surface";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  getThreadDisplayLabel,
  type ThreadDisplayLike,
} from "@/lib/thread-display";
import { typeStyle } from "@/lib/typography";

function isPrivateSlackThread(thread: ThreadDisplayLike) {
  return (
    thread.originChannel === "slack" && thread.visibility === "user_private"
  );
}

function channelLabel(thread: ThreadDisplayLike) {
  return isPrivateSlackThread(thread)
    ? "Private Slack"
    : chatChannelLabel(thread.originChannel, "Chat");
}

/** One navigation row in the active or archived thread lists. */
export function ThreadListRow({ thread }: { thread: ThreadDisplayLike }) {
  return (
    <ActionSurface className="group flex items-center">
      <ActionSurfaceLink
        href={`/agent/thread/${thread._id}`}
        className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent px-4 py-3 hover:bg-transparent"
      >
        <div className="shrink-0 text-muted-foreground/30">
          <ChatChannelIcon
            channel={thread.originChannel}
            fallback={MessageSquare}
            className="h-4 w-4"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className={`truncate text-foreground ${typeStyle("body.medium")}`}
            >
              {getThreadDisplayLabel(thread)}
            </p>
            {isPrivateSlackThread(thread) ? (
              <LockKeyhole
                className="h-3 w-3 shrink-0 text-muted-foreground/35"
                aria-label="Private Slack thread"
              />
            ) : null}
          </div>
          <p
            className={`text-muted-foreground/40 ${typeStyle("caption.default")}`}
          >
            {formatDisplayDateTime(
              thread.lastMessageAt ?? thread._creationTime,
            )}{" "}
            · {channelLabel(thread)}
          </p>
        </div>
      </ActionSurfaceLink>
    </ActionSurface>
  );
}
