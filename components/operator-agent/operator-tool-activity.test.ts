import { describe, expect, test } from "vitest";

import type {
  OperatorAgentConfirmation,
  OperatorAgentMessage,
} from "@/lib/operator-agent-api";
import { operatorConversationEntries } from "./operator-tool-activity";

function lookup(id: string): [OperatorAgentMessage, OperatorAgentMessage] {
  return [
    {
      id,
      role: "user",
      channel: "mcp",
      content: "Search organizations",
      createdAt: 1,
      isDirectToolRequest: true,
    },
    {
      id: `${id}-reply`,
      role: "assistant",
      channel: "mcp",
      replyToMessageId: id,
      content: "Completed: Search organizations.",
      createdAt: 2,
      toolCalls: [{ name: "search_organizations", effect: "read" }],
    },
  ];
}

test("groups consecutive lookups without losing their saved details or crossing a human message", () => {
  const first = lookup("first");
  first[1].toolCalls![0].output = '{"organizations":[]}';
  const second = lookup("second");
  const human: OperatorAgentMessage = {
    id: "human",
    role: "user",
    channel: "chat",
    content: "Add websites for all brokers",
    createdAt: 3,
  };
  const entries = operatorConversationEntries({
    messages: [...first, ...second, human, ...lookup("third")],
    confirmations: [],
  });
  expect(entries.map((entry) => entry.kind)).toEqual([
    "tool_calls",
    "message",
    "tool_calls",
  ]);
  expect(entries[0]).toMatchObject({
    activities: [
      { request: first[0], response: first[1] },
      { request: second[0], response: second[1] },
    ],
  });
  expect(entries[1]).toMatchObject({ activity: { request: human } });
});

test("keeps failed reads and their error details in the same group as completed reads", () => {
  const failed = lookup("failed");
  failed[1].content = "Could not complete search: service unavailable";
  const error = lookup("error");
  error[1].status = "error";
  error[1].content = "Search service unavailable";
  const entries = operatorConversationEntries({
    messages: [...lookup("before"), ...failed, ...error, ...lookup("after")],
    confirmations: [],
  });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "tool_calls",
    activities: [
      { request: { id: "before" } },
      { request: failed[0], response: failed[1] },
      { request: error[0], response: error[1] },
      { request: { id: "after" } },
    ],
  });
});

describe("activity requiring attention stays outside collapsed tool calls", () => {
  test.each([
    { name: "running", response: { status: "processing" as const } },
    { name: "cancelled", response: { status: "cancelled" as const } },
    {
      name: "blocked",
      response: { content: "Blocked: resolve the pending confirmation" },
    },
    { name: "unknown outcome", response: { content: "Finished" } },
    {
      name: "write",
      response: {
        toolCalls: [
          { name: "update_organization", effect: "reversible_write" as const },
        ],
      },
    },
    {
      name: "unknown effect",
      response: { toolCalls: [{ name: "retired_tool" }] },
    },
    { name: "pending reply", missingResponse: true },
    { name: "approval", confirmation: true },
    { name: "request attachment", attachment: "request" },
    { name: "response attachment", attachment: "response" },
  ])(
    "$name breaks the group",
    ({ response, missingResponse, confirmation, attachment }) => {
      const [request, reply] = lookup("attention");
      Object.assign(reply, response);
      if (attachment) {
        (attachment === "request" ? request : reply).attachments = [
          {
            fileId: "file" as NonNullable<
              OperatorAgentMessage["attachments"]
            >[number]["fileId"],
            filename: "evidence.pdf",
            contentType: "application/pdf",
            size: 100,
          },
        ];
      }
      const confirmations: OperatorAgentConfirmation[] = confirmation
        ? [
            {
              id: "approval",
              promptMessageId: reply.id,
              title: "Approve change",
              destructive: false,
              state: "pending",
              actionable: true,
            },
          ]
        : [];
      const entries = operatorConversationEntries({
        messages: [
          ...lookup("before"),
          request,
          ...(missingResponse ? [] : [reply]),
          ...lookup("after"),
        ],
        confirmations,
      });
      expect(entries.map((entry) => entry.kind)).toEqual([
        "tool_calls",
        "message",
        "tool_calls",
      ]);
      expect(entries[1]).toMatchObject({
        activity: { request, confirmations },
      });
    },
  );
});
