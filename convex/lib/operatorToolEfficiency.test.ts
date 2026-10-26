import { describe, expect, it } from "vitest";
import { activeAgentToolNames, expandToolsSpec } from "./agentToolSelection";
import {
  boundToolOutput,
  boundToolHistory,
  sanitizeOperatorReply,
} from "./operatorToolOutput";
import { operatorRunFailureReason } from "./operatorAgentToolFailure";
import { buildOperatorMcpToolCatalog } from "./operatorMcpToolCatalog";

const catalog = {
  organizations: { description: "organizations", tools: ["get_organization"] },
  platform: {
    description: "platform",
    tools: ["list_operators", "invite_operator"],
  },
  wiki: { description: "wiki", tools: ["lookup_client_wiki"] },
};

describe("tool discovery boundaries", () => {
  it("normalizes expansion aliases and tool names while rejecting unavailable families", () => {
    const schema = expandToolsSpec(catalog, [
      "organizations",
      "platform",
    ]).inputSchema;
    for (const input of [
      { families: "organizations" },
      { family: "organizations" },
      { tool_families: ["get_organization"] },
      { tools: "get_organization" },
    ])
      expect(schema.parse(input)).toEqual({ families: ["organizations"] });
    expect(() => schema.parse({ family: "missing" })).toThrow(
      /organizations.*platform/,
    );
    expect(() => schema.parse({ tools: ["lookup_client_wiki"] })).toThrow(
      /organizations.*platform/,
    );
  });

  it("adds only available dependency lookups, without loading unrelated writes", () => {
    expect(
      activeAgentToolNames(
        catalog,
        ["get_organization", "list_operators", "invite_operator"],
        ["organizations"],
      ),
    ).toEqual(["get_organization", "list_operators"]);
    expect(
      activeAgentToolNames(catalog, ["get_organization"], ["organizations"]),
    ).toEqual(["get_organization"]);
  });

  it("excludes disabled integration tools from MCP", () => {
    const names = buildOperatorMcpToolCatalog({
      canWrite: true,
      operatorRole: "owner",
      toolNames: ["get_organization"],
    }).map(({ name }) => name);
    expect(names).toContain("get_organization");
    expect(names).not.toContain("search_company_email");
    expect(names).not.toContain("send_slack_message");
    expect(names).toContain("run_operator_task");
  });
});

describe("model payload and reply boundaries", () => {
  it("bounds large outputs while preserving failure state and continuation", () => {
    const result = boundToolOutput(
      {
        status: "failed",
        failure: { writeState: "unknown", recoverable: false },
        nextCursor: "cursor:unchanged",
        rows: Array.from({ length: 200 }, (_, i) => ({
          id: i,
          text: "x".repeat(10000),
        })),
      },
      6000,
    );
    expect(JSON.stringify(result).length).toBeLessThan(6000);
    expect(result).toMatchObject({
      status: "failed",
      failure: { writeState: "unknown", recoverable: false },
      nextCursor: "cursor:unchanged",
      outputTruncated: true,
    });
    expect(boundToolOutput({ rows: [1, 2] })).toEqual({ rows: [1, 2] });
  });

  it("bounds accumulated results and preserves tool-call/result pairing", () => {
    const messages = Array.from({ length: 40 }, (_, i) => ({
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: `call${i}`,
          toolName: "lookup",
          output: { type: "json" as const, value: { text: "x".repeat(20000) } },
        },
      ],
    }));
    const bounded = boundToolHistory(messages);
    expect(JSON.stringify(bounded).length).toBeLessThan(160000);
    expect(bounded).toHaveLength(40);
    expect(bounded[0]).toMatchObject({ content: [{ toolCallId: "call0" }] });
  });

  it("strips call syntax and JSON envelopes without exposing payloads", () => {
    for (const leak of [
      'to=functions.expand_tools {"family":"platform"}',
      "<|im_start|>assistant<|channel|>commentary",
      '{"tool_calls":[{"function":{"name":"expand_tools","arguments":"{}"}}]}',
      '{"name":"expand_tools","arguments":{"families":["platform"]}}',
    ]) {
      expect(sanitizeOperatorReply(`Checking records.\n${leak}`)).toBe(
        "Checking records.",
      );
    }
    expect(sanitizeOperatorReply('The example JSON is {"count": 2}.')).toBe(
      'The example JSON is {"count": 2}.',
    );
  });

  it("gives safe failure categories and actionable guidance", () => {
    expect(
      operatorRunFailureReason(
        new Error("maximum context length exceeded: secret-provider-payload"),
      ),
    ).toMatchObject({ code: "context_limit" });
    expect(
      JSON.stringify(
        operatorRunFailureReason(
          new Error("maximum context length exceeded: secret-provider-payload"),
        ),
      ),
    ).not.toContain("secret-provider-payload");
    expect(operatorRunFailureReason(new Error("HTTP 503"))).toMatchObject({
      code: "model_unavailable",
    });
    expect(
      operatorRunFailureReason(new Error("unclassified private diagnostics"))
        .nextStep,
    ).toBeTruthy();
  });
});
