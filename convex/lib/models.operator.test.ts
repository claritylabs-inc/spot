import { afterEach, describe, expect, test, vi } from "vitest";
import { stepCountIs, tool } from "ai";
import { z } from "zod";
import { generateAgentTextForOperatorTask } from "./models";

const selectedRoute = {
  provider: "openai" as const,
  model: "gpt-5.6-terra",
};

function operatorContext() {
  return {
    runQuery: vi.fn(async () => selectedRoute),
    runMutation: vi.fn(async () => null),
    storage: {
      store: vi.fn(),
      getUrl: vi.fn(),
      delete: vi.fn(),
    },
  };
}

const run = {
  sessionKey: "operator:user:thread",
  taskKind: "operator_agent" as const,
  trace: {
    traceId: "operator-run",
    label: "operator-agent",
    phase: "query_reason",
    channel: "web" as const,
  },
};

function routerResponse(
  requestId: string,
  output: unknown,
  finishReason: string,
) {
  return Response.json({
    requestId,
    model: selectedRoute,
    routing: {
      decision: "pin",
      candidatesConsidered: [selectedRoute],
      policyVersion: "policy-v1",
      cacheStickinessApplied: true,
      routeSource: "global",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 10,
      outputTokens: 3,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    },
    costUsd: 0.001,
    costStatus: "priced",
    output,
    finishReason,
  });
}

describe("operator model execution boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("pins every tool-loop step to the selected route with router fallback disabled", async () => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const execute = vi.fn(async ({ id }: { id: string }) => ({ id, ok: true }));
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        routerResponse(
          "router-step-1",
          {
            toolCalls: [
              {
                toolCallId: "call-1",
                toolName: "inspect_record",
                input: { id: "record-1" },
              },
            ],
          },
          "tool-calls",
        ),
      )
      .mockResolvedValueOnce(
        routerResponse("router-step-2", "Inspection complete.", "stop"),
      );
    vi.stubGlobal("fetch", fetchMock);
    const ctx = operatorContext();

    const result = await generateAgentTextForOperatorTask(
      ctx as never,
      "chat_vision",
      {
        prompt: "Inspect this record.",
        tools: {
          inspect_record: tool({
            inputSchema: z.object({ id: z.string() }),
            execute,
          }),
        },
        stopWhen: stepCountIs(2),
      },
      run,
    );

    expect(result.text).toBe("Inspection complete.");
    expect(result.transport).toBe("cl-router");
    expect(execute).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      const request = JSON.parse(init?.body as string);
      expect(request).toMatchObject({
        tenantId: "glass",
        task: "chat_vision",
        taskKind: "operator_agent",
        sessionKey: "operator:user:thread",
        routing: { pin: selectedRoute, allowFallback: false },
        settings: {
          routes: { operator_agent: selectedRoute },
          routeSources: { operator_agent: "global" },
        },
      });
      expect(request.settings).not.toHaveProperty("providerKeys");
    }
  });

  test("fails closed after one router attempt", async () => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          error: {
            code: "router_unavailable",
            message: "No eligible route is available.",
            retryable: true,
            executionStarted: false,
            requestId: "failed-router-request",
          },
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateAgentTextForOperatorTask(
        operatorContext() as never,
        "chat_vision",
        { prompt: "Inspect this." },
        run,
      ),
    ).rejects.toThrow("No eligible route is available");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://router.example.test/v1/generate",
    );
  });

  test.each([
    { label: "blank output", output: "", finishReason: "stop" },
    {
      label: "length-limited visible output",
      output: "Partial answer",
      finishReason: "length",
    },
  ])("does not retry $label", async ({ output, finishReason }) => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      routerResponse("router-step-1", output, finishReason),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateAgentTextForOperatorTask(
        operatorContext() as never,
        "chat_vision",
        { prompt: "Inspect this." },
        run,
      ),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
