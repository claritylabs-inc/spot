import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import {
  generateObjectForPublicTask,
  generateTextForOrg,
  getModelAndRouteForSettingsSnapshot,
} from "./models";

const route = {
  provider: "openai" as const,
  model: "gpt-5.6-terra",
};

function response(output: unknown) {
  return Response.json({
    requestId: "request-1",
    model: route,
    routing: {
      decision: "snapshot",
      candidatesConsidered: [route],
      policyVersion: "policy-v1",
      cacheStickinessApplied: false,
      routeSource: "global",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 4,
      outputTokens: 2,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    },
    costUsd: 0.001,
    costStatus: "priced",
    output,
    finishReason: "stop",
  });
}

describe("router-only model calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("uses an organization settings snapshot without provider credentials", async () => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const runQuery = vi.fn(async () => ({
      routes: { chat: route },
      routeSources: { chat: "global" },
    }));
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      response("Router answer."),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateTextForOrg(
      { runQuery } as never,
      "org-1" as Id<"organizations">,
      "chat",
      { prompt: "Hello" },
    );

    expect(result).toMatchObject({
      text: "Router answer.",
      route,
      transport: "cl-router",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(request).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      task: "chat",
      prompt: "Hello",
      routing: { pin: route },
    });
    expect(request.settings).not.toHaveProperty("providerKeys");
  });

  test("sends and validates structured output through the router", async () => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const runQuery = vi.fn(async () => ({
      routes: { classification: route },
      routeSources: { classification: "global" },
    }));
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      response({ decision: "covered" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateObjectForPublicTask(
      { runQuery } as never,
      "classification",
      {
        prompt: "Classify this.",
        schema: z.object({ decision: z.literal("covered") }),
      },
    );

    expect(result.object).toEqual({ decision: "covered" });
    expect(result.transport).toBe("cl-router");
    const request = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(request.schemaDialect).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(request.schema).toMatchObject({ type: "object" });
  });

  test("does not make a second transport attempt after a router failure", async () => {
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
          },
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateTextForOrg(
        { runQuery: vi.fn(async () => null) } as never,
        "org-1" as Id<"organizations">,
        "chat",
        { prompt: "Hello" },
      ),
    ).rejects.toThrow("No eligible route is available");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://router.example.test/v1/generate",
    );
  });

  test("validates configured routes from static capabilities, not environment keys", () => {
    const resolved = getModelAndRouteForSettingsSnapshot(
      {
        routes: { chat: route },
        routeSources: { chat: "global" },
      },
      "chat",
    );

    expect(resolved).toMatchObject({
      route,
      routeSource: "global",
      transport: "cl-router",
    });
  });
});
