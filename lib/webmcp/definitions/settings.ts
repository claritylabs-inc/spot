import { fileParams, imperative, param, schema } from "@/lib/webmcp/types";

const SETTINGS_PAGES = ["/settings"];
const PROFILE_PAGES = ["/profile"];
const membershipId = param.string("Membership ID from list_team_members.");
const slackChannelId = param.string("Slack channel ID from list_slack_channels.");
const mailboxId = param.string("Mailbox ID from list_mailboxes.");
const automation = param.object(
  "What Spot does with new mail.",
  {
    policy_imports: param.boolean("Import policy documents."),
    requirement_imports: param.boolean("Import insurance requirements."),
    company_memory: param.boolean("Learn company facts."),
  },
  ["policy_imports", "requirement_imports", "company_memory"],
);

export const CLIENT_NOTIFICATION_TYPES = [
  "mailbox_attention",
  "own_compliance_gap",
  "own_compliance_resolved",
  "incomplete_extraction",
  "vendor_compliance_gap",
  "vendor_policy_expiring",
  "vendor_policy_expired",
  "vendor_compliance_met",
] as const;

/** Organization settings (/settings) and personal profile (/profile). */
export const settingsTools = {
  get_organization: imperative({
    title: "Get organization",
    description: "Read the client organization's name, website, logo, agent email, and the signed-in person's role.",
    readOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  update_organization: imperative({
    title: "Update organization",
    description: "Change the organization's name or website. Changing either refreshes company research.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({
      name: param.string("Optional new organization name."),
      website: param.string("Optional new website."),
    }),
  }),
  research_company: imperative({
    title: "Research company",
    description:
      "Queue Spot's web research of the company. Research writes sourced company facts to the company wiki (read it with get_company_wiki) and fills in the website if it is missing.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({ website: param.string("Optional website; defaults to the saved one.") }),
  }),
  upload_organization_logo: imperative({
    title: "Upload organization logo",
    description: "Replace the organization logo with an uploaded image.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(fileParams, ["file_name", "content_type", "content_base64"]),
  }),
  import_logo_from_website: imperative({
    title: "Import logo from website",
    description: "Set the organization logo from a website's icon.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({ url: param.string("Website URL.") }, ["url"]),
  }),
  update_agent_email_settings: imperative({
    title: "Update agent email settings",
    description:
      "Change how the Spot agent handles email: email notifications for chat replies, BCC the requester on agent emails, and the send delay before agent emails go out.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({
      chat_email_notifications: param.boolean("Email people when the agent replies in chat."),
      bcc_requester_on_agent_emails: param.boolean("BCC the requesting teammate on agent emails."),
      send_delay_seconds: param.integer("Seconds before a sent agent email goes out (0, 3, 5, 10, or 15).", {
        enum: [0, 3, 5, 10, 15],
      }),
    }),
  }),

  list_team_members: imperative({
    title: "List team members",
    description: "List the organization's members with role, contact details, and activation state.",
    readOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  list_team_invitations: imperative({
    title: "List team invitations",
    description: "List pending teammate invitations.",
    readOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  invite_team_member: imperative({
    title: "Invite team member",
    description:
      "Invite a teammate by email as admin or member; Spot emails them a sign-in link. Inviting a pending address again resends it.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      { email: param.string("Teammate email."), role: param.enum(["admin", "member"], "Role.") },
      ["email", "role"],
    ),
  }),
  cancel_team_invitation: imperative({
    title: "Cancel team invitation",
    description: "Delete a pending teammate invitation.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      { invitation_id: param.string("Invitation ID from list_team_invitations.") },
      ["invitation_id"],
    ),
  }),
  change_member_role: imperative({
    title: "Change member role",
    description: "Make a teammate an admin or member. The last admin cannot be demoted.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      { membership_id: membershipId, role: param.enum(["admin", "member"], "New role.") },
      ["membership_id", "role"],
    ),
  }),
  remove_team_member: imperative({
    title: "Remove team member",
    description: "Remove a teammate from the organization. The last admin cannot be removed.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({ membership_id: membershipId }, ["membership_id"]),
  }),
  update_team_member_profile: imperative({
    title: "Update team member profile",
    description: "Change a teammate's name, title, or mobile number.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        membership_id: membershipId,
        name: param.string("Optional name."),
        title: param.string("Optional job title."),
        phone: param.string("Optional mobile number in international format."),
      },
      ["membership_id"],
    ),
  }),
  set_primary_insurance_contact: imperative({
    title: "Set primary insurance contact",
    description: "Choose which teammate is the organization's primary insurance contact.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({ user_id: param.string("User ID from list_team_members.") }, ["user_id"]),
  }),
  request_member_email_change: imperative({
    title: "Request member email change",
    description:
      "Start changing a teammate's sign-in email. Spot emails a code to the new address; the teammate confirms it.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      { membership_id: membershipId, email: param.string("New email address.") },
      ["membership_id", "email"],
    ),
  }),
  cancel_member_email_change: imperative({
    title: "Cancel member email change",
    description: "Cancel a teammate's pending email change.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        membership_id: membershipId,
        request_id: param.string("Pending email change request ID from list_team_members."),
      },
      ["membership_id", "request_id"],
    ),
  }),

  get_agent_channels: imperative({
    title: "Get agent channels",
    description:
      "Read the Spot agent's email, iMessage, and Slack channel settings, agent email address, and Slack connection health.",
    readOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  update_agent_channels: imperative({
    title: "Update agent channels",
    description: "Turn agent channels and Slack alerts on or off. Omitted values keep their current setting.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({
      email_enabled: param.boolean("Agent answers by email."),
      imessage_enabled: param.boolean("Agent answers by iMessage."),
      slack_enabled: param.boolean("Agent answers in Slack."),
      slack_safe_alerts_enabled: param.boolean("Post safe alerts to Slack."),
      slack_vendor_alerts_enabled: param.boolean("Post vendor alerts to Slack."),
    }),
  }),
  list_slack_channels: imperative({
    title: "List Slack channels",
    description: "List the connected Slack workspace's public channels and which ones Spot has joined.",
    readOnly: true,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  select_slack_channel: imperative({
    title: "Select Slack alert channel",
    description: "Choose the joined Slack channel Spot posts automatic updates to.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({ channel_id: slackChannelId }, ["channel_id"]),
  }),
  join_slack_channel: imperative({
    title: "Add Spot to Slack channel",
    description: "Add the Spot bot to a public Slack channel.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({ channel_id: slackChannelId }, ["channel_id"]),
  }),
  leave_slack_channel: imperative({
    title: "Remove Spot from Slack channel",
    description: "Remove the Spot bot from a Slack channel.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({ channel_id: slackChannelId }, ["channel_id"]),
  }),
  start_slack_reinstall: imperative({
    title: "Start Slack reinstall",
    description:
      "Start reinstalling a degraded or revoked Slack connection. Returns the Slack authorization URL and opens it; a Slack workspace admin approves there.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  disconnect_slack: imperative({
    title: "Disconnect Slack",
    description: "Uninstall Spot from the Slack workspace. Reconnecting needs a new install.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),

  get_company_wiki: imperative({
    title: "Get company wiki",
    description:
      "Read the company wiki Markdown the Spot agent uses as company context, with its revision and pending suggestions.",
    readOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  save_company_wiki: imperative({
    title: "Save company wiki",
    description:
      "Replace the company wiki Markdown. Pass the revision from get_company_wiki; a stale revision is rejected. Keep the YAML front matter.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        markdown: param.string("Full wiki Markdown including YAML front matter."),
        expected_revision: param.integer("Revision from get_company_wiki."),
      },
      ["markdown", "expected_revision"],
    ),
  }),
  resolve_wiki_suggestion: imperative({
    title: "Resolve wiki suggestion",
    description: "Apply or dismiss one suggested company wiki change.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        heading: param.string("Suggestion heading from get_company_wiki."),
        accept: param.boolean("true applies, false dismisses."),
        expected_revision: param.integer("Revision from get_company_wiki."),
      },
      ["heading", "accept", "expected_revision"],
    ),
  }),
  get_notification_preferences: imperative({
    title: "Get notification preferences",
    description: "Read the signed-in person's email and iMessage settings for each notification type.",
    readOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  set_notification_channels: imperative({
    title: "Set notification channels",
    description: "Choose email and iMessage delivery for one notification type (for the signed-in person).",
    readOnly: false,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        type: param.enum(CLIENT_NOTIFICATION_TYPES, "Notification type."),
        email: param.boolean("Deliver by email."),
        imessage: param.boolean("Deliver by iMessage."),
      },
      ["type", "email", "imessage"],
    ),
  }),
  reset_notification_channels: imperative({
    title: "Reset notification channels",
    description: "Restore default delivery for one notification type, or for all types.",
    readOnly: false,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        type: param.enum([...CLIENT_NOTIFICATION_TYPES, "all"], "Notification type, or all."),
        channel: param.enum(["email", "imessage"], "Optional single channel to reset."),
      },
      ["type"],
    ),
  }),
  set_all_notification_channel: imperative({
    title: "Set channel for all notifications",
    description: "Turn email or iMessage delivery on or off for every notification type.",
    readOnly: false,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        channel: param.enum(["email", "imessage"], "Channel."),
        enabled: param.boolean("On or off."),
      },
      ["channel", "enabled"],
    ),
  }),
  list_connected_apps: imperative({
    title: "List connected apps",
    description: "List AI apps and MCP clients the signed-in person has authorized with OAuth.",
    readOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  revoke_connected_app: imperative({
    title: "Revoke connected app",
    description: "Revoke every OAuth token the signed-in person granted to one connected app.",
    readOnly: false,
    consequential: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      { client_id: param.string("Client ID from list_connected_apps.") },
      ["client_id"],
    ),
  }),
  list_mailboxes: imperative({
    title: "List mailboxes",
    description: "List connected IMAP mailboxes Spot scans, with scope, automation, and status.",
    readOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),
  connect_mailbox: imperative({
    title: "Connect mailbox",
    description:
      "Connect an IMAP mailbox (Gmail: imap.gmail.com:993 with an app password; Outlook: outlook.office365.com:993) so Spot can scan it. Organization-wide mailboxes need admin.",
    readOnly: false,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        email_address: param.string("Mailbox address."),
        host: param.string("IMAP host."),
        port: param.integer("IMAP port, usually 993."),
        secure: param.boolean("Use TLS (true for port 993)."),
        username: param.string("IMAP username, usually the address."),
        password: param.string("IMAP password or app password."),
        scope: param.enum(["user", "org"], "Personal or organization-wide (default user)."),
        label: param.string("Optional label."),
        automation,
      },
      ["email_address", "host", "port", "secure", "username", "password"],
    ),
  }),
  update_mailbox_settings: imperative({
    title: "Update mailbox settings",
    description: "Change a mailbox's scope and what Spot does with new mail.",
    readOnly: false,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        mailbox_id: mailboxId,
        scope: param.enum(["user", "org"], "Personal or organization-wide."),
        automation,
      },
      ["mailbox_id", "scope", "automation"],
    ),
  }),
  scan_mailbox: imperative({
    title: "Scan mailbox",
    description: "Scan a date range of a connected mailbox for policies and requirements now.",
    readOnly: false,
    consequential: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        mailbox_id: mailboxId,
        date_from: param.date("Start date"),
        date_to: param.date("End date"),
      },
      ["mailbox_id", "date_from", "date_to"],
    ),
  }),
  disconnect_mailbox: imperative({
    title: "Disconnect mailbox",
    description: "Disconnect a mailbox. Reconnecting needs the password again.",
    readOnly: false,
    consequential: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema({ mailbox_id: mailboxId }, ["mailbox_id"]),
  }),
  set_beta_feature: imperative({
    title: "Set beta feature",
    description: "Turn a beta feature on or off for the organization.",
    readOnly: false,
    adminOnly: true,
    pages: SETTINGS_PAGES,
    inputSchema: schema(
      {
        flag: param.enum(["connect_features"], "Beta feature."),
        enabled: param.boolean("On or off."),
      },
      ["flag", "enabled"],
    ),
  }),
  restart_onboarding: imperative({
    title: "Restart onboarding",
    description: "Re-run account setup (profile and company). Opens onboarding, where the onboarding form tools apply.",
    readOnly: false,
    pages: SETTINGS_PAGES,
    inputSchema: schema(),
  }),

  get_profile: imperative({
    title: "Get profile",
    description:
      "Read the signed-in person's name, title, email, phone, chat preferences, proactive contact channels, and any pending email change.",
    readOnly: true,
    pages: PROFILE_PAGES,
    inputSchema: schema(),
  }),
  update_profile: imperative({
    title: "Update profile",
    description: "Change the signed-in person's name, title, mobile number, or chat preferences. An empty phone clears it.",
    readOnly: false,
    pages: PROFILE_PAGES,
    inputSchema: schema({
      name: param.string("Optional name."),
      title: param.string("Optional job title."),
      phone: param.string("Optional mobile number in international format; empty string clears it."),
      stream_responses: param.boolean("Stream agent replies as they are written."),
      show_thinking: param.boolean("Show the agent's progress steps."),
    }),
  }),
  set_proactive_contact_channels: imperative({
    title: "Set proactive contact channels",
    description: "Choose how Spot contacts the signed-in person proactively: email, iMessage (needs a phone), or both.",
    readOnly: false,
    pages: PROFILE_PAGES,
    inputSchema: schema(
      { email: param.boolean("Contact by email."), imessage: param.boolean("Contact by iMessage.") },
      ["email", "imessage"],
    ),
  }),
  request_email_change: imperative({
    title: "Request email change",
    description: "Start changing the signed-in person's email. Spot emails a 6-digit code to the new address.",
    readOnly: false,
    consequential: true,
    pages: PROFILE_PAGES,
    inputSchema: schema({ email: param.string("New email address.") }, ["email"]),
  }),
  confirm_email_change: imperative({
    title: "Confirm email change",
    description:
      "Finish an email change with the code sent to the new address. The new email becomes the sign-in email.",
    readOnly: false,
    consequential: true,
    pages: PROFILE_PAGES,
    inputSchema: schema(
      {
        request_id: param.string("Request ID from request_email_change or get_profile."),
        code: param.string("6-digit code from the new inbox."),
      },
      ["request_id", "code"],
    ),
  }),
  cancel_email_change: imperative({
    title: "Cancel email change",
    description: "Cancel a pending email change.",
    readOnly: false,
    pages: PROFILE_PAGES,
    inputSchema: schema({ request_id: param.string("Request ID.") }, ["request_id"]),
  }),
  get_imessage_history_deletion_state: imperative({
    title: "Get iMessage history deletion state",
    description: "Read the state of iMessage history deletion: preview readiness, what would be deleted, and past deletions.",
    readOnly: true,
    pages: PROFILE_PAGES,
    inputSchema: schema(),
  }),
  prepare_imessage_history_deletion: imperative({
    title: "Prepare iMessage history deletion",
    description: "Build a preview of the signed-in person's iMessage history that would be deleted.",
    readOnly: false,
    pages: PROFILE_PAGES,
    inputSchema: schema(),
  }),
  delete_imessage_history: imperative({
    title: "Delete iMessage history",
    description:
      "Permanently delete the signed-in person's iMessage history with Spot, using a ready preview. Cannot be undone.",
    readOnly: false,
    consequential: true,
    pages: PROFILE_PAGES,
    inputSchema: schema(
      { preview_job_id: param.string("Preview job ID from prepare_imessage_history_deletion.") },
      ["preview_job_id"],
    ),
  }),
};
