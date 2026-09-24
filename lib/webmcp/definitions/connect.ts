import { imperative, param, schema } from "@/lib/webmcp/types";

const CONNECT_PAGES = ["/connect"];
const relationshipId = param.string("Relationship ID from list_vendors or list_connected_clients.");
const invitationId = param.string("Invitation ID from list_vendors.");

/** Vendor and client connections (/connect) and public token pages. */
export const connectTools = {
  list_vendors: imperative({
    title: "List vendors",
    description:
      "List vendors connected to (or invited by) the client, with relationship and invitation status.",
    readOnly: true,
    pages: CONNECT_PAGES,
    inputSchema: schema(),
  }),
  list_connected_clients: imperative({
    title: "List connected clients",
    description:
      "List organizations that requested or have access to this business's insurance as their vendor.",
    readOnly: true,
    pages: CONNECT_PAGES,
    inputSchema: schema(),
  }),
  list_vendor_compliance: imperative({
    title: "List vendor compliance",
    description:
      "Summarize each connected vendor's compliance against the client's vendor requirements: met, missing, and expiring counts.",
    readOnly: true,
    pages: [...CONNECT_PAGES, "/compliance"],
    inputSchema: schema(),
  }),
  list_vendor_policies: imperative({
    title: "List vendor policies",
    description:
      "List a connected vendor's policies (read-only access granted by the vendor). Use get_policy for details.",
    readOnly: true,
    pages: CONNECT_PAGES,
    inputSchema: schema(
      { vendor_org_id: param.string("Vendor organization ID from list_vendors.") },
      ["vendor_org_id"],
    ),
  }),
  request_vendor_access: imperative({
    title: "Request vendor access",
    description:
      "Invite a vendor by email to share its insurance with the client. Spot emails the vendor an access request link.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: CONNECT_PAGES,
    inputSchema: schema(
      {
        vendor_email: param.string("Vendor contact email."),
        relationship_label: param.string("Optional label, for example Cleaning contractor."),
        note: param.string("Optional note included in the request."),
      },
      ["vendor_email"],
    ),
  }),
  resend_vendor_invitation: imperative({
    title: "Resend vendor invitation",
    description: "Email a pending vendor invitation again with a fresh link (the old link stops working).",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: CONNECT_PAGES,
    inputSchema: schema({ invitation_id: invitationId }, ["invitation_id"]),
  }),
  cancel_vendor_invitation: imperative({
    title: "Cancel vendor invitation",
    description: "Cancel a pending vendor invitation; its link stops working.",
    readOnly: false,
    adminOnly: true,
    pages: CONNECT_PAGES,
    inputSchema: schema({ invitation_id: invitationId }, ["invitation_id"]),
  }),
  approve_connection: imperative({
    title: "Approve connection",
    description:
      "Approve a client's request to view this business's insurance; they get read-only access to its policies.",
    readOnly: false,
    adminOnly: true,
    pages: CONNECT_PAGES,
    inputSchema: schema({ relationship_id: relationshipId }, ["relationship_id"]),
  }),
  revoke_connection: imperative({
    title: "Revoke connection",
    description:
      "End a vendor or client connection and stop sharing. Cannot be undone; reconnecting needs a new request.",
    readOnly: false,
    consequential: true,
    adminOnly: true,
    pages: CONNECT_PAGES,
    inputSchema: schema({ relationship_id: relationshipId }, ["relationship_id"]),
  }),

  get_vendor_invitation: imperative({
    title: "Get vendor invitation",
    description:
      "Read the insurance-sharing request on this invitation page: which client is asking, for which email, and its status.",
    readOnly: true,
    audience: "public",
    pages: ["/connect/request"],
    inputSchema: schema(),
  }),
  accept_vendor_invitation: imperative({
    title: "Accept vendor invitation",
    description:
      "Accept this insurance-sharing request as the signed-in person, creating a vendor workspace if needed. Sign in first (the page emails a code to the invited address).",
    readOnly: false,
    audience: "public",
    pages: ["/connect/request"],
    inputSchema: schema(),
  }),
  get_shared_packet: imperative({
    title: "Get shared request packet",
    description:
      "Read the insurance request packet shared on this page: request details (Markdown) and released files with download links.",
    readOnly: true,
    untrustedContent: true,
    audience: "public",
    pages: ["/share/packet"],
    inputSchema: schema(),
  }),
  get_shared_email_draft: imperative({
    title: "Get shared email draft",
    description: "Read the email draft shared for review on this page: recipients, subject, body, and attachments.",
    readOnly: true,
    audience: "public",
    pages: ["/share/email"],
    inputSchema: schema(),
  }),
  send_shared_email_draft: imperative({
    title: "Send shared email draft",
    description: "Send the email draft shared on this page, exactly as shown. Sending cannot be undone.",
    readOnly: false,
    consequential: true,
    audience: "public",
    pages: ["/share/email"],
    inputSchema: schema(),
  }),
  get_shared_card: imperative({
    title: "Get shared policy card",
    description: "Read the policy or certificate card shared on this page.",
    readOnly: true,
    audience: "public",
    pages: ["/share/imessage"],
    inputSchema: schema(),
  }),
  get_model_routing_report: imperative({
    title: "Get model routing report",
    description: "Read which AI model and provider Spot currently uses for each task.",
    readOnly: true,
    audience: "public",
    pages: ["/weather"],
    inputSchema: schema(),
  }),
};
