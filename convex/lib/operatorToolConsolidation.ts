import type { OperatorAgentToolName } from "./operatorAgentToolRegistry";

/** Adapt only at execution/preflight; approvals and audits bind the original call. */
export function resolveOperatorToolDispatch(
  toolName: OperatorAgentToolName,
  input: Record<string, unknown>,
): { toolName: OperatorAgentToolName; input: Record<string, unknown> } {
  switch (toolName) {
    case "attach_to_conversation":
      switch (input.source) {
        case "policy":
          return {
            toolName: "attach_policy_document",
            input: { orgId: input.orgId, policyId: input.policyId },
          };
        case "clientFile":
          return {
            toolName: "attach_client_file",
            input: { clientFileId: input.clientFileId },
          };
        case "threadAttachment":
          return {
            toolName: "read_thread_attachment",
            input: { messageId: input.messageId, filename: input.filename },
          };
        case "emailAttachment":
          return {
            toolName: "get_company_email_attachment",
            input: {
              mailbox: input.mailbox,
              messageId: input.messageId,
              attachmentId: input.attachmentId,
            },
          };
        default:
          throw new Error("Unknown conversation attachment source");
      }
    case "get_procurement_packet":
      return {
        toolName: input.view === "provider"
          ? "preview_broker_packet" : "lookup_procurement_packet",
        input,
      };
    case "manage_broker_packet_link":
      switch (input.action) {
        case "create":
          return { toolName: "create_broker_packet_link", input };
        case "rotate":
          return { toolName: "rotate_broker_packet_link", input };
        case "revoke":
          return { toolName: "revoke_broker_packet_link", input };
        default:
          throw new Error("Unknown packet link action");
      }
    case "control_proposal_extraction":
      switch (input.action) {
        case "retry":
          return { toolName: "retry_procurement_proposal_extraction", input };
        case "cancel":
          return { toolName: "cancel_procurement_proposal_extraction", input };
        default:
          throw new Error("Unknown extraction action");
      }
    case "research_client":
      if (Array.isArray(input.orgIds))
        return { toolName: "research_client_profiles", input };
      break;
    case "file_procurement_proposal":
      if (input.procurementEmailThreadId)
        return { toolName: "file_procurement_email_quote", input };
  }
  return { toolName, input };
}
