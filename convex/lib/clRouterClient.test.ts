import { describe, expect, test, vi } from "vitest";

import {
  ClRouterRequestError,
  assertSpotRouterAssetUrl,
  clRouterCapabilities,
  clRouterDecide,
  clRouterGenerate,
  clRouterGenerateManual,
  clRouterGenerateStream,
  clRouterRetrieve,
  type ClRouterGenerateRequest,
  type ClRouterManualGenerateRequest,
} from "./clRouterClient";
import { routerAssetSigningConfiguration } from "./routerAssetSignature";

const environment = {
  CL_ROUTER_URL: "https://router.example.test/",
  CL_ROUTER_SECRET: "router-secret",
  SPOT_ENV: "production",
};

function responseMetadata() {
  return {
    requestId: "request-1",
    model: { provider: "openai", model: "gpt-5-mini" },
    routing: {
      decision: "routed" as const,
      primitive: "text",
      difficulty: "standard" as const,
      requiredTier: 2 as const,
      selectedTier: 2 as const,
      route: { provider: "openai", model: "gpt-5-mini" },
      source: "jev" as const,
      attemptCount: 1,
    },
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      cachedInputTokens: 0,
      cacheWriteTokens: 1,
    },
    costUsd: 0.0001,
    costStatus: "priced" as const,
  };
}

test("a long active request has no elapsed-time abort but accepts explicit cancellation", async () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    await expect(
      clRouterGenerate(
        { primitive: "text", prompt: "Think carefully" },
        {
          environment,
          abortSignal: controller.signal,
          fetch: async (_url, init) => {
            await vi.advanceTimersByTimeAsync(20 * 60_000);
            expect(init?.signal?.aborted).toBe(false);
            controller.abort();
            expect(init?.signal?.aborted).toBe(true);
            init?.signal?.throwIfAborted();
            return Response.json({
              ...responseMetadata(),
              output: "unreachable",
            });
          },
        },
      ),
    ).rejects.toMatchObject({ kind: "aborted" });
  } finally {
    vi.useRealTimers();
  }
});

test("stream consumers read the durable result without opening a synchronous stream", async () => {
  const fetchMock = vi.fn();
  const executeJob = vi.fn(async () => ({
    ...responseMetadata(),
    output: {
      text: "Found it.",
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "inspect",
          input: { id: "record-1" },
        },
      ],
    },
    finishReason: "tool-calls",
  }));
  const result = await clRouterGenerateStream(
    { primitive: "text", prompt: "Inspect" },
    { environment, fetch: fetchMock, executeJob },
  );
  const events = [];
  for await (const event of result.events) events.push(event);
  expect(events.map((event) => event.type)).toEqual([
    "text-delta",
    "tool-call",
    "done",
  ]);
  expect(executeJob).toHaveBeenCalledOnce();
  expect(fetchMock).not.toHaveBeenCalled();
});

describe("cl-router requests", () => {
  test("sends a primitive generate request without settings, pins, or provider keys", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ...responseMetadata(),
        output: { disposition: "deliver" },
        finishReason: "stop",
      }),
    );
    await clRouterGenerate(
      {
        primitive: "reasoning",
        orgId: "org-1",
        prompt: "Classify.",
      },
      { environment, fetch: fetchMock },
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://router.example.test/v1/generate");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer router-secret",
      "Content-Type": "application/json",
    });
    expect(body).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      primitive: "reasoning",
    });
    expect(body).not.toHaveProperty("task");
    expect(body).not.toHaveProperty("settings");
    expect(body).not.toHaveProperty("routing");
    expect(JSON.stringify(body)).not.toContain("providerKeys");
  });

  test("preserves typed router failure metadata without another transport", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "router_unavailable",
            message: "No eligible route is available.",
            retryable: true,
            executionStarted: false,
            requestId: "failed-request",
            attempts: [],
          },
        },
        { status: 503 },
      ),
    );
    await expect(
      clRouterGenerate(
        { primitive: "reasoning", prompt: "Extract." },
        { environment, fetch: fetchMock },
      ),
    ).rejects.toMatchObject({
      routerCode: "router_unavailable",
      executionStarted: false,
      requestId: "failed-request",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("rejects oversized JSON and assets before fetch for JSON and streams", async () => {
    const fetchMock = vi.fn();
    await expect(
      clRouterGenerate(
        { primitive: "text", prompt: "x".repeat(4 * 1024 * 1024) },
        { environment, fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ kind: "configuration" });

    const nineAssets = Array.from({ length: 9 }, (_, index) => ({
      type: "file" as const,
      source: {
        url: `https://merry-platypus-82.convex.cloud/api/storage/${index}`,
        mediaType: "application/pdf",
        sizeBytes: 1,
      },
    }));
    await expect(
      clRouterGenerateStream(
        {
          primitive: "text",
          messages: [{ role: "user", content: nineAssets }],
        },
        { environment, fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ kind: "configuration" });
    for (const sizes of [
      [12 * 1024 * 1024 + 1],
      [9 * 1024 * 1024, 8 * 1024 * 1024],
    ]) {
      await expect(
        clRouterGenerate(
          {
            primitive: "text",
            messages: [
              {
                role: "user",
                content: sizes.map((sizeBytes, index) => ({
                  type: "file" as const,
                  source: {
                    url: `https://merry-platypus-82.convex.cloud/api/storage/${index}`,
                    mediaType: "application/pdf",
                    sizeBytes,
                  },
                })),
              },
            ],
          },
          { environment, fetch: fetchMock },
        ),
      ).rejects.toMatchObject({ kind: "configuration" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("uses authenticated capabilities and retrieval endpoints", async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          apiVersion: "v1",
          credentialMode: "router",
          providers: [{ provider: "openai", configured: true }],
          webRetrieval: {
            providers: [{ provider: "parallel", configured: true }],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          provider: "parallel",
          attempts: [{ provider: "parallel", ok: true }],
          text: "result",
          sources: [{ url: "https://example.com" }],
        }),
      );
    await expect(
      clRouterCapabilities({ environment, fetch: fetchMock }),
    ).resolves.toMatchObject({ credentialMode: "router" });
    await expect(
      clRouterRetrieve(
        { input: { query: "coverage" }, config: { primary: "parallel" } },
        { environment, fetch: fetchMock },
      ),
    ).resolves.toMatchObject({ provider: "parallel" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://router.example.test/v1/capabilities",
      "https://router.example.test/v1/retrieve",
    ]);
  });
});

describe("Spot router asset URL allowlist", () => {
  test("generates references only from canonical environment site hosts", () => {
    expect(
      routerAssetSigningConfiguration({
        SPOT_ENV: "production",
        CL_ROUTER_SECRET: "secret",
        CONVEX_SITE_URL: "https://actions.spot.insure",
      }).siteUrl,
    ).toBe("https://actions.spot.insure");
    expect(
      routerAssetSigningConfiguration({
        SPOT_ENV: "dev",
        CL_ROUTER_SECRET: "secret",
        CONVEX_SITE_URL: "https://acoustic-caiman-755.convex.site",
      }).siteUrl,
    ).toBe("https://acoustic-caiman-755.convex.site");
    expect(() =>
      routerAssetSigningConfiguration({
        SPOT_ENV: "production",
        CL_ROUTER_SECRET: "secret",
        CONVEX_SITE_URL: "https://merry-platypus-82.convex.site",
      }),
    ).toThrow(/canonical router asset host/);
  });

  test("is environment exact and rejects URL authority tricks", () => {
    expect(() =>
      assertSpotRouterAssetUrl(
        new URL("https://merry-platypus-82.convex.cloud/api/storage/a"),
        { SPOT_ENV: "production" },
      ),
    ).not.toThrow();
    expect(() =>
      assertSpotRouterAssetUrl(
        new URL("https://actions.spot.insure/router-assets?token=x"),
        { SPOT_ENV: "production" },
      ),
    ).not.toThrow();
    for (const url of [
      "https://acoustic-caiman-755.convex.cloud/api/storage/a",
      "https://merry-platypus-82.convex.cloud:8443/api/storage/a",
      "https://user@merry-platypus-82.convex.cloud/api/storage/a",
      "https://169.254.169.254/api/storage/a",
    ]) {
      expect(() =>
        assertSpotRouterAssetUrl(new URL(url), { SPOT_ENV: "production" }),
      ).toThrow(ClRouterRequestError);
    }
    expect(() =>
      assertSpotRouterAssetUrl(
        new URL("https://acoustic-caiman-755.convex.cloud/api/storage/a"),
        { SPOT_ENV: "dev" },
      ),
    ).not.toThrow();
    expect(() =>
      assertSpotRouterAssetUrl(
        new URL("https://merry-platypus-82.convex.cloud/api/storage/a"),
        { SPOT_ENV: "dev" },
      ),
    ).toThrow();
    expect(() =>
      assertSpotRouterAssetUrl(new URL("http://127.0.0.1:3211/api/storage/a"), {
        SPOT_ENV: "local",
        CL_ROUTER_URL: "http://localhost:4010",
      }),
    ).not.toThrow();
    expect(() =>
      assertSpotRouterAssetUrl(new URL("http://127.0.0.1:3211/api/storage/a"), {
        SPOT_ENV: "local",
        CL_ROUTER_URL: "https://router.example.test",
      }),
    ).toThrowError(/local router or a durable callback tunnel/);
  });
});

test("decisions use the authenticated Jev endpoint and validate exact question coverage", async () => {
  const request = {
    orgId: "org-1",
    task: "test_decision",
    parentRequestId: "parent-1",
    state: { message: "Reply to the original sender" },
    questions: {
      reply: { type: "noul" as const, instructions: "Is a reply requested?" },
    },
  };
  const response = {
    contractVersion: 1,
    requestId: "decision-1",
    parentRequestId: "parent-1",
    model: "jev-1.13.0",
    answers: { reply: { type: "noul", noul: 0.95 } },
    usage: { inputTokens: 100, outputTokens: 8 },
    cost: { status: "priced", costNanoUsd: 4200 },
    durationMs: 100,
  };
  const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(response),
  );
  const executeJob = vi.fn();
  const result = await clRouterDecide(request, {
    executeJob,
    environment,
    fetch: fetchMock,
  });
  expect(executeJob).not.toHaveBeenCalled();
  expect(result.answers.reply).toEqual({ type: "noul", noul: 0.95 });
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://router.example.test/v1/decide",
  );
  const init = fetchMock.mock.calls[0][1]!;
  expect(init.headers).toMatchObject({ Authorization: "Bearer router-secret" });
  expect(JSON.parse(String(init.body))).toEqual({
    ...request,
    tenantId: "glass",
  });
  fetchMock.mockResolvedValueOnce(Response.json({ ...response, answers: {} }));
  await expect(
    clRouterDecide(request, { environment, fetch: fetchMock }),
  ).rejects.toMatchObject({ kind: "invalid_response" });
});

test("decisions accept any resolved Jev version and reject non-Jev models", async () => {
  const request = {
    orgId: "org-1",
    task: "test_decision",
    parentRequestId: "parent-1",
    state: { message: "Reply to the original sender" },
    questions: {
      reply: { type: "noul" as const, instructions: "Is a reply requested?" },
    },
  };
  const response = {
    contractVersion: 1,
    requestId: "decision-1",
    parentRequestId: "parent-1",
    model: "jev-1.14.0",
    answers: { reply: { type: "noul", noul: 0.95 } },
    usage: { inputTokens: 100, outputTokens: 8 },
    cost: { status: "priced", costNanoUsd: 4200 },
    durationMs: 100,
  };
  const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(response),
  );
  const result = await clRouterDecide(request, {
    environment,
    fetch: fetchMock,
  });
  expect(result.answers.reply).toEqual({ type: "noul", noul: 0.95 });

  fetchMock.mockResolvedValueOnce(
    Response.json({ ...response, model: "gpt-5.5" }),
  );
  await expect(
    clRouterDecide(request, { environment, fetch: fetchMock }),
  ).rejects.toMatchObject({ kind: "invalid_response" });
});

test("manual generation posts the explicit route without settings or pins", async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      ...responseMetadata(),
      routing: {
        ...responseMetadata().routing,
        decision: "manual",
        source: "manual",
      },
      output: "ok",
      finishReason: "stop",
    }),
  );
  await clRouterGenerateManual(
    {
      primitive: "tool_use",
      prompt: "Inspect.",
      maxTokens: 512,
      route: { provider: "openai", model: "gpt-5.5" },
      trace: {
        traceId: "trace-1",
        parentRequestId: "parent-1",
        label: "spot.operator",
        taskKind: "operator_agent",
      },
      settings: { temperature: 0 },
      task: "operator_agent",
      taskKind: "operator_agent",
      sessionKey: "session-1",
      routing: { pin: { provider: "openai", model: "gpt-5.5" } },
      toolChoice: "auto",
    } as ClRouterManualGenerateRequest,
    { environment, fetch: fetchMock },
  );
  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  const body = JSON.parse(String(init.body));
  expect(url).toBe("https://router.example.test/v1/manual");
  expect(body).toEqual({
    tenantId: "glass",
    primitive: "tool_use",
    prompt: "Inspect.",
    maxTokens: 512,
    route: { provider: "openai", model: "gpt-5.5" },
    trace: {
      traceId: "trace-1",
      parentRequestId: "parent-1",
      caller: "spot.operator",
      tags: { label: "spot.operator", taskKind: "operator_agent" },
    },
  });
});

test.each([false, true])(
  "preserves primitive routing metadata (stream=%s)",
  async (stream) => {
    const metadata = responseMetadata();
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      stream
        ? new Response(
            `event: done\ndata: ${JSON.stringify({ type: "done", ...metadata, finishReason: "stop" })}\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          )
        : Response.json({ ...metadata, output: "done" }),
    );
    if (stream) {
      const response = await clRouterGenerateStream(
        { primitive: "text", prompt: "Hello" },
        { environment, fetch: fetchMock },
      );
      const events = [];
      for await (const event of response.events) events.push(event);
      expect(events).toEqual([
        expect.objectContaining({
          routing: expect.objectContaining({
            decision: "routed",
            primitive: "text",
            source: "jev",
            route: { provider: "openai", model: "gpt-5-mini" },
          }),
        }),
      ]);
    } else {
      const response = await clRouterGenerate(
        { primitive: "text", prompt: "Hello" },
        { environment, fetch: fetchMock },
      );
      expect(response.routing).toMatchObject({
        decision: "routed",
        primitive: "text",
        source: "jev",
      });
    }
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ...metadata,
        routing: {
          ...metadata.routing,
          decision: "policy",
        },
        output: "done",
      }),
    );
    await expect(
      clRouterGenerate(
        { primitive: "text", prompt: "Hello" },
        { environment, fetch: fetchMock },
      ),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  },
);
