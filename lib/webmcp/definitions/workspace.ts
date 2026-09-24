import { imperative, param, schema } from "@/lib/webmcp/types";

export const WEBMCP_CLIENT_PAGES = [
  "policies",
  "certificates",
  "compliance",
  "requests",
  "files",
  "agent",
  "connect",
  "settings",
  "profile",
] as const;

export const SETTINGS_SECTIONS = [
  "organization",
  "team",
  "agent",
  "workflows",
  "integrations",
  "mailboxes",
  "beta",
] as const;

/** Navigation, session, and notification tools on every client page. */
export const workspaceTools = {
  open_spot_page: imperative({
    title: "Open Spot page",
    description:
      "Navigate the workspace to a page. Most write and account tools register only on their page (for example create_insurance_request on requests, invite_team_member on settings), so open the page first.",
    readOnly: false,
    inputSchema: schema(
      {
        page: param.enum(WEBMCP_CLIENT_PAGES, "Workspace page to open."),
        record_id: param.string(
          "Optional record to open: policy ID (policies), request ID (requests), thread ID (agent), or vendor org ID (connect).",
        ),
        settings_section: param.enum(
          SETTINGS_SECTIONS,
          "Optional settings section when page is settings.",
        ),
      },
      ["page"],
    ),
  }),
  start_spot_agent_thread: imperative({
    title: "Ask the Spot agent",
    description:
      "Start a new Spot agent conversation with a question or task and open it. The agent's reply appears in the thread; read it with get_agent_thread. Agent-drafted emails can then be sent with send_email_draft.",
    readOnly: false,
    consequential: true,
    inputSchema: schema(
      { message: param.string("The question or task for the Spot agent.") },
      ["message"],
    ),
  }),
  list_agent_threads: imperative({
    title: "List agent threads",
    description:
      "List the signed-in person's Spot agent conversations (web, email, Slack, iMessage) with title, channel, and last update.",
    readOnly: true,
    inputSchema: schema({
      archived: param.boolean("List archived threads instead of active ones."),
    }),
  }),
  list_notifications: imperative({
    title: "List notifications",
    description:
      "List the signed-in person's Spot notifications (compliance gaps, expiring vendor policies, mailbox items, extraction reviews) with read state and links.",
    readOnly: true,
    inputSchema: schema({
      status: param.enum(["unread", "read", "actioned"], "Optional status filter."),
      limit: param.integer("Maximum notifications (default 50).", { minimum: 1, maximum: 100 }),
    }),
  }),
  mark_notifications_read: imperative({
    title: "Mark notifications read",
    description: "Mark specific notifications as read.",
    readOnly: false,
    inputSchema: schema(
      { notification_ids: param.stringArray("Notification IDs from list_notifications.") },
      ["notification_ids"],
    ),
  }),
  mark_all_notifications_read: imperative({
    title: "Mark all notifications read",
    description: "Mark every notification for the signed-in person as read.",
    readOnly: false,
    inputSchema: schema(),
  }),
  set_theme: imperative({
    title: "Set theme",
    description: "Switch the app between light, dark, or system appearance on this browser.",
    readOnly: false,
    inputSchema: schema(
      { theme: param.enum(["light", "dark", "system"], "Appearance.") },
      ["theme"],
    ),
  }),
  sign_out: imperative({
    title: "Sign out",
    description:
      "Sign the current person out of Spot on this browser. All signed-in tools unregister; signing back in needs a new emailed code.",
    readOnly: false,
    inputSchema: schema(),
  }),
};
