import { beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { runAgentTurn } from "./channelAgentRunner";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), classify: vi.fn() }));
vi.mock("./models", () => ({
  generateAgentTextForOrg: mocks.generate,
  generateObjectForOrg: mocks.classify,
  generatedTextFromResult: (result: { text: string }) => result.text,
}));

beforeEach(() => {
  mocks.generate.mockReset();
  mocks.classify.mockResolvedValue({
    object: { requiresPolicyEvidence: true, confidence: 1 },
  });
});

test("Slack reaction-first context recovers with available policy discovery rather than an unavailable reaction tool", async () => {
  const policyLookup = vi
    .fn()
    .mockResolvedValue("Policy QA-1 has a $3 million cyber limit.");
  mocks.generate.mockResolvedValueOnce({
    text: "I will check your policy.",
    toolCalls: [{ toolName: "choose_slack_reaction", input: { name: "eyes" } }],
    toolResults: [{ toolName: "choose_slack_reaction", output: { ok: true } }],
  });
  mocks.generate.mockImplementationOnce(async (_ctx, _org, _task, options) => {
    const step = await options.prepareStep({ stepNumber: 0 });
    // Simulate a provider following the original reaction-first instruction
    // unless the recovery request names the evidence tool it must execute.
    const name =
      step?.toolChoice?.type === "tool"
        ? step.toolChoice.toolName
        : "choose_slack_reaction";
    const output = await options.tools[name]?.execute({});
    return {
      text: output ?? "The requested reaction tool is unavailable.",
      toolCalls: [{ toolName: name, input: {} }],
      toolResults: output ? [{ toolName: name, output }] : [],
    };
  });
  const result = await runAgentTurn({} as ActionCtx, {
    orgId: "org" as Id<"organizations">,
    task: "chat",
    messageText: "Summarize our current policy",
    auditExcludedTools: new Set(["choose_slack_reaction"]),
    options: {
      system: "Choose a Slack reaction first, then answer the question.",
      tools: {
        lookup_policy: {
          description: "Find current policies",
          inputSchema: z.object({}),
          execute: policyLookup,
        },
      },
    },
    run: {
      taskKind: "query_reason",
      sessionKey: "qa-policy-evidence",
      trace: {
        traceId: "qa",
        label: "slack",
        phase: "query_reason",
        channel: "slack",
      },
    },
  });
  expect(policyLookup).toHaveBeenCalledOnce();
  expect(result.text).toContain("$3 million");
  expect(result.audit.completedTools).toEqual(["lookup_policy"]);
});

test("policy recovery never replays a turn that already used a write tool", async () => {
  mocks.generate.mockResolvedValueOnce({
    text: "Message sent.",
    toolCalls: [{ toolName: "send_email", input: {} }],
    toolResults: [{ toolName: "send_email", output: { sent: true } }],
  });
  const lookup = vi.fn();
  const result = await runAgentTurn({} as ActionCtx, {
    orgId: "org" as Id<"organizations">,
    task: "chat",
    messageText: "Summarize our current policy",
    options: {
      system: "Answer from evidence",
      tools: {
        lookup_policy: {
          description: "Find policies",
          inputSchema: z.object({}),
          execute: lookup,
        },
      },
    },
    run: {
      taskKind: "query_reason",
      sessionKey: "qa-policy-evidence",
      trace: {
        traceId: "qa",
        label: "test",
        phase: "query_reason",
        channel: "slack",
      },
    },
  });
  expect(mocks.generate).toHaveBeenCalledOnce();
  expect(lookup).not.toHaveBeenCalled();
  expect(result.text).not.toBe("Message sent.");
});
