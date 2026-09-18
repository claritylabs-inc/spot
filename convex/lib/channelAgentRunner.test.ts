import { beforeEach, expect, test, vi } from "vitest";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { runAgentTurn } from "./channelAgentRunner";

const generate = vi.hoisted(() => vi.fn());
vi.mock("./models", () => ({
  generateAgentTextForOrg: generate,
  generatedTextFromResult: (result: { text: string }) => result.text,
}));

beforeEach(() => generate.mockReset());

const args: Parameters<typeof runAgentTurn>[1] = {
  orgId: "org" as Id<"organizations">,
  task: "chat",
  options: {
    system: "Answer from the available evidence.",
    messages: [{ role: "user", content: "Summarize our policy." }],
    tools: {},
  },
  run: {
    taskKind: "query_reason",
    sessionKey: "test-thread",
    trace: {
      traceId: "test",
      label: "test",
      phase: "query_reason",
      channel: "web",
    },
  },
};

test("returns the normal turn response when the router abstains from tools", async () => {
  generate.mockResolvedValueOnce({
    text: "Please identify the policy.",
    clRouter: { requestId: "request-1" },
  });
  const result = await runAgentTurn({} as ActionCtx, args);
  expect(result.text).toBe("Please identify the policy.");
  expect(result.routerRequestId).toBe("request-1");
  expect(generate).toHaveBeenCalledOnce();
});

test("finishes an incomplete response from completed tool results without replaying a write", async () => {
  generate.mockResolvedValueOnce({
    text: "",
    finishReason: "length",
    toolCalls: [{ toolName: "send_email", input: {} }],
    toolResults: [{ toolName: "send_email", output: { sent: true } }],
    response: { messages: [{ role: "assistant", content: "Email was sent." }] },
  });
  generate.mockImplementationOnce(async (_ctx, _org, _task, options) => {
    expect(options.tools).toBeUndefined();
    expect(options.messages).toContainEqual({
      role: "assistant",
      content: "Email was sent.",
    });
    return { text: "Email sent.", clRouter: { requestId: "request-2" } };
  });
  const result = await runAgentTurn({} as ActionCtx, args);
  expect(result.text).toBe("Email sent.");
  expect(result.audit.completedTools).toEqual(["send_email"]);
  expect(generate).toHaveBeenCalledTimes(2);
});
