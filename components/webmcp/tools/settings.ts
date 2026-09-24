import { api } from "@/convex/_generated/api";
import { CLIENT_NOTIFICATION_TYPES } from "@/lib/webmcp/definitions/settings";
import { webMcpError } from "@/lib/webmcp/runtime";
import {
  assertDate,
  bool,
  compact,
  id,
  isoTime,
  num,
  record,
  requiredBool,
  requiredText,
  text,
  uploadBase64File,
  type ClientToolContext,
  type ToolInput,
  type ToolMap,
} from "@/components/webmcp/tools/helpers";

function automationInput(input: ToolInput) {
  const automation = record(input, "automation");
  if (!automation) return undefined;
  return {
    policyImports: requiredBool(automation, "policy_imports"),
    requirementImports: requiredBool(automation, "requirement_imports"),
    companyMemory: requiredBool(automation, "company_memory"),
  };
}

type Mailbox = {
  _id: string;
  emailAddress: string;
  label?: string;
  scope: string;
  status: string;
  host: string;
  automation?: unknown;
  lastError?: string;
  lastScanAt?: number;
};

function mailboxRow(mailbox: Mailbox) {
  return {
    mailbox_id: mailbox._id,
    email_address: mailbox.emailAddress,
    label: mailbox.label ?? null,
    scope: mailbox.scope,
    status: mailbox.status,
    host: mailbox.host,
    automation: mailbox.automation ?? null,
    last_error: mailbox.lastError ?? null,
    last_scan_at: isoTime(mailbox.lastScanAt),
  };
}

function wikiResult(wiki: {
  filename: string;
  revision: number;
  markdown: string;
  proposals: Array<{ heading: string; body: string; rationale?: string }>;
} | null) {
  if (!wiki) return webMcpError("The company wiki is not shared with this organization.");
  return {
    status: "ok",
    filename: wiki.filename,
    revision: wiki.revision,
    markdown: wiki.markdown,
    suggestions: wiki.proposals,
  };
}

export function settingsToolImplementations(ctx: ClientToolContext): ToolMap {
  const { convex, orgId, router } = ctx;
  return {
    get_organization: async () => {
      const viewerOrg = await convex.query(api.orgs.viewerOrg, {});
      if (!viewerOrg) return webMcpError("No organization.");
      const { org, membership } = viewerOrg;
      return {
        status: "ok",
        organization: {
          org_id: org._id,
          name: org.name,
          website: org.website ?? null,
          logo_url: org.iconUrl ?? null,
          agent_handle: org.agentHandle ?? null,
        },
        your_role: membership.role,
      };
    },
    update_organization: async (input) => {
      const name = text(input, "name");
      const website = text(input, "website");
      if (!name && !website) return webMcpError("Provide name or website.");
      await convex.mutation(api.orgs.updateOrg, compact({ name, website }));
      return { status: "updated" };
    },
    research_company: async (input) => {
      const result = await convex.action(
        api.actions.extractCompanyInfo.extractCompanyInfo,
        compact({ url: text(input, "website"), orgId }),
      );
      return { status: result.status ?? (result.queued ? "queued" : "ok") };
    },
    upload_organization_logo: async (input) => {
      const file = await uploadBase64File(input, () =>
        convex.mutation(api.organizations.generateOrgLogoUploadUrl, { orgId }),
      );
      await convex.mutation(api.organizations.updateOrgLogo, { orgId, logoStorageId: file.storageId });
      return { status: "updated" };
    },
    import_logo_from_website: async (input) => {
      const result = await convex.action(api.actions.extractCompanyInfo.importOrgLogoFromWebsite, {
        url: requiredText(input, "url"),
        orgId,
      });
      return result.success
        ? { status: "updated" }
        : webMcpError(result.error ?? "No logo found on that website.");
    },
    update_agent_email_settings: async (input) => {
      const delay = num(input, "send_delay_seconds");
      const patch = compact({
        chatEmailNotifications: bool(input, "chat_email_notifications"),
        bccRequesterOnAgentEmails: bool(input, "bcc_requester_on_agent_emails"),
        emailSendDelay: delay,
      });
      if (Object.keys(patch).length === 0) return webMcpError("Provide at least one setting.");
      await convex.mutation(api.orgs.updateOrg, patch);
      return { status: "updated" };
    },

    list_team_members: async () => {
      const members = await convex.query(api.orgs.listMembers, {});
      return {
        status: "ok",
        members: members.map((member) => ({
          membership_id: member.membershipId,
          user_id: member.userId,
          role: member.role,
          name: member.name ?? null,
          email: member.email ?? null,
          phone: member.phone ?? null,
          title: member.title ?? null,
          activated: member.isActivated,
          pending_email_change: member.pendingEmailChange
            ? {
                request_id: member.pendingEmailChange.requestId,
                new_email: member.pendingEmailChange.newEmail,
              }
            : null,
        })),
      };
    },
    list_team_invitations: async () => {
      const invitations = await convex.query(api.orgs.listInvitations, {});
      return {
        status: "ok",
        invitations: invitations.map((invitation) => ({
          invitation_id: invitation._id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expires_at: isoTime(invitation.expiresAt),
        })),
      };
    },
    invite_team_member: async (input) => {
      const invitationId = await convex.action(api.orgs.sendMemberInvitation, {
        email: requiredText(input, "email"),
        role: requiredText(input, "role") as "admin" | "member",
      });
      return { status: "invited", invitation_id: invitationId };
    },
    cancel_team_invitation: async (input) => {
      await convex.mutation(api.orgs.cancelInvitation, {
        invitationId: id<"orgInvitations">(input, "invitation_id"),
      });
      return { status: "cancelled" };
    },
    change_member_role: async (input) => {
      await convex.mutation(api.orgs.updateMemberRole, {
        membershipId: id<"orgMemberships">(input, "membership_id"),
        role: requiredText(input, "role") as "admin" | "member",
      });
      return { status: "updated" };
    },
    remove_team_member: async (input) => {
      await convex.mutation(api.orgs.removeMember, {
        membershipId: id<"orgMemberships">(input, "membership_id"),
      });
      return { status: "removed" };
    },
    update_team_member_profile: async (input) => {
      await convex.mutation(
        api.orgs.updateMemberProfile,
        compact({
          membershipId: id<"orgMemberships">(input, "membership_id"),
          name: text(input, "name"),
          title: text(input, "title"),
          phone: text(input, "phone"),
        }),
      );
      return { status: "updated" };
    },
    set_primary_insurance_contact: async (input) => {
      await convex.mutation(api.orgs.setPrimaryInsuranceContact, {
        userId: id<"users">(input, "user_id"),
      });
      return { status: "updated" };
    },
    request_member_email_change: async (input) => {
      const result = await convex.action(api.orgs.requestMemberEmailChange, {
        membershipId: id<"orgMemberships">(input, "membership_id"),
        email: requiredText(input, "email"),
      });
      return { status: "code_sent", request_id: result.requestId, new_email: result.newEmail };
    },
    cancel_member_email_change: async (input) => {
      await convex.mutation(api.orgs.cancelMemberEmailChange, {
        membershipId: id<"orgMemberships">(input, "membership_id"),
        requestId: id<"userEmailChangeRequests">(input, "request_id"),
      });
      return { status: "cancelled" };
    },

    get_agent_channels: async () => {
      const channels = await convex.query(api.agentChannels.get, { clientOrgId: orgId });
      return {
        status: "ok",
        settings: channels.settings,
        agent_email_address: channels.agentEmailAddress ?? null,
        slack: {
          connected: Boolean(channels.connection),
          health: channels.slackHealth ?? null,
        },
        permissions: channels.permissions,
      };
    },
    update_agent_channels: async (input) => {
      const { settings } = await convex.query(api.agentChannels.get, { clientOrgId: orgId });
      const next = {
        emailEnabled: bool(input, "email_enabled") ?? settings.emailEnabled,
        imessageEnabled: bool(input, "imessage_enabled") ?? settings.imessageEnabled,
        slackEnabled: bool(input, "slack_enabled") ?? settings.slackEnabled,
        slackSafeAlertsEnabled:
          bool(input, "slack_safe_alerts_enabled") ?? settings.slackSafeAlertsEnabled,
        slackVendorAlertsEnabled:
          bool(input, "slack_vendor_alerts_enabled") ?? settings.slackVendorAlertsEnabled,
      };
      await convex.mutation(api.agentChannels.update, next);
      return { status: "updated", settings: next };
    },
    list_slack_channels: async () => {
      const result = await convex.action(api.slackOnboarding.listAvailableChannels, {
        clientOrgId: orgId,
      });
      return { status: "ok", channels: result.channels };
    },
    select_slack_channel: async (input) => ({
      status: "selected",
      channel: await convex.action(api.slackOnboarding.selectAutomaticChannel, {
        clientOrgId: orgId,
        channelId: requiredText(input, "channel_id"),
      }),
    }),
    join_slack_channel: async (input) => {
      const result = await convex.action(api.slackOnboarding.joinPublicChannel, {
        clientOrgId: orgId,
        channelId: requiredText(input, "channel_id"),
      });
      return { status: "joined", channel: result.channel };
    },
    leave_slack_channel: async (input) => {
      const result = await convex.action(api.slackOnboarding.leavePublicChannel, {
        clientOrgId: orgId,
        channelId: requiredText(input, "channel_id"),
      });
      return { status: "left", channel: result.channel };
    },
    start_slack_reinstall: async () => {
      const result = await convex.action(api.actions.slackOAuth.begin, {
        clientOrgId: orgId,
        thirdPartyVisibilityAcknowledged: true,
      });
      if (result.url) window.open(result.url, "_blank", "noopener");
      return result.url
        ? {
            status: "authorization_opened",
            authorize_url: result.url,
            message: "A Slack workspace admin must approve the install on Slack's page.",
          }
        : { status: result.mockRefreshed ? "refreshed" : "no_action" };
    },
    disconnect_slack: async () => {
      const result = await convex.action(api.actions.slackOAuth.disconnect, { clientOrgId: orgId });
      return { status: result.disconnected ? "disconnected" : "not_connected" };
    },

    get_company_wiki: async () => wikiResult(await convex.query(api.orgWiki.get, { orgId })),
    save_company_wiki: async (input) =>
      wikiResult(
        await convex.mutation(api.orgWiki.save, {
          orgId,
          markdown: requiredText(input, "markdown"),
          expectedRevision: num(input, "expected_revision") ?? -1,
        }),
      ),
    resolve_wiki_suggestion: async (input) =>
      wikiResult(
        await convex.mutation(api.orgWiki.resolveProposal, {
          orgId,
          heading: requiredText(input, "heading"),
          accept: requiredBool(input, "accept"),
          expectedRevision: num(input, "expected_revision") ?? -1,
        }),
      ),
    get_certificate_workflow_settings: async () => {
      const settings = await convex.query(
        api.certificateWorkflowSettings.getEffectiveForCurrentOrg,
        {},
      );
      return {
        status: "ok",
        renewal_reissue_enabled: settings.renewalReissueEnabled,
        source: settings.source,
      };
    },
    set_certificate_renewal_reissue: async (input) => {
      await convex.mutation(api.certificateWorkflowSettings.updateClientOverride, {
        renewalReissueEnabled: requiredBool(input, "enabled"),
      });
      return { status: "updated" };
    },
    get_notification_preferences: async () => {
      const rows = await convex.query(api.notificationPreferences.getForUser, { orgId });
      return {
        status: "ok",
        notification_types: CLIENT_NOTIFICATION_TYPES,
        overrides: rows.map((row) => ({ type: row.type, channel: row.channel, enabled: row.enabled })),
        note: "Types without an override use Spot's defaults.",
      };
    },
    set_notification_channels: async (input) => {
      const type = requiredText(input, "type");
      if (!(CLIENT_NOTIFICATION_TYPES as readonly string[]).includes(type)) {
        return webMcpError("Unknown notification type.");
      }
      await convex.mutation(api.notificationPreferences.setChannels, {
        orgId,
        type,
        email: requiredBool(input, "email"),
        imessage: requiredBool(input, "imessage"),
      });
      return { status: "updated" };
    },
    reset_notification_channels: async (input) => {
      const type = requiredText(input, "type");
      if (type !== "all" && !(CLIENT_NOTIFICATION_TYPES as readonly string[]).includes(type)) {
        return webMcpError("Unknown notification type.");
      }
      await convex.mutation(
        api.notificationPreferences.resetChannels,
        compact({
          orgId,
          type: type === "all" ? "__all__" : type,
          channel: text(input, "channel") as "email" | "imessage" | undefined,
        }),
      );
      return { status: "reset" };
    },
    set_all_notification_channel: async (input) => {
      await convex.mutation(api.notificationPreferences.setAllChannel, {
        orgId,
        channel: requiredText(input, "channel") as "email" | "imessage",
        enabled: requiredBool(input, "enabled"),
      });
      return { status: "updated" };
    },
    list_connected_apps: async () => {
      const apps = await convex.query(api.oauth.listConnectedApps, {});
      return {
        status: "ok",
        apps: apps.map((app) => ({
          client_id: app.clientId,
          name: app.clientName,
          connected_at: isoTime(app.connectedAt),
        })),
      };
    },
    revoke_connected_app: async (input) => {
      await convex.mutation(api.oauth.revokeApp, { clientId: requiredText(input, "client_id") });
      return { status: "revoked" };
    },
    list_mailboxes: async () => ({
      status: "ok",
      mailboxes: (await convex.query(api.connectedEmail.list, { orgId })).map(mailboxRow),
    }),
    connect_mailbox: async (input) => {
      const mailboxId = await convex.action(
        api.actions.connectedEmail.connect,
        compact({
          orgId,
          emailAddress: requiredText(input, "email_address"),
          host: requiredText(input, "host"),
          port: num(input, "port") ?? 993,
          secure: bool(input, "secure") ?? true,
          username: requiredText(input, "username"),
          password: requiredText(input, "password"),
          scope: text(input, "scope") as "user" | "org" | undefined,
          label: text(input, "label"),
          automation: automationInput(input),
        }),
      );
      return { status: "connected", mailbox_id: mailboxId };
    },
    update_mailbox_settings: async (input) => {
      const automation = automationInput(input);
      if (!automation) return webMcpError("automation is required.");
      const mailbox = await convex.mutation(api.connectedEmail.updateSettings, {
        accountId: id<"connectedEmailAccounts">(input, "mailbox_id"),
        scope: requiredText(input, "scope") as "user" | "org",
        automation,
      });
      return { status: "updated", mailbox: mailboxRow(mailbox) };
    },
    scan_mailbox: async (input) => {
      const result = await convex.action(api.actions.connectedEmailScan.scanMailboxRange, {
        accountId: id<"connectedEmailAccounts">(input, "mailbox_id"),
        dateFrom: assertDate(requiredText(input, "date_from"), "date_from")!,
        dateTo: assertDate(requiredText(input, "date_to"), "date_to")!,
      });
      return { ...result, status: "scanned" };
    },
    disconnect_mailbox: async (input) => {
      await convex.mutation(api.connectedEmail.revoke, {
        accountId: id<"connectedEmailAccounts">(input, "mailbox_id"),
      });
      return { status: "disconnected" };
    },
    set_beta_feature: async (input) => {
      await convex.mutation(api.orgs.setFeatureFlag, {
        flagId: requiredText(input, "flag") as "connect_features" | "imessage_app_cards",
        enabled: requiredBool(input, "enabled"),
      });
      return { status: "updated" };
    },
    restart_onboarding: async () => {
      await convex.mutation(api.users.restartOnboarding, {});
      router.replace("/onboarding");
      return { status: "onboarding", next_url: "/onboarding", next_tool: "submit_user_profile" };
    },

    get_profile: async () => {
      const [viewer, proactive, pendingEmailChange] = await Promise.all([
        convex.query(api.users.viewer, {}),
        convex.query(api.notificationPreferences.getProactiveChannels, { orgId }),
        convex.query(api.users.getMyPendingEmailChange, {}),
      ]);
      if (!viewer) return webMcpError("Not signed in.");
      return {
        status: "ok",
        profile: {
          user_id: viewer._id,
          name: viewer.name ?? null,
          title: viewer.title ?? null,
          email: viewer.email ?? null,
          phone: viewer.phone ?? null,
          stream_responses: viewer.streamResponses ?? null,
          show_thinking: viewer.showThinking ?? null,
        },
        proactive_contact: { email: proactive.email, imessage: proactive.imessage },
        pending_email_change: pendingEmailChange
          ? {
              request_id: pendingEmailChange.requestId,
              new_email: pendingEmailChange.newEmail,
              expires_at: isoTime(pendingEmailChange.expiresAt),
            }
          : null,
      };
    },
    update_profile: async (input) => {
      const patch = compact({
        name: text(input, "name"),
        title: text(input, "title"),
        phone: typeof input.phone === "string" ? input.phone.trim() : undefined,
        streamResponses: bool(input, "stream_responses"),
        showThinking: bool(input, "show_thinking"),
      });
      if (Object.keys(patch).length === 0) return webMcpError("Provide at least one field.");
      await convex.mutation(api.users.updateProfile, patch);
      return { status: "updated" };
    },
    set_proactive_contact_channels: async (input) => {
      await convex.mutation(api.notificationPreferences.setProactiveChannels, {
        orgId,
        email: requiredBool(input, "email"),
        imessage: requiredBool(input, "imessage"),
      });
      return { status: "updated" };
    },
    request_email_change: async (input) => {
      const result = await convex.action(api.users.requestEmailChange, {
        email: requiredText(input, "email"),
      });
      return {
        status: "code_sent",
        request_id: result.requestId,
        new_email: result.newEmail,
        next_tool: "confirm_email_change",
      };
    },
    confirm_email_change: async (input) => {
      const result = await convex.mutation(api.users.confirmEmailChange, {
        requestId: id<"userEmailChangeRequests">(input, "request_id"),
        code: requiredText(input, "code"),
      });
      return { status: "changed", email: result.email };
    },
    cancel_email_change: async (input) => {
      await convex.mutation(api.users.cancelEmailChange, {
        requestId: id<"userEmailChangeRequests">(input, "request_id"),
      });
      return { status: "cancelled" };
    },
    get_imessage_history_deletion_state: async () => ({
      status: "ok",
      state: await convex.query(api.imessagePrivacy.getPersonalImessageDeletionState, {}),
    }),
    prepare_imessage_history_deletion: async () => {
      const result = await convex.mutation(
        api.imessagePrivacy.preparePersonalImessageDeletionPreview,
        {},
      );
      return {
        status: "preparing",
        preview_job_id: result.previewJobId,
        next_tool: "get_imessage_history_deletion_state",
      };
    },
    delete_imessage_history: async (input) => {
      const result = await convex.mutation(api.imessagePrivacy.requestPersonalImessageDeletion, {
        previewJobId: id<"imessageHistoryDeletionJobs">(input, "preview_job_id"),
      });
      return { status: "deleting", deletion_job_id: result.deletionJobId };
    },
  };
}

