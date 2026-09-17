import assert from "node:assert/strict";
import test from "node:test";
import { createClRouterClient } from "../src/clRouterClient.js";

const request = {
  state: { source: ["policy text", null, true, 2] },
  questions: {
    support: {
      type: "noul" as const,
      instructions: { question: "Is the claim supported?" },
    },
  },
  executionBudgetMs: 1000,
};
const response = {
  contractVersion: 1,
  requestId: "worker-decision",
  model: "jev-1.13.0",
  answers: { support: { type: "noul", noul: 0.99 } },
  usage: { inputTokens: 10, outputTokens: 4 },
  cost: { status: "unpriced", costNanoUsd: null },
  durationMs: 2,
};

function client(fetch: typeof globalThis.fetch) {
  return createClRouterClient({
    baseUrl: "https://router.example.test",
    secret: "inference-secret",
    timeoutMs: 1000,
    fetch,
  });
}

test("worker decisions preserve JSON and use only the router credential", async () => {
  const router = client(async (url, init) => {
    assert.equal(String(url), "https://router.example.test/v1/decide");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer inference-secret",
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      ...request,
      tenantId: "glass",
    });
    return Response.json(response);
  });
  assert.deepEqual(await router.decide(request), response);
});

test("worker rejects missing evidence judgments", async () => {
  const router = client(async () =>
    Response.json({ ...response, answers: {} }),
  );
  await assert.rejects(router.decide(request), /decision response is invalid/);
});

test("cancelled worker decisions never issue a request", async () => {
  let sent = false;
  const router = client(async () => {
    sent = true;
    return Response.json(response);
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(router.decide(request, controller.signal));
  assert.equal(sent, false);
});

test("worker preserves selection accounting and rejects corrupt costs", async () => {
  const selection = {
    mode: "jev_shadow",
    selectorVersion: "jev-selector-v1",
    outcome: "default",
    reason: "low_confidence",
    durationMs: 100,
    costNanoUsd: 42,
    estimatedInputTokens: 10,
    estimatedOutputTokens: null,
    expectedFallbackCostNanoUsd: null,
  };
  const body = {
    requestId: "generation-1",
    model: { provider: "openai", model: "gpt-5.6-terra" },
    output: { supported: true },
    routing: {
      decision: "autonomous_primary",
      candidatesConsidered: [],
      policyVersion: null,
      cacheStickinessApplied: false,
      attemptCount: 1,
      selection,
    },
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    costUsd: null,
    costStatus: "unpriced",
  };
  const input = {
    task: "extraction" as const,
    schema: { type: "object" },
    prompt: "extract",
  };
  const result = await client(async () => Response.json(body)).generate(input);
  assert.deepEqual(result.routing.selection, selection);
  await assert.rejects(
    client(async () =>
      Response.json({
        ...body,
        routing: {
          ...body.routing,
          selection: { ...selection, costNanoUsd: -1 },
        },
      }),
    ).generate(input),
    /invalid selection metadata/,
  );
});
