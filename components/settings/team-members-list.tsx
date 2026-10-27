"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { OperationalPanel } from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  SortableTableHead,
} from "@/components/ui/table";
import type {
  TeamInvitation,
  TeamMember,
} from "@/components/settings/team-types";
import { useTableSort } from "@/hooks/use-table-sort";
import { typeStyle } from "@/lib/typography";

type TeamMembersListProps = {
  members: TeamMember[];
  invitations?: TeamInvitation[];
  viewerUserId?: Id<"users">;
  canEditMembers: boolean;
  primaryContactId?: Id<"users">;
  showActivationStatus?: boolean;
  onEditMember: (member: TeamMember) => void;
  onOpenInvitation: (invitation: TeamInvitation) => void;
};

type TeamRow =
  | { kind: "member"; member: TeamMember }
  | { kind: "invitation"; invitation: TeamInvitation };

const TEAM_SORT_COLUMNS = {
  name: (row: TeamRow) =>
    row.kind === "member" ? row.member.name || row.member.email : undefined,
  email: (row: TeamRow) =>
    row.kind === "member" ? row.member.email : row.invitation.email,
  access: (row: TeamRow) =>
    row.kind === "member" ? row.member.role : row.invitation.role,
};

export function TeamMembersList({
  members,
  invitations,
  viewerUserId,
  canEditMembers,
  primaryContactId,
  showActivationStatus,
  onEditMember,
  onOpenInvitation,
}: TeamMembersListProps) {
  const pendingInvitations =
    invitations?.filter((invitation) => invitation.status === "pending") ?? [];
  // Members and pending invitations sort within their own groups.
  const tableSort = useTableSort(
    "team-members",
    [
      ...members.map((member) => ({ kind: "member" as const, member })),
      ...pendingInvitations.map((invitation) => ({
        kind: "invitation" as const,
        invitation,
      })),
    ],
    TEAM_SORT_COLUMNS,
  );
  const sortedMembers = tableSort.rows.flatMap((row) =>
    row.kind === "member" ? [row.member] : [],
  );
  const sortedInvitations = tableSort.rows.flatMap((row) =>
    row.kind === "invitation" ? [row.invitation] : [],
  );

  if (members.length === 0 && pendingInvitations.length === 0) {
    return (
      <EmptyStateCard
        title="No team members yet"
        description={
          canEditMembers
            ? "Invite a member to give them access to this account."
            : undefined
        }
      />
    );
  }

  return (
    <OperationalPanel>
      <Table storageKey="spot:team-members:columns" className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableTableHead
              className="w-[35%] px-5"
              {...tableSort.head("name")}
            >
              Member
            </SortableTableHead>
            <SortableTableHead className="w-[40%]" {...tableSort.head("email")}>
              Email
            </SortableTableHead>
            <SortableTableHead
              className="w-[25%] px-5"
              {...tableSort.head("access")}
            >
              Access
            </SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedMembers.map((member) => (
            <TableRow
              key={member.membershipId}
              aria-label={
                canEditMembers
                  ? `Edit ${member.name || member.email || "team member"}`
                  : undefined
              }
              className={
                canEditMembers
                  ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  : undefined
              }
              onClick={canEditMembers ? () => onEditMember(member) : undefined}
              onKeyDown={
                canEditMembers
                  ? (event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onEditMember(member);
                    }
                  : undefined
              }
              tabIndex={canEditMembers ? 0 : undefined}
            >
              <TableCell className="px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-foreground ${typeStyle("caption.medium")}`}
                  >
                    {getMemberInitials(member)}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={`truncate text-foreground ${typeStyle("body.medium")}`}
                    >
                      {member.name || member.email}
                      {member.userId === viewerUserId ? (
                        <span
                          className={`ml-1 text-muted-foreground/50 ${typeStyle("caption.default")}`}
                        >
                          (you)
                        </span>
                      ) : null}
                    </p>
                    {member.title ? (
                      <p
                        className={`truncate text-muted-foreground ${typeStyle("caption.default")}`}
                      >
                        {member.title}
                      </p>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-64 truncate py-3 text-muted-foreground">
                {member.email || "-"}
              </TableCell>

              <TableCell className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {member.role === "admin" ? "Admin" : "Member"}
                    </Badge>
                    {member.userId === primaryContactId ? (
                      <Badge variant="secondary">Primary Contact</Badge>
                    ) : null}
                  </div>
                  {showActivationStatus ? (
                    <StatusTag
                      tone={member.isActivated ? "success" : "neutral"}
                      indicator={member.isActivated ? "complete" : "inactive"}
                    >
                      {member.isActivated ? "Active" : "Not activated"}
                    </StatusTag>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}

          {sortedInvitations.map((invitation) => (
            <TableRow
              key={invitation._id}
              className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              tabIndex={0}
              onClick={() => onOpenInvitation(invitation)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenInvitation(invitation);
                }
              }}
            >
              <TableCell className="px-5 py-3">
                <p className={`text-foreground ${typeStyle("body.medium")}`}>
                  Pending invitation
                </p>
              </TableCell>
              <TableCell className="py-3 text-muted-foreground">
                {invitation.email}
              </TableCell>
              <TableCell className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className={`${typeStyle("label.tag")}`}
                  >
                    {invitation.role}
                  </Badge>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </OperationalPanel>
  );
}

function getMemberInitials(member: TeamMember) {
  if (!member.name) return member.email?.[0]?.toUpperCase() ?? "?";

  return member.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
