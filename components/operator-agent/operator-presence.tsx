"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { PresenceAvatars } from "@/components/app-top-bar";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { TagRemoveButton } from "@claritylabs-inc/ui/components/tag-remove-button";
import type { OperatorPerson } from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import {
  FOLLOW_CONTROL_ATTRIBUTE,
  OperatorFollow,
} from "@/components/operator-agent/operator-follow";
import { toast } from "sonner";
import {
  isPrivatePage,
  PageMultiplayer,
} from "@/components/operator-agent/page-multiplayer";
import { trackFieldOrigins } from "@/lib/collab/field-binding";
import { usePresenceSlot } from "@/components/operator-agent/presence-slot";
import {
  assignOperatorColors,
  OperatorColorsProvider,
} from "@/lib/collab/operator-color";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { usePublishOperatorCursor } from "@/hooks/use-operator-cursor";
import {
  followIsMutual,
  setFollowingOperator,
  useActiveOperators,
  useFollowingOperator,
  useOperatorPresenceHeartbeat,
} from "@/hooks/use-operator-presence";

/**
 * Multiplayer for the operator portal: sends this tab's heartbeat, runs the
 * page's room and the follow session, and shows other operators in the AI
 * dock bar's `PresenceSlot`. Operators on the same page see each other's
 * pointers and carets and edit its fields together; clicking an avatar follows
 * that operator's page and panels too. Following only goes one way: following
 * a follower takes over and they stop.
 */
const PILL_TRANSITION = {
  type: "spring",
  stiffness: 520,
  damping: 42,
} as const;

export function OperatorPresence() {
  const pathname = usePathname();
  useEffect(() => trackFieldOrigins(), []);
  const dock = useAgentDock();
  const followingUserId = useFollowingOperator();
  const active = useActiveOperators();
  const others = active.filter((operator) => !operator.self);
  // Distinct colors across everyone active, the same in every browser.
  const colors = useMemo(
    () => assignOperatorColors(active.map((operator) => operator.userId)),
    [active],
  );
  const operatorColor = (userId: string) =>
    colors.get(userId) ?? "currentColor";
  const self = active.find((operator) => operator.self);
  const leader = others.find((operator) => operator.userId === followingUserId);
  const mutual = !!leader && !!self && followIsMutual(leader, self.userId);
  useEffect(() => {
    if (mutual) setFollowingOperator(null);
  }, [mutual]);
  // Paused while the leader is away (hidden tab, closed portal).
  const following = leader && !mutual ? followingUserId : null;
  const privatePage = isPrivatePage(pathname);
  const peers = privatePage
    ? []
    : others.filter((operator) => operator.pathnames.includes(pathname));
  // Once shared, the page stays in its room until this operator leaves it:
  // a teammate's presence can drop for a moment (another of their tabs
  // closing), and tearing the room down would cut off edits in flight.
  const [sharedPathname, setSharedPathname] = useState<string | null>(null);
  if (peers.length > 0 && sharedPathname !== pathname) {
    setSharedPathname(pathname);
  }
  // From the session, not presence: another of this operator's tabs closing
  // drops their presence row for a moment.
  const selfId = useCachedOperatorCurrent()?.user._id;
  const multiplayer =
    sharedPathname === pathname && selfId ? (
      <PageMultiplayer
        key={pathname}
        pathname={pathname}
        selfId={selfId}
        peers={peers.map((peer) => ({
          userId: peer.userId as Id<"users">,
          name: peer.name,
        }))}
        followingUserId={following}
      />
    ) : null;
  const followers = self
    ? others.filter((operator) => operator.followingUserId === self.userId)
    : [];
  const followed = followers.length > 0;
  // Followers stop at a private page; tell the leader why they dropped off.
  const followerNames = followers.map((operator) => operator.name).join(", ");
  const notifyFollowers = useEffectEvent(() => {
    if (!followerNames) return;
    toast(`${followerNames} stopped following you`, {
      description: "This page is private.",
    });
  });
  useEffect(() => {
    if (privatePage) notifyFollowers();
  }, [privatePage]);
  useOperatorPresenceHeartbeat({
    pathname,
    threadId:
      dock.mode !== "collapsed" && dock.view === "chat"
        ? dock.activeThreadId
        : null,
    followingUserId: following,
  });
  usePublishOperatorCursor({
    pointer: peers.length > 0 || followed,
    ui: followed,
  });
  const slot = usePresenceSlot();
  const collapsed = slot?.collapsed ?? false;
  const follow = (user: { userId: string }) =>
    setFollowingOperator(
      user.userId === following ? null : (user.userId as Id<"users">),
      {
        takeOver: others.some(
          (operator) =>
            operator.userId === user.userId &&
            operator.followingUserId === self?.userId,
        ),
      },
    );
  // A soft wash of the operator's color behind their pills.
  const tint = (userId: string) =>
    `color-mix(in srgb, ${operatorColor(userId)} 14%, transparent)`;
  const followedOperator = leader && following ? leader : null;
  // A stable order, so avatars hold their place as pills open and close.
  const roster = [...others].sort((a, b) => a.name.localeCompare(b.name));
  // A row of pills in each operator's color: an avatar alone, or with text for
  // the followed operator and followers, opening in place.
  const item = (operator: (typeof others)[number]) => {
    const isFollowed = operator === followedOperator;
    const isFollower =
      !privatePage &&
      followers.some((follower) => follower.userId === operator.userId);
    const open = (isFollowed || isFollower) && !collapsed;
    const firstName = operator.name.split(" ")[0];
    const label = isFollowed
      ? `Stop following ${operator.name}`
      : `Follow ${operator.name}`;
    return (
      <motion.span
        key={operator.userId}
        layout
        transition={PILL_TRANSITION}
        title={
          isFollower
            ? `${operator.name} can see your page, pointer and panels`
            : operator.name
        }
        className={cn(
          // Shrinks to the sidebar's width; long names end in an ellipsis.
          "flex max-w-full min-w-0 items-center gap-1.5 rounded-full p-1",
          // Text ends a pill evenly; the ✕ brings its own space.
          open && (isFollowed ? "pr-1" : "pr-2.5"),
          typeStyle("caption.medium"),
        )}
        style={
          {
            backgroundColor: tint(operator.userId),
            color: operatorColor(operator.userId),
            "--operator-color": operatorColor(operator.userId),
          } as CSSProperties
        }
      >
        <motion.button
          layout="position"
          type="button"
          title={label}
          aria-label={label}
          onClick={() =>
            isFollowed ? setFollowingOperator(null) : follow(operator)
          }
          className="shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Avatar
            name={operator.name}
            imageUrl={operator.avatarUrl}
            // Without a photo, initials take the operator's color too.
            className="size-6 bg-[color-mix(in_srgb,var(--operator-color)_22%,transparent)] [&>span]:text-(--operator-color)"
          />
        </motion.button>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.span
              layout="position"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex min-w-0 items-center gap-1"
            >
              <span className="min-w-0 truncate">
                {isFollowed
                  ? `Following ${firstName}`
                  : `${firstName} is following you`}
              </span>
              {isFollowed ? (
                <TagRemoveButton
                  label={`Stop following ${operator.name}`}
                  onClick={() => setFollowingOperator(null)}
                />
              ) : null}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.span>
    );
  };
  // Shown in the AI dock bar, on every operator page; the room, follow
  // session and heartbeat run here either way. Compact (mobile) drops the text.
  const rosterArea = (
    <motion.div
      {...{ [FOLLOW_CONTROL_ATTRIBUTE]: "" }}
      layout
      transition={PILL_TRANSITION}
      className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide"
    >
      {roster.map(item)}
    </motion.div>
  );
  const hasRoster = others.length > 0;
  // One tree whatever is shown, so the page's room never remounts when the
  // avatars come and go.
  return (
    <OperatorColorsProvider value={colors}>
      {slot && hasRoster ? createPortal(rosterArea, slot.element) : null}
      {multiplayer}
      {followedOperator ? (
        <OperatorFollow
          userId={followedOperator.userId}
          name={followedOperator.name}
          pathname={followedOperator.pathname}
          onStop={() => setFollowingOperator(null)}
        />
      ) : null}
    </OperatorColorsProvider>
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
          <Avatar
            name={creator.name}
            imageUrl={creator.avatarUrl}
            className="size-5 border-2 border-background"
          />
          <span className="truncate">{creator.name}</span>
        </span>
      ) : null}
    </span>
  );
}
