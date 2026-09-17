import { afterEach, describe, expect, test, vi } from "vitest";
import { decideWithFallback, decisionPolicyFromEnvironment } from "./decisions";

const { decide } = vi.hoisted(() => ({ decide: vi.fn() }));
vi.mock("./sdkCallbacks", () => ({ makeDecide: () => decide }));

const questions = {
  support: {
    type: "noul" as const,
    instructions: "Is this source explicit support?",
  },
};
const response = {
  contractVersion: 1,
  requestId: "test-decision",
  model: "jev-1.13.0",
  answers: { support: { type: "noul", noul: 0.99 } },
  usage: { inputTokens: 10, outputTokens: 4 },
  cost: { status: "unpriced", costNanoUsd: null },
  durationMs: 1,
};

function configure(mode: "legacy" | "shadow" | "active") {
  vi.stubEnv(
    "SPOT_DECISION_POLICY",
    JSON.stringify({
      mode,
      policyVersion: "test-only",
      families: {
        test_support: { threshold: 0.95, evaluationId: "unit-test-fixture" },
      },
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Spot decision execution", () => {
  test("invalid configuration preserves reasoning and does not contact the router", async () => {
    vi.stubEnv("SPOT_DECISION_POLICY", '{"mode":"typo"}');
    expect(decisionPolicyFromEnvironment()).toEqual({ mode: "legacy" });
    const fallback = vi.fn(async () => "reasoning");
    expect(
      await decideWithFallback({
        family: "test_support",
        state: "evidence",
        questions,
        accept: () => "decision",
        fallback,
      }),
    ).toBe("reasoning");
    expect(decide).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  test("shadow never executes the proposed result and sends only defined lineage", async () => {
    configure("shadow");
    decide.mockResolvedValue(response);
    const accept = vi.fn(() => "decision");
    const fallback = vi.fn(async () => "reasoning");
    expect(
      await decideWithFallback({
        family: "test_support",
        state: { evidence: [true, 2, null] },
        questions,
        accept,
        fallback,
      }),
    ).toBe("reasoning");
    expect(fallback).toHaveBeenCalledOnce();
    expect(accept).not.toHaveBeenCalled();
    expect(decide.mock.calls[0][0].trace).toEqual({});
  });

  test("a domain evidence rejection falls back despite a high probability", async () => {
    configure("active");
    decide.mockResolvedValue(response);
    const fallback = vi.fn(async () => "reasoning");
    expect(
      await decideWithFallback({
        family: "test_support",
        state: "incomplete source",
        questions,
        accept: () => undefined,
        fallback,
      }),
    ).toBe("reasoning");
    expect(fallback).toHaveBeenCalledOnce();
  });

  test("caller cancellation never starts reasoning fallback", async () => {
    configure("active");
    const controller = new AbortController();
    controller.abort();
    const fallback = vi.fn(async () => "reasoning");
    await expect(
      decideWithFallback({
        family: "test_support",
        state: "evidence",
        questions,
        accept: () => "decision",
        fallback,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });
});

test("consumed branch confidence does not waive full answer validation", async () => {
  configure("active");
  const batched = { ...questions, unused: questions.support };
  const fallback = vi.fn(async () => "reasoning");
  const options = {
    family: "test_support",
    state: "evidence",
    questions: batched,
    requiredQuestionIds: () => ["support"],
    accept: () => "decision",
    fallback,
  };
  decide.mockResolvedValue({
    ...response,
    answers: { ...response.answers, unused: { type: "noul", noul: 0.5 } },
  });
  expect(await decideWithFallback(options)).toBe("decision");
  expect(fallback).not.toHaveBeenCalled();
  decide.mockResolvedValue({
    ...response,
    answers: { ...response.answers, unused: { type: "noul", noul: 2 } },
  });
  expect(await decideWithFallback(options)).toBe("reasoning");
  expect(fallback).toHaveBeenCalledOnce();
});
