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

function routedMetadata(
  route: { provider: string; model: string },
  extras: Record<string, unknown> = {},
) {
  return {
    requestId: "request-1",
    model: route,
    routing: {
      decision: extras.decision ?? "manual",
      primitive: extras.primitive ?? "text",
      difficulty: "standard",
      requiredTier: 2,
      selectedTier: 2,
      route,
      source: extras.source ?? "manual",
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
    ...extras,
  };
}

function response(output: unknown) {
  return Response.json({
    ...routedMetadata(route),
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
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://router.example.test/v1/manual",
    );
    const request = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(request).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      primitive: "text",
      prompt: "Hello",
      route,
    });
    expect(request).not.toHaveProperty("task");
    expect(request).not.toHaveProperty("settings");
    expect(request).not.toHaveProperty("routing");
    expect(JSON.stringify(request)).not.toContain("providerKeys");
  });

  test("sends and validates structured output through the router", async () => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const runQuery = vi.fn(async () => ({
      routes: { analysis: route },
      routeSources: { analysis: "global" },
    }));
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      response({ decision: "covered" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateObjectForPublicTask(
      { runQuery } as never,
      "analysis",
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

vi.mock("./routerJobClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./routerJobClient")>()),
  durableRouterClientOptions: () => ({}),
  executeDurableRouterRequest: async (
    _ctx: unknown,
    operation: string,
    payload: unknown,
  ) => {
    const client = await import("./clRouterClient");
    if (operation === "manual") {
      return client.clRouterGenerateManual(
        payload as Parameters<typeof client.clRouterGenerateManual>[0],
      );
    }
    if (operation === "generate") {
      return client.clRouterGenerate(
        payload as Parameters<typeof client.clRouterGenerate>[0],
      );
    }
    throw new Error("Unexpected test operation");
  },
}));
