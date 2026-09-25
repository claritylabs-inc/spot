export const MCP_CHAT_WRITE_TOOL_NAMES = new Set([
  "import_requirement_attachments",
  "save_note",
  "confirm_policy_fact",
  "generate_coi",
  "update_company_wiki",
  "create_compliance_requirement",
  "create_imessage_group_chat",
  "import_connected_email_policy_attachments",
  "import_connected_email_requirement_attachments",
  "send_connected_vendor_invite",
]);

export const MAILBOX_COORDINATOR_WRITE_TOOL_NAMES = new Set([
  "import_connected_email_policy_attachments",
  "import_connected_email_requirement_attachments",
  "save_connected_email_attachments_to_thread",
  "save_connected_email_message_to_thread",
  "send_connected_vendor_invite",
]);

export function filterToolsForWriteAccess<T extends Record<string, unknown>>(
  tools: T,
  canWrite: boolean | undefined,
  writeToolNames: ReadonlySet<string>,
): Partial<T> {
  if (canWrite !== false) return tools;
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => !writeToolNames.has(name)),
  ) as Partial<T>;
}
