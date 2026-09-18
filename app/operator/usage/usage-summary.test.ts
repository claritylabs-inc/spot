import { expect, test } from "vitest";
import { summarizeCalls } from "./usage-summary";
import type { ModelCall } from "../logs/log-utils";
function call(overrides: Partial<ModelCall>): ModelCall {
  return {
    _id: "test" as ModelCall["_id"],
    _creationTime: 1,
    kind: "call",
    runId: "run",
    sessionKey: "run",
    task: "chat",
    taskKind: "chat",
    channel: "web",
    label: "call",
    phase: "generate",
    timestamp: 1,
    expiresAt: 2,
    ...overrides,
  };
}
test("usage excludes summaries, distinguishes unknown cost from zero and does not add cached or reasoning tokens twice", () => {
  const summary = summarizeCalls(
    [
      call({
        costUsd: 0.03,
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 20,
        reasoningTokens: 10,
      }),
      call({ costUsd: null }),
      call({ costUsd: 0, inputTokens: 0, outputTokens: 0 }),
      call({ kind: "run", costUsd: 0.03, inputTokens: 100, outputTokens: 20 }),
    ],
    "task",
  );
  expect(summary.total).toMatchObject({
    calls: 3,
    priced: 2,
    cost: 0.03,
    input: 100,
    output: 20,
    tokenCalls: 2,
  });
  expect(summary.rows).toHaveLength(1);
});
