"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { Loader2, UserPlus } from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@/components/ui/operational-panel";
import { InviteMemberDrawer } from "@/components/settings/invite-member-drawer";
import {
  TeamMemberEditDrawer,
  type TeamMemberProfileChanges,
} from "@/components/settings/team-member-edit-drawer";
import { TeamMembersList } from "@/components/settings/team-members-list";
import type {
  TeamInvitation,
  TeamMember,
  ViewerOrgData,
} from "@/components/settings/team-types";
import { useCachedViewerOrg } from "@/lib/sync/spot-cached-queries";
import {
  useCachedQuery,
  useUpdateCachedQuery,
} from "@/lib/sync/use-cached-query";

type OperatorClientTeamTarget = {
  _id: Id<"organizations">;
  primaryInsuranceContactId?: Id<"users">;
  operatorStatus?: "onboarding" | "live";
};

export function TeamSection({
  operatorClient,
  inviteOpen: controlledInviteOpen,
  onInviteOpenChange,
  showInviteAction = true,
  setOperatorRightPanel,
  onOperatorActivationSent,
}: {
  operatorClient?: OperatorClientTeamTarget;
  inviteOpen?: boolean;
  onInviteOpenChange?: (open: boolean) => void;
  showInviteAction?: boolean;
  setOperatorRightPanel?: (node: React.ReactNode) => void;
  onOperatorActivationSent?: () => void | Promise<void>;
} = {}) {
  const operatorClientOrgId = operatorClient?._id;
  const teamQueryArgs = useMemo(
    () => (operatorClientOrgId ? { operatorClientOrgId } : {}),
    [operatorClientOrgId],
  );
  const cacheScope = operatorClientOrgId ?? "current";
  const membersCacheKey = operatorClientOrgId
    ? `settings.team.listMembers.${cacheScope}`
    : "settings.team.listMembers";
  const invitationsCacheKey = operatorClientOrgId
    ? `settings.team.listInvitations.${cacheScope}`
    : "settings.team.listInvitations";
  const viewer = useCachedQuery("settings.team.viewer", api.users.viewer, {});
  const currentOrgData = useCachedViewerOrg();
  const orgData = useMemo(
    () =>
      operatorClient
        ? {
            org: operatorClient,
            membership: { role: "admin" as const },
          }
        : currentOrgData,
    [currentOrgData, operatorClient],
  );
  const members = useCachedQuery(
    membersCacheKey,
    api.orgs.listMembers,
    teamQueryArgs,
  ) as TeamMember[] | undefined;
  const invitations = useCachedQuery(
    invitationsCacheKey,
    api.orgs.listInvitations,
    teamQueryArgs,
  ) as TeamInvitation[] | undefined;
  const updateCachedMembers = useUpdateCachedQuery<
    TeamMember[],
    { operatorClientOrgId?: Id<"organizations"> }
  >(membersCacheKey);
  const updateCachedInvitations = useUpdateCachedQuery<
    TeamInvitation[],
    { operatorClientOrgId?: Id<"organizations"> }
  >(invitationsCacheKey);
  const updateCachedViewerOrg = useUpdateCachedQuery<
    ViewerOrgData,
    Record<string, never>
  >("orgs.viewerOrg");
  const removeMember = useMutation(api.orgs.removeMember);
  const updateMemberRole = useMutation(api.orgs.updateMemberRole);
  const updateMemberProfile = useMutation(api.orgs.updateMemberProfile);
  const requestMemberEmailChange = useAction(api.orgs.requestMemberEmailChange);
  const launchSoloClient = useAction(api.operator.launchSoloClient);
  const cancelMemberEmailChange = useMutation(api.orgs.cancelMemberEmailChange);
  const setPrimaryContact = useMutation(api.orgs.setPrimaryInsuranceContact);
  const ensurePrimaryContact = useMutation(
    api.orgs.ensurePrimaryInsuranceContact,
  );
  const cancelInvitation = useMutation(api.orgs.cancelInvitation);

  const org = orgData?.org;
  const viewerUserId = viewer?._id;

  const [uncontrolledInviteOpen, setUncontrolledInviteOpen] = useState(false);
  const [selectedInvitation, setSelectedInvitation] =
    useState<TeamInvitation | null>(null);
  const [cancellingInvitation, setCancellingInvitation] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState<TeamMember["role"]>("member");
  const [editEmail, setEditEmail] = useState("");
  const [emailChangeError, setEmailChangeError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [requestingEmailChange, setRequestingEmailChange] = useState(false);
  const [cancellingEmailChange, setCancellingEmailChange] = useState(false);
  const [removingMember, setRemovingMember] = useState(false);
  const [settingPrimaryContactUserId, setSettingPrimaryContactUserId] =
    useState<Id<"users"> | null>(null);
  const [activationUserId, setActivationUserId] = useState<Id<"users"> | null>(
    null,
  );

  const {
    setActions: setSettingsActions,
    setRightPanel: setSettingsRightPanel,
  } = useSettingsActions();
  const setRightPanel = setOperatorRightPanel ?? setSettingsRightPanel;
  const adminCount =
    members?.filter((member) => member.role === "admin").length ?? 0;
  const primaryContactId =
    org?.primaryInsuranceContactId ??
    (members?.length === 1 ? members[0]?.userId : undefined);
  const inviteOpen = controlledInviteOpen ?? uncontrolledInviteOpen;
  const setInviteOpen = useCallback(
    (open: boolean) => {
      if (onInviteOpenChange) {
        onInviteOpenChange(open);
      } else {
        setUncontrolledInviteOpen(open);
      }
    },
    [onInviteOpenChange],
  );

  const patchCachedPrimaryContact = useCallback(
    async (userId: Id<"users"> | undefined) => {
      if (operatorClientOrgId) return;
      await updateCachedViewerOrg({}, (current) =>
        current?.org
          ? {
              ...current,
              org: {
                ...current.org,
                primaryInsuranceContactId: userId,
              },
            }
          : current,
      );
    },
    [operatorClientOrgId, updateCachedViewerOrg],
  );

  const updatePrimaryContact = useCallback(
    async (userId: Id<"users">) => {
      setSettingPrimaryContactUserId(userId);
      try {
        await setPrimaryContact({ userId, operatorClientOrgId });
        await patchCachedPrimaryContact(userId);
        toast.success("Primary contact updated");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Failed to update primary contact"),
        );
      } finally {
        setSettingPrimaryContactUserId(null);
      }
    },
    [operatorClientOrgId, patchCachedPrimaryContact, setPrimaryContact],
  );

  const openEditMember = useCallback((member: TeamMember) => {
    setSelectedInvitation(null);
    setEditingMember(member);
    setEditName(member.name ?? "");
    setEditTitle(member.title ?? "");
    setEditPhone(member.phone ?? "");
    setEditRole(member.role);
    setEditEmail("");
    setEmailChangeError("");
  }, []);

  const removeTeamMember = useCallback(
    async (member: TeamMember) => {
      setRemovingMember(true);
      try {
        const result = await removeMember({
          membershipId: member.membershipId,
          operatorClientOrgId,
        });
        await updateCachedMembers(teamQueryArgs, (current) =>
          current.filter((row) => row.membershipId !== member.membershipId),
        );
        await patchCachedPrimaryContact(
          result.primaryInsuranceContactId ?? undefined,
        );
        toast.success("Member removed");
        setEditingMember(null);
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Failed to remove member"),
        );
      } finally {
        setRemovingMember(false);
      }
    },
    [
      operatorClientOrgId,
      patchCachedPrimaryContact,
      removeMember,
      teamQueryArgs,
      updateCachedMembers,
    ],
  );

  const saveTeamMember = useCallback(
    async (member: TeamMember, changes: TeamMemberProfileChanges) => {
      await updateMemberProfile({
        membershipId: member.membershipId,
        operatorClientOrgId,
        ...changes,
      });
      await updateCachedMembers(teamQueryArgs, (current) =>
        current.map((row) =>
          row.membershipId === member.membershipId
            ? {
                ...row,
                ...(changes.name !== undefined
                  ? { name: changes.name.trim() || undefined }
                  : {}),
                ...(changes.title !== undefined
                  ? { title: changes.title.trim() || undefined }
                  : {}),
                ...(changes.phone !== undefined
                  ? { phone: changes.phone || undefined }
                  : {}),
              }
            : row,
        ),
      );
    },
    [
      operatorClientOrgId,
      teamQueryArgs,
      updateCachedMembers,
      updateMemberProfile,
    ],
  );

  const saveTeamMemberRole = useCallback(
    async (member: TeamMember) => {
      setSavingProfile(true);
      try {
        await updateMemberRole({
          membershipId: member.membershipId,
          role: editRole,
          operatorClientOrgId,
        });
        await updateCachedMembers(teamQueryArgs, (current) =>
          current.map((row) =>
            row.membershipId === member.membershipId
              ? { ...row, role: editRole }
              : row,
          ),
        );
        setEditingMember((current) =>
          current?.membershipId === member.membershipId
            ? { ...current, role: editRole }
            : current,
        );
        toast.success("Role updated");
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not change the role"),
        );
      } finally {
        setSavingProfile(false);
      }
    },
    [
      editRole,
      operatorClientOrgId,
      teamQueryArgs,
      updateCachedMembers,
      updateMemberRole,
    ],
  );

  const cancelPendingEmailChange = useCallback(
    async (member: TeamMember) => {
      if (!member.pendingEmailChange) return;

      setCancellingEmailChange(true);
      setEmailChangeError("");
      try {
        await cancelMemberEmailChange({
          membershipId: member.membershipId,
          requestId: member.pendingEmailChange.requestId,
          operatorClientOrgId,
        });
        await updateCachedMembers(teamQueryArgs, (current) =>
          current.map((row) =>
            row.membershipId === member.membershipId
              ? { ...row, pendingEmailChange: undefined }
              : row,
          ),
        );
        setEditingMember((current) =>
          current?.membershipId === member.membershipId
            ? { ...current, pendingEmailChange: undefined }
            : current,
        );
        toast.success("Email change cancelled");
      } catch (error) {
        const message = getUserFacingErrorMessage(
          error,
          "Failed to cancel email change",
        );
        setEmailChangeError(message);
        toast.error(message);
      } finally {
        setCancellingEmailChange(false);
      }
    },
    [
      cancelMemberEmailChange,
      operatorClientOrgId,
      teamQueryArgs,
      updateCachedMembers,
    ],
  );

  const requestPendingEmailChange = useCallback(
    async (member: TeamMember, email: string) => {
      const nextEmail = email.trim();
      if (!nextEmail || !viewerUserId) return;

      setRequestingEmailChange(true);
      setEmailChangeError("");
      try {
        const result = await requestMemberEmailChange({
          membershipId: member.membershipId,
          email: nextEmail,
          operatorClientOrgId,
        });
        const pendingEmailChange = {
          requestId: result.requestId,
          newEmail: result.newEmail,
          requestedAt: result.requestedAt,
          expiresAt: result.expiresAt,
          requestedByUserId: viewerUserId,
        };
        await updateCachedMembers(teamQueryArgs, (current) =>
          current.map((row) =>
            row.membershipId === member.membershipId
              ? { ...row, pendingEmailChange }
              : row,
          ),
        );
        setEditingMember((current) =>
          current?.membershipId === member.membershipId
            ? { ...current, pendingEmailChange }
            : current,
        );
        setEditEmail("");
        toast.success(`Verification code sent to ${result.newEmail}`);
      } catch (error) {
        const message = getUserFacingErrorMessage(
          error,
          "Failed to request email change",
        );
        setEmailChangeError(message);
        toast.error(message);
      } finally {
        setRequestingEmailChange(false);
      }
    },
    [
      operatorClientOrgId,
      requestMemberEmailChange,
      teamQueryArgs,
      updateCachedMembers,
      viewerUserId,
    ],
  );

  const cancelPendingInvitation = useCallback(
    async (invitation: TeamInvitation) => {
      setCancellingInvitation(true);
      try {
        await cancelInvitation({
          invitationId: invitation._id,
          operatorClientOrgId,
        });
        await updateCachedInvitations(teamQueryArgs, (current) =>
          current.filter((row) => row._id !== invitation._id),
        );
        toast.success("Invitation cancelled");
        setSelectedInvitation(null);
      } catch {
        toast.error("Failed to cancel invitation");
      } finally {
        setCancellingInvitation(false);
      }
    },
    [
      cancelInvitation,
      operatorClientOrgId,
      teamQueryArgs,
      updateCachedInvitations,
    ],
  );

  const sendOperatorActivation = useCallback(
    async (member: TeamMember) => {
      if (!operatorClientOrgId || !member.email) {
        return;
      }
      setActivationUserId(member.userId);
      try {
        const result = await launchSoloClient({
          clientOrgId: operatorClientOrgId,
          adminUserId: member.userId,
        });
        await onOperatorActivationSent?.();
        toast.success(`Activation email queued for ${result.recipientEmail}`);
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Failed to send activation email"),
        );
      } finally {
        setActivationUserId(null);
      }
    },
    [launchSoloClient, onOperatorActivationSent, operatorClientOrgId],
  );

  useEffect(() => {
    if (operatorClientOrgId) return;
    setSettingsActions(
      <PillButton size="compact" onClick={() => setInviteOpen(true)}>
        <UserPlus className="w-3.5 h-3.5" />
        Invite member
      </PillButton>,
    );
    return () => setSettingsActions(null);
  }, [operatorClientOrgId, setInviteOpen, setSettingsActions]);

  useEffect(() => {
    if (orgData === undefined || members === undefined) return;
    if (org?.primaryInsuranceContactId || members.length !== 1) return;

    let cancelled = false;
    void ensurePrimaryContact({ operatorClientOrgId })
      .then(async (result) => {
        if (cancelled || !result.userId) return;
        await patchCachedPrimaryContact(result.userId);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    ensurePrimaryContact,
    members,
    operatorClientOrgId,
    org?.primaryInsuranceContactId,
    orgData,
    patchCachedPrimaryContact,
  ]);

  useEffect(() => {
    if (editingMember) {
      setRightPanel(
        <TeamMemberEditDrawer
          key={editingMember.membershipId}
          member={editingMember}
          viewerUserId={viewerUserId}
          adminCount={adminCount}
          primaryContactId={primaryContactId}
          name={editName}
          title={editTitle}
          phone={editPhone}
          role={editRole}
          email={editEmail}
          emailChangeError={emailChangeError}
          savingProfile={savingProfile}
          removingMember={removingMember}
          requestingEmailChange={requestingEmailChange}
          cancellingEmailChange={cancellingEmailChange}
          settingPrimaryContactUserId={settingPrimaryContactUserId}
          onOpenChange={(open) => {
            if (!open) setEditingMember(null);
          }}
          onNameChange={setEditName}
          onTitleChange={setEditTitle}
          onPhoneChange={setEditPhone}
          onRoleChange={setEditRole}
          onEmailChange={(value) => {
            setEditEmail(value);
            setEmailChangeError("");
          }}
          activationAction={
            operatorClientOrgId && !editingMember.isActivated ? (
              <PillButton
                variant="secondary"
                disabled={
                  activationUserId !== null ||
                  !editingMember.email ||
                  (operatorClient?.operatorStatus === "onboarding" &&
                    editingMember.role !== "admin")
                }
                onClick={() => void sendOperatorActivation(editingMember)}
              >
                {activationUserId === editingMember.userId ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Send activation
              </PillButton>
            ) : undefined
          }
          onSave={saveTeamMember}
          onSaveRole={(member) => void saveTeamMemberRole(member)}
          onRemove={(member) => void removeTeamMember(member)}
          onSetPrimary={(userId) => void updatePrimaryContact(userId)}
          onRequestEmailChange={(member, email) =>
            void requestPendingEmailChange(member, email)
          }
          onCancelEmailChange={(member) =>
            void cancelPendingEmailChange(member)
          }
        />,
      );
      return () => setRightPanel(null);
    }
    if (selectedInvitation) {
      setRightPanel(
        <SettingsDrawer
          open
          title={selectedInvitation.email}
          onOpenChange={(open) => {
            if (!open) setSelectedInvitation(null);
          }}
          footer={
            <PillButton
              variant="destructive"
              disabled={cancellingInvitation}
              onClick={() => void cancelPendingInvitation(selectedInvitation)}
            >
              {cancellingInvitation ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Cancel invitation
            </PillButton>
          }
        >
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Status"
              value="Pending invitation"
            />
            <OperationalLabelValueRow
              label="Role"
              value={selectedInvitation.role === "admin" ? "Admin" : "Member"}
            />
          </OperationalLabelValueList>
        </SettingsDrawer>,
      );
      return () => setRightPanel(null);
    }
    setRightPanel(
      <InviteMemberDrawer
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        operatorClientOrgId={operatorClientOrgId}
      />,
    );
    return () => setRightPanel(null);
  }, [
    selectedInvitation,
    cancellingInvitation,
    cancelPendingInvitation,
    activationUserId,
    operatorClient?.operatorStatus,
    sendOperatorActivation,
    editName,
    editEmail,
    editRole,
    emailChangeError,
    editPhone,
    editTitle,
    editingMember,
    inviteOpen,
    operatorClientOrgId,
    adminCount,
    primaryContactId,
    cancellingEmailChange,
    removingMember,
    requestingEmailChange,
    savingProfile,
    settingPrimaryContactUserId,
    cancelPendingEmailChange,
    requestPendingEmailChange,
    saveTeamMember,
    saveTeamMemberRole,
    setInviteOpen,
    setRightPanel,
    updatePrimaryContact,
    removeTeamMember,
    viewerUserId,
  ]);

  if (viewer === undefined || orgData === undefined || members === undefined) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {operatorClientOrgId && showInviteAction ? (
        <div className="flex justify-end">
          <PillButton
            size="compact"
            variant="secondary"
            onClick={() => setInviteOpen(true)}
          >
            <UserPlus className="size-3.5" />
            Invite member
          </PillButton>
        </div>
      ) : null}
      <TeamMembersList
        members={members}
        invitations={invitations}
        viewerUserId={viewerUserId}
        canEditMembers={orgData?.membership?.role === "admin"}
        primaryContactId={primaryContactId}
        showActivationStatus={!!operatorClientOrgId}
        onEditMember={openEditMember}
        onOpenInvitation={(invitation) => {
          setEditingMember(null);
          setSelectedInvitation(invitation);
        }}
      />
    </div>
  );
}
