import type { OperatorAgentToolName } from "./operatorAgentToolRegistry";

/**
 * Versioned parity contract for every procurement operation exposed by the
 * operator browser. Web controls and every Spot-agent channel call the same
 * domain services; transport-only differences are called out explicitly.
 */
export const PROCUREMENT_CAPABILITY_MANIFEST_VERSION = 1;

type AgentBackedCapability = {
  id: string;
  browserSurface: string;
  agentTools: readonly OperatorAgentToolName[];
};

type CapabilityException = {
  id: string;
  browserSurface: string;
  exception: {
    owner: "procurement-platform";
    reason: string;
  };
};

export const PROCUREMENT_CAPABILITIES = [
  {
    id: "client.create",
    browserSurface: "operator client create drawer",
    agentTools: ["create_client_organization"],
  },
  {
    id: "request.read",
    browserSurface: "request workbench",
    agentTools: ["list_procurement_requests", "get_procurement_request"],
  },
  {
    id: "request.write",
    browserSurface: "request create and edit drawers",
    agentTools: ["create_procurement_request", "update_procurement_request"],
  },
  {
    id: "packet.read_write",
    browserSurface: "packet section workspace",
    agentTools: [
      "lookup_procurement_packet",
      "update_procurement_packet_section",
    ],
  },
  {
    id: "packet.resolve_generated_change",
    browserSurface: "packet proposed-section accept and reject controls",
    exception: {
      owner: "procurement-platform",
      reason:
        "The agent writes a confirmed section directly; accept/reject only resolves browser-generated draft state and has no separate agent business intent.",
    },
  },
  {
    id: "packet.share",
    browserSurface: "market navigation link regeneration control",
    agentTools: [
      "preview_broker_packet",
      "create_broker_packet_link",
      "list_broker_packet_links",
      "rotate_broker_packet_link",
      "revoke_broker_packet_link",
    ],
  },
  {
    id: "broker.directory",
    browserSurface: "market broker selector and profile drawers",
    agentTools: [
      "list_broker_network_profiles",
      "get_broker_network_profile",
      "create_broker_network_profile",
      "update_broker_network_profile",
    ],
  },
  {
    id: "outreach.write",
    browserSurface: "market outreach drawer",
    agentTools: [
      "create_procurement_broker_outreach",
      "update_procurement_broker_outreach",
    ],
  },
  {
    id: "artifact.classify_link",
    browserSurface: "request files workspace and upload drawer",
    agentTools: [
      "list_client_files",
      "add_client_file",
      "create_procurement_file_item",
      "update_procurement_file_item",
    ],
  },
  {
    id: "correspondence.read_update",
    browserSurface: "imported email workspace",
    agentTools: [
      "get_procurement_forwarding_address",
      "list_procurement_email_threads",
      "get_procurement_email_thread",
      "preview_procurement_email_reconciliation",
      "update_procurement_email_thread",
    ],
  },
  {
    id: "proposal.file",
    browserSurface: "broker outreach proposal dropzone",
    agentTools: ["file_procurement_proposal", "file_procurement_email_quote"],
  },
  {
    id: "proposal.inspect_review_select",
    browserSurface: "proposal table and review drawer",
    agentTools: [
      "list_procurement_proposals",
      "get_procurement_proposal",
      "generate_procurement_proposal_review",
      "confirm_procurement_proposal_review",
      "select_procurement_proposal",
    ],
  },
  {
    id: "proposal.lifecycle",
    browserSurface: "proposal extraction and archive controls",
    agentTools: [
      "archive_procurement_proposal",
      "retry_procurement_proposal_extraction",
      "cancel_procurement_proposal_extraction",
      "list_extraction_issues",
    ],
  },
] as const satisfies readonly (AgentBackedCapability | CapabilityException)[];

export const PROCUREMENT_CAPABILITY_EXCEPTIONS =
  PROCUREMENT_CAPABILITIES.filter(
    (
      capability,
    ): capability is (typeof PROCUREMENT_CAPABILITIES)[number] &
      CapabilityException => "exception" in capability,
  );
