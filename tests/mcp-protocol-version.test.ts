import { describe, expect, it } from "vitest";
import {
  LATEST_MCP_PROTOCOL_VERSION,
  negotiateMcpProtocolVersion,
} from "../convex/lib/mcpProtocol";

describe("MCP protocol version negotiation", () => {
  it("echoes a revision the server supports", () => {
    expect(negotiateMcpProtocolVersion("2025-11-25")).toBe("2025-11-25");
    expect(negotiateMcpProtocolVersion("2025-06-18")).toBe("2025-06-18");
    expect(negotiateMcpProtocolVersion("2025-03-26")).toBe("2025-03-26");
    expect(negotiateMcpProtocolVersion("2024-11-05")).toBe("2024-11-05");
  });

  it("falls back to the newest supported revision for anything else", () => {
    for (const requested of [
      "2099-01-01",
      "2024-10-07",
      "",
      undefined,
      null,
      42,
      { protocolVersion: "2025-11-25" },
    ]) {
      expect(negotiateMcpProtocolVersion(requested)).toBe(
        LATEST_MCP_PROTOCOL_VERSION,
      );
    }
  });
});
