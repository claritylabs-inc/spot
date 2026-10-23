"use client";

import { usePathname } from "next/navigation";
import { useAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { PresenceAvatars } from "@/components/app-top-bar";
import { ChatAvatar } from "@/components/chat/chat-message";
import type { OperatorPerson } from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import {
  useActiveOperators,
  useOperatorPresenceHeartbeat,
} from "@/hooks/use-operator-presence";

/** Top-bar avatars of other operators in the portal; also sends this operator's heartbeat. */
export function OperatorPresence() {
  const pathname = usePathname();
  const dock = useAgentDock();
  useOperatorPresenceHeartbeat({
    pathname,
    threadId:
      dock.mode !== "collapsed" && dock.view === "chat"
        ? dock.activeThreadId
        : null,
  });
  const others = useActiveOperators().filter((operator) => !operator.self);
  if (others.length === 0) return null;
  return (
    <>
      <PresenceAvatars users={others} />
      <div className="h-4 w-px bg-foreground/10" />
    </>
  );
}

/** Dock header: who started the open chat and which other operators have it open. */
export function OperatorThreadPeople({
  threadId,
  creator,
}: {
  threadId: string;
  creator?: OperatorPerson;
}) {
  const viewers = useActiveOperators().filter(
    (operator) => !operator.self && operator.threadId === threadId,
  );
  return (
    <span className="flex items-center gap-2">
      {viewers.length ? (
        <PresenceAvatars users={viewers} max={3} size="sm" />
      ) : null}
      {creator ? (
        <span
          className={cn(
            "flex max-w-40 items-center gap-1.5 text-muted-foreground",
            typeStyle("caption.default"),
          )}
          title={`Started by ${creator.name}`}
        >
          <ChatAvatar
            name={creator.name}
            imageUrl={creator.avatarUrl}
            className="size-5"
          />
          <span className="truncate">{creator.name}</span>
        </span>
      ) : null}
    </span>
  );
}
