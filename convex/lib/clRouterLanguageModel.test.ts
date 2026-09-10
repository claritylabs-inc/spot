import { afterEach, describe, expect, test, vi } from "vitest";
import { stepCountIs, streamText, tool } from "ai";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { z } from "zod";

import {
  ClRouterVisibleOutputError,
  createClRouterLanguageModel,
} from "./clRouterLanguageModel";

const environment = {
  CL_ROUTER_URL: "https://router.example.test",
  CL_ROUTER_SECRET: "router-secret",
  SPOT_ENV: "production",
};

function doneEvent(finishReason: string) {
  return {
    type: "done",
    finishReason,
    requestId: "request-1",
    model: { provider: "openai", model: "gpt-5.5" },
    routing: {
      decision: "policy",
      candidatesConsidered: [{ provider: "openai", model: "gpt-5.5" }],
      policyVersion: "policy-v1",
      cacheStickinessApplied: true,
      routeSource: "org",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 10,
      outputTokens: 3,
      cachedInputTokens: 2,
      cacheWriteTokens: 1,
    },
    costUsd: 0.001,
    costStatus: "priced",
  };
}

function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => {
      const type = (event as { type: string }).type;
      return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    })
    .join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function adapterOptions(fetch: typeof globalThis.fetch) {
  return {
    task: "chat" as const,
    taskKind: "query_reason",
    orgId: "org-1",
    settings: {
      routes: { chat: { provider: "openai" as const, model: "gpt-5.5" } },
      routeSources: { chat: "org" },
    },
    sessionKey: "thread-1",
    trace: { traceId: "agent-message-1", channel: "web" },
    client: { environment, fetch },
  };
}

function rawCallOptions(): LanguageModelV3CallOptions {
  return {
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  };
}

describe("cl-router LanguageModelV3 adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("keeps business tool execution in Spot and pins later router steps", async () => {
    const execute = vi.fn(
      async ({ policyNumber }: { policyNumber: string }) => ({
        carrier: "Acme",
        policyNumber,
      }),
    );
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "lookup_policy",
            input: { policyNumber: "GL-100" },
          },
          doneEvent("tool-calls"),
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "text-delta", id: "text-2", delta: "Acme policy found." },
          doneEvent("stop"),
        ]),
      );
    const result = streamText({
      model: createClRouterLanguageModel(adapterOptions(fetchMock)),
      prompt: "Find GL-100.",
      tools: {
        lookup_policy: tool({
          inputSchema: z.object({ policyNumber: z.string() }),
          execute,
        }),
      },
      stopWhen: stepCountIs(2),
    });

    await expect(result.text).resolves.toBe("Acme policy found.");
    expect(execute).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)),
    );
    expect(requests[0].routing).toEqual({ allowFallback: true });
    expect(requests[1].routing).toEqual({
      pin: { provider: "openai", model: "gpt-5.5" },
      allowFallback: false,
    });
    expect(JSON.stringify(requests)).not.toContain("providerKeys");
  });

  test("fails closed after one router failure", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          error: {
            code: "router_candidates_exhausted",
            message: "Every route failed",
            retryable: true,
            executionStarted: true,
            attempts: [],
          },
        },
        { status: 502 },
      ),
    );
    const model = createClRouterLanguageModel(adapterOptions(fetchMock));
    await expect(model.doGenerate(rawCallOptions())).rejects.toMatchObject({
      routerCode: "router_candidates_exhausted",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("never retries after visible streamed output", async () => {
    const encoder = new TextEncoder();
    let pullCount = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pullCount++ === 0) {
            controller.enqueue(
              encoder.encode(
                `event: text-delta\ndata: ${JSON.stringify({
                  type: "text-delta",
                  id: "text-1",
                  delta: "Visible",
                })}\n\n`,
              ),
            );
            return;
          }
          controller.error(new TypeError("socket reset"));
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => response);
    const result = await createClRouterLanguageModel(
      adapterOptions(fetchMock),
    ).doStream(rawCallOptions());
    const reader = result.stream.getReader();
    const parts: LanguageModelV3StreamPart[] = [];
    let failure: unknown;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
    } catch (error) {
      failure = error;
    }
    expect(parts).toContainEqual({
      type: "text-delta",
      id: "text-1",
      delta: "Visible",
    });
    expect(failure).toBeInstanceOf(ClRouterVisibleOutputError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("keeps small images inline and rejects arbitrary URLs before HEAD", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ...doneEvent("stop"), output: "done" }),
    );
    const model = createClRouterLanguageModel(adapterOptions(fetchMock));
    await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: new Uint8Array([1, 2, 3]),
              mediaType: "image/png",
            },
          ],
        },
      ],
    });
    const request = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    );
    expect(request.messages[0].content[0]).toMatchObject({
      type: "image",
      image: "AQID",
    });

    fetchMock.mockClear();
    await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: new URL(
                "https://merry-platypus-82.convex.cloud/api/storage/document",
              ),
              mediaType: "application/pdf",
              providerOptions: { spot: { routerAssetSizeBytes: 123 } },
            },
          ],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const referencedRequest = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(referencedRequest.messages[0].content[0].source).toMatchObject({
      sizeBytes: 123,
    });

    fetchMock.mockClear();
    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "file",
                data: new URL("https://169.254.169.254/private"),
                mediaType: "application/pdf",
              },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("keeps an explicit operator route pinned without router fallback", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ...doneEvent("stop"), output: "done" }),
    );
    const model = createClRouterLanguageModel({
      ...adapterOptions(fetchMock),
      taskKind: "operator_agent",
      initialRoutePin: { provider: "openai", model: "gpt-5.5" },
      allowFallback: false,
    });
    await expect(model.doGenerate(rawCallOptions())).resolves.toBeDefined();
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.routing).toEqual({
      pin: { provider: "openai", model: "gpt-5.5" },
      allowFallback: false,
    });
  });

  test("stages byte-backed assets only when the exact request exceeds 4 MiB", async () => {
    const cleanup = vi.fn(async () => undefined);
    const assetStager = vi.fn(async () => ({
      reference: {
        url: "https://actions.spot.insure/router-assets?assetId=large",
        mediaType: "image/png",
        sizeBytes: 3 * 1024 * 1024,
      },
      cleanup,
    }));
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ...doneEvent("stop"), output: "done" }),
    );
    const model = createClRouterLanguageModel({
      ...adapterOptions(fetchMock),
      assetStager,
    });
    await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              data: new Uint8Array(3 * 1024 * 1024),
              mediaType: "image/png",
            },
          ],
        },
      ],
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.messages[0].content[0]).toMatchObject({
      type: "image",
      source: { sizeBytes: 3 * 1024 * 1024 },
    });
    expect(assetStager).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  test("cleans partial staging when a later asset cannot be staged", async () => {
    const cleanup = vi.fn(async () => {
      throw new Error("cleanup transport failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const assetStager = vi
      .fn()
      .mockResolvedValueOnce({
        reference: {
          url: "https://actions.spot.insure/router-assets?assetId=first",
          mediaType: "image/png",
          sizeBytes: 1024 * 1024,
        },
        cleanup,
      })
      .mockRejectedValueOnce(new Error("second staging failed"));
    const fetchMock = vi.fn<typeof globalThis.fetch>();
    const model = createClRouterLanguageModel({
      ...adapterOptions(fetchMock),
      assetStager,
    });
    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "file",
                data: new Uint8Array(1024 * 1024),
                mediaType: "image/png",
              },
              {
                type: "file",
                data: new Uint8Array(3 * 1024 * 1024),
                mediaType: "image/png",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("second staging failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assetStager).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[cl-router] 1 staged asset cleanups failed",
    );
  });
});
