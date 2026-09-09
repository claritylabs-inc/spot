"use client";

import { LockKeyhole, Mail, MessageCircle, MessageSquare } from "lucide-react";
import { SiSlack } from "react-icons/si";
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

function ChannelIcon({ thread }: { thread: ThreadDisplayLike }) {
  if (thread.originChannel === "imessage")
    return <MessageCircle className="h-4 w-4" />;
  if (thread.originChannel === "slack") return <SiSlack className="h-4 w-4" />;
  if (thread.originChannel === "email") return <Mail className="h-4 w-4" />;
  return <MessageSquare className="h-4 w-4" />;
}

function channelLabel(thread: ThreadDisplayLike) {
  if (thread.originChannel === "imessage") return "iMessage";
  if (thread.originChannel === "slack")
    return isPrivateSlackThread(thread) ? "Private Slack" : "Slack";
  if (thread.originChannel === "email") return "Email";
  return "Chat";
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
          <ChannelIcon thread={thread} />
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
