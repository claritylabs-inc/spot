"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { PresenceAvatars } from "@/components/app-top-bar";
import { ChatAvatar } from "@/components/chat/chat-message";
import type { OperatorPerson } from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import {
  FOLLOW_CONTROL_ATTRIBUTE,
  OperatorFollow,
} from "@/components/operator-agent/operator-follow";
import { usePublishOperatorCursor } from "@/hooks/use-operator-cursor";
import {
  useActiveOperators,
  useOperatorPresenceHeartbeat,
} from "@/hooks/use-operator-presence";

/**
 * Top-bar avatars of other operators in the portal; also sends this operator's
 * heartbeat. Clicking an avatar follows that operator's page and cursor, and
 * this operator's own cursor streams only while someone follows them.
 */
export function OperatorPresence() {
  const pathname = usePathname();
  const dock = useAgentDock();
  const [followingUserId, setFollowingUserId] = useState<Id<"users"> | null>(
    null,
  );
  const active = useActiveOperators();
  const others = active.filter((operator) => !operator.self);
  const self = active.find((operator) => operator.self);
  const leader = others.find((operator) => operator.userId === followingUserId);
  // Paused while the leader is away (hidden tab, closed portal).
  const following = leader ? followingUserId : null;
  useOperatorPresenceHeartbeat({
    pathname,
    threadId:
      dock.mode !== "collapsed" && dock.view === "chat"
        ? dock.activeThreadId
        : null,
    followingUserId: following,
  });
  usePublishOperatorCursor(
    !!self &&
      others.some((operator) => operator.followingUserId === self.userId),
  );
  if (others.length === 0) return null;
  return (
    <>
      <div {...{ [FOLLOW_CONTROL_ATTRIBUTE]: "" }} className="flex">
        <PresenceAvatars
          users={others}
          selectedUserId={following}
          selectLabel={(user) =>
            user.userId === following
              ? `Stop following ${user.name}`
              : `Follow ${user.name}`
          }
          onSelect={(user) =>
            setFollowingUserId(
              user.userId === following ? null : (user.userId as Id<"users">),
            )
          }
        />
      </div>
      <div className="mx-1.5 h-4 w-px bg-foreground/10" />
      {leader ? (
        <OperatorFollow
          userId={leader.userId}
          name={leader.name}
          pathname={leader.pathname}
          onStop={() => setFollowingUserId(null)}
        />
      ) : null}
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
    <span className="mr-3 flex items-center gap-2">
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
