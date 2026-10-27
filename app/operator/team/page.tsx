"use client";

import Link from "next/link";
import { UsersRound } from "lucide-react";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { AppShell } from "@/components/app-shell";
import { PresenceAvatars, resolveAppBreadcrumb } from "@/components/app-top-bar";
import { useOptionalAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { PillButton } from "@/components/ui/pill-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  setFollowingOperator,
  useFollowingOperator,
  useOperatorSessions,
} from "@/hooks/use-operator-presence";
import { typeStyle } from "@/lib/typography";

const linkClass = "truncate underline-offset-4 hover:underline";

/** Every teammate active in the portal, with where they are and a way to join them. */
export default function OperatorTeamPage() {
  const sessions = useOperatorSessions();
  const following = useFollowingOperator();
  const dock = useOptionalAgentDock();
  const others = (sessions ?? []).filter((session) => !session.self);
  const names = new Map(others.map((session) => [session.userId, session.name]));

  return (
    <AppShell>
      {sessions === undefined ? null : others.length === 0 ? (
        <EmptyStateCard
          icon={<UsersRound className="size-6" />}
          title="No teammates online"
          description="Operators show up here while they have the portal open."
        />
      ) : (
        <OperationalPanel>
          <Table storageKey="spot:team-sessions:columns">
            <TableHeader>
              <TableRow>
                <TableHead>Operator</TableHead>
                <TableHead>Page</TableHead>
                <TableHead>Spot chat</TableHead>
                <TableHead>Email</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {others.map((session) => {
                const page = resolveAppBreadcrumb(session.pathname);
                const followed = session.followingUserId
                  ? names.get(session.followingUserId) ?? "a teammate"
                  : null;
                const isFollowing = following === session.userId;
                return (
                  <TableRow key={session.userId}>
                    <TableCell className="max-w-48">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <PresenceAvatars
                          users={[session]}
                          size="sm"
                          selectedUserId={following}
                        />
                        <span className="truncate">{session.name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64">
                      <Link
                        href={session.pathname}
                        title={session.pathname}
                        className={`block ${linkClass}`}
                      >
                        {page.label ?? session.pathname}
                      </Link>
                      {followed ? (
                        <span
                          className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          Following {followed}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-64">
                      {session.chat && dock ? (
                        <button
                          type="button"
                          className={`block max-w-full text-left ${linkClass}`}
                          onClick={() => dock.openThread(session.chat!.id)}
                        >
                          {session.chat.title}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-64">
                      {session.email ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <Link
                            href={`/operator/inbox/${session.email.id}`}
                            className={linkClass}
                          >
                            {session.email.subject || "(no subject)"}
                          </Link>
                          {session.email.activity === "replying" ? (
                            <StatusTag tone="warning" indicator="progress">
                              Replying
                            </StatusTag>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="w-px whitespace-nowrap text-right">
                      <PillButton
                        size="compact"
                        variant={isFollowing ? "secondary" : "primary"}
                        onClick={() =>
                          setFollowingOperator(isFollowing ? null : session.userId)
                        }
                      >
                        {isFollowing ? "Stop following" : "Join"}
                      </PillButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </OperationalPanel>
      )}
    </AppShell>
  );
}
