"use client";

import { useRef, type ReactNode } from "react";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { Input } from "@/components/ui/input";
import { Loader2, Mail } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/ui/pill-button";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import type { TeamMember } from "@/components/settings/team-types";
import { typeStyle } from "@/lib/typography";

export type TeamMemberProfileChanges = {
  name?: string;
  title?: string;
  phone?: string;
};

type TeamMemberEditDrawerProps = {
  member: TeamMember;
  viewerUserId?: Id<"users">;
  adminCount: number;
  primaryContactId?: Id<"users">;
  name: string;
  title: string;
  phone: string;
  role: TeamMember["role"];
  email: string;
  emailChangeError: string;
  savingProfile: boolean;
  removingMember: boolean;
  requestingEmailChange: boolean;
  cancellingEmailChange: boolean;
  settingPrimaryContactUserId: Id<"users"> | null;
  onOpenChange: (open: boolean) => void;
  onNameChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onRoleChange: (value: TeamMember["role"]) => void;
  onEmailChange: (value: string) => void;
  onSave: (
    member: TeamMember,
    changes: TeamMemberProfileChanges,
  ) => Promise<void>;
  onSaveRole: (member: TeamMember) => void;
  activationAction?: ReactNode;
  onRemove: (member: TeamMember) => void;
  onSetPrimary: (userId: Id<"users">) => void;
  onRequestEmailChange: (member: TeamMember, email: string) => void;
  onCancelEmailChange: (member: TeamMember) => void;
};

export function TeamMemberEditDrawer({
  member,
  viewerUserId,
  adminCount,
  primaryContactId,
  name,
  title,
  phone,
  role,
  email,
  emailChangeError,
  savingProfile,
  removingMember,
  requestingEmailChange,
  cancellingEmailChange,
  settingPrimaryContactUserId,
  onOpenChange,
  onNameChange,
  onTitleChange,
  onPhoneChange,
  onRoleChange,
  onEmailChange,
  onSave,
  onSaveRole,
  activationAction,
  onRemove,
  onSetPrimary,
  onRequestEmailChange,
  onCancelEmailChange,
}: TeamMemberEditDrawerProps) {
  const isPrimaryContact = member.userId === primaryContactId;
  const isSelf = member.userId === viewerUserId;
  const isLastAdmin = member.role === "admin" && adminCount <= 1;
  const roleLocked = isSelf || isLastAdmin;
  const roleSelectTitle = isSelf
    ? "You cannot change your own role"
    : isLastAdmin
      ? "At least one admin is required"
      : undefined;

  const savedValues = useRef({ name, title, phone });
  const autoSave = useLocalFirstAutoSave({
    mutationName: "orgs.updateMemberProfile",
    args: { name, title, phone },
    enabled: !removingMember,
    flush: async (next) => {
      const previous = savedValues.current;
      await onSave(member, {
        name: next.name !== previous.name ? next.name : undefined,
        title: next.title !== previous.title ? next.title : undefined,
        phone: next.phone !== previous.phone ? next.phone : undefined,
      });
      savedValues.current = next;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update the team member"),
  });

  const hasFooterActions =
    (!isSelf && !isLastAdmin) ||
    !isPrimaryContact ||
    !!member.pendingEmailChange ||
    !!email.trim() ||
    !!activationAction ||
    (!roleLocked && role !== member.role);

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open)
          void autoSave.saveNow().then((saved) => {
            if (saved) onOpenChange(false);
          });
      }}
      actions={<AutoSaveStatus status={autoSave.status} />}
      title={member.name || member.email || "Team member"}
      footer={
        hasFooterActions ? (
          <>
            {!isSelf && !isLastAdmin ? (
              <PillButton
                variant="destructive"
                size="compact"
                disabled={removingMember}
                onClick={() =>
                  void autoSave.saveNow().then((saved) => {
                    if (saved) onRemove(member);
                  })
                }
              >
                {removingMember ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Remove team member
              </PillButton>
            ) : null}
            {!isPrimaryContact ? (
              <PillButton
                variant="secondary"
                size="compact"
                disabled={settingPrimaryContactUserId === member.userId}
                onClick={() => onSetPrimary(member.userId)}
              >
                {settingPrimaryContactUserId === member.userId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Set primary
              </PillButton>
            ) : null}
            {member.pendingEmailChange ? (
              <PillButton
                variant="destructive"
                size="compact"
                disabled={cancellingEmailChange}
                onClick={() => onCancelEmailChange(member)}
              >
                {cancellingEmailChange ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Cancel email change
              </PillButton>
            ) : email.trim() ? (
              <PillButton
                variant="secondary"
                disabled={requestingEmailChange}
                onClick={() => onRequestEmailChange(member, email)}
              >
                {requestingEmailChange ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Send code
              </PillButton>
            ) : null}
            {activationAction}
            {!roleLocked && role !== member.role ? (
              <PillButton
                disabled={savingProfile || removingMember}
                onClick={() => onSaveRole(member)}
              >
                {savingProfile ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Change role
              </PillButton>
            ) : null}
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.medium")}`}
          >
            Name
          </span>
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Name"
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.medium")}`}
          >
            Title
          </span>
          <Input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Title"
          />
        </label>
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.medium")}`}
          >
            Phone
          </span>
          <PhoneInput
            value={phone}
            onChange={(value) => onPhoneChange(value ?? "")}
            defaultCountry="US"
            placeholder="(555) 123-4567"
          />
        </label>
        <div className="space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.medium")}`}
          >
            Role
          </span>
          <Select
            value={role}
            onValueChange={(value) => {
              if (value === "admin" || value === "member") onRoleChange(value);
            }}
          >
            <SelectTrigger
              className="w-full"
              aria-label="Role"
              disabled={roleLocked}
              title={roleSelectTitle}
            >
              <SelectValue>{role === "admin" ? "Admin" : "Member"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {isPrimaryContact ? (
          <Badge variant="secondary">Primary insurance contact</Badge>
        ) : null}
        <div className="space-y-4 border-t border-border pt-4">
          <label className="block space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              Email
            </span>
            <Input value={member.email ?? ""} disabled />
          </label>
          {member.pendingEmailChange ? (
            <div className="rounded-lg border border-input bg-popover px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Pending email
                  </p>
                  <p
                    className={`truncate text-foreground ${typeStyle("body.medium")}`}
                  >
                    {member.pendingEmailChange.newEmail}
                  </p>
                </div>
              </div>
              <p
                className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}
              >
                Waiting for verification before this replaces the current email.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="block space-y-1.5">
                <span
                  className={`text-muted-foreground ${typeStyle("caption.medium")}`}
                >
                  New email
                </span>
                <div>
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => onEmailChange(event.target.value)}
                    placeholder="new@example.com"
                  />
                </div>
              </label>
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                The current email stays active until the new address is
                verified.
              </p>
            </div>
          )}
          {emailChangeError ? (
            <p className={`text-destructive ${typeStyle("body.default")}`}>
              {emailChangeError}
            </p>
          ) : null}
        </div>
      </div>
    </SettingsDrawer>
  );
}
