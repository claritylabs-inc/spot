import { describe, expect, test } from "vitest";
import {
  filterToolsForWriteAccess,
  MCP_CHAT_WRITE_TOOL_NAMES,
} from "./mcpAgentToolAccess";

function namedTools(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, { name }]));
}

describe("MCP nested agent tool access", () => {
  test("removes every MCP-chat business write for read-only tokens", () => {
    const tools = namedTools(["lookup_policy", ...MCP_CHAT_WRITE_TOOL_NAMES]);
    const filtered = filterToolsForWriteAccess(
      tools,
      false,
      MCP_CHAT_WRITE_TOOL_NAMES,
    );

    expect(Object.keys(filtered).sort()).toEqual(["lookup_policy"]);
  });

  test("allows draft listing but removes all email writes for read-only MCP", () => {
    const writes = [
      "draft_email",
      "update_email_draft",
      "attach_policy_pdf_to_draft",
      "attach_file_to_draft",
      "attach_coi_to_draft",
      "send_email_draft",
      "cancel_email_draft",
    ];
    const tools = namedTools(["list_email_drafts", ...writes]);
    expect(
      Object.keys(
        filterToolsForWriteAccess(tools, false, MCP_CHAT_WRITE_TOOL_NAMES),
      ),
    ).toEqual(["list_email_drafts"]);
    expect(
      filterToolsForWriteAccess(tools, true, MCP_CHAT_WRITE_TOOL_NAMES),
    ).toEqual(tools);
  });

  test("limits a read-only mailbox family to mailbox reads", () => {
    const readTools = [
      "search_connected_email",
      "read_connected_email",
      "read_connected_email_attachment",
    ];
    const tools = namedTools([...readTools, ...MCP_CHAT_WRITE_TOOL_NAMES]);

    expect(
      Object.keys(
        filterToolsForWriteAccess(tools, false, MCP_CHAT_WRITE_TOOL_NAMES),
      ).sort(),
    ).toEqual(readTools.sort());
  });
});
