import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import { makeEmbedTexts, makeGenerateObject } from "./sdkCallbacks";

function embeddingResponse(embeddings: number[][]) {
  return {
    requestId: "embed-request-1",
    model: { provider: "openai", model: "text-embedding-3-small" },
    routing: {
      decision: "snapshot",
      candidatesConsidered: [
        { provider: "openai", model: "text-embedding-3-small" },
      ],
      policyVersion: "policy-v1",
      cacheStickinessApplied: false,
      routeSource: "global",
      attemptCount: 1,
    },
    usage: { inputTokens: 4, outputTokens: 0, cachedInputTokens: 0 },
    costUsd: 0.000001,
    costStatus: "priced",
    embeddings,
  };
}

function embeddingContext() {
  return {
    runQuery: vi.fn(async () => ({
      routes: {
        embeddings: {
          provider: "openai",
          model: "text-embedding-3-small",
        },
      },
      routeSources: { embeddings: "global" },
    })),
  };
}

function generationResponse(output: unknown) {
  return {
    requestId: "generate-request-1",
    model: { provider: "openai", model: "gpt-5.4-mini" },
    routing: {
      decision: "pinned",
      candidatesConsidered: [
        { provider: "openai", model: "gpt-5.4-mini" },
        {
          provider: "fireworks",
          model: "accounts/fireworks/models/deepseek-v4-pro",
        },
      ],
      policyVersion: "policy-v2",
      cacheStickinessApplied: false,
      routeSource: "org",
      attemptCount: 2,
    },
    usage: {
      inputTokens: 41,
      outputTokens: 7,
      cachedInputTokens: 11,
      reasoningTokens: 2,
    },
    costUsd: 0.00125,
    costStatus: "priced" as const,
    output,
    finishReason: "stop",
  };
}

function generationContext() {
  const settings = {
    routes: {
      extraction: {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-flash",
      },
      extraction_quality: { provider: "openai", model: "gpt-5.4-mini" },
      extraction_coverage_cleanup: {
        provider: "openai",
        model: "gpt-5.4-mini",
      },
      classification: {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-flash",
      },
      extraction_coverage_recovery: {
        provider: "openai",
        model: "gpt-5.4-mini",
      },
      chat: {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-flash",
      },
      chat_vision: { provider: "openai", model: "gpt-5.6-terra" },
      analysis: {
        provider: "fireworks",
        model: "accounts/fireworks/models/glm-5p2",
      },
      fallback: {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v4-pro",
      },
    },
    routeSources: {
      extraction: "global",
      extraction_quality: "broker",
      extraction_coverage_cleanup: "broker",
      classification: "global",
      extraction_coverage_recovery: "global",
      chat: "broker",
      chat_vision: "org",
      analysis: "global",
      fallback: "static",
    },
  };
  return {
    settings,
    runQuery: vi.fn(async () => settings),
    runMutation: vi.fn(async () => undefined),
  };
}

describe("cl-router embedding callbacks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("chunks routed embedding batches below the Convex response value limit", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const texts = Array.from({ length: 131 }, (_, index) => `text-${index}`);
    const embedding = Array.from({ length: 1536 }, () => 0.25);
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(init?.body as string) as { texts: string[] };
        return Response.json(
          embeddingResponse(request.texts.map(() => embedding)),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const ctx = embeddingContext();

    const result = await makeEmbedTexts(
      ctx as never,
      "org-1" as Id<"organizations">,
    )(texts);

    expect(result).toHaveLength(131);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(
      ([, init]) =>
        JSON.parse((init as RequestInit).body as string) as {
          texts: string[];
          trace: { batchIndex: number; batchCount: number };
        },
    );
    expect(requests.map((request) => request.texts.length)).toEqual([130, 1]);
    expect(requests.map((request) => request.trace)).toEqual([
      expect.objectContaining({ batchIndex: 1, batchCount: 2 }),
      expect.objectContaining({ batchIndex: 2, batchCount: 2 }),
    ]);
    expect(ctx.runQuery).toHaveBeenCalledOnce();
  });
});

describe("cl-router generation callbacks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("preserves quality-primary extraction inputs and records actual router trace metadata", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () =>
      Response.json(generationResponse({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ctx = generationContext();
    const generateObject = makeGenerateObject("extraction", {
      ctx: ctx as never,
      orgId: "org-1" as Id<"organizations">,
      traceId: "trace-1",
      tracePolicyId: "policy-1",
    });
    const schema = z.object({ ok: z.boolean() });
    const input = {
      prompt: "Return effectiveDate and expirationDate.",
      system: "Extract only sourced values.",
      schema,
      maxTokens: 9_000,
      taskKind: "extraction_source_tree" as const,
      trace: {
        label: "Build source tree",
        phase: "source_tree",
        extractorName: "sourceTree",
      },
      providerOptions: {
        pdfUrl:
          "https://merry-platypus-82.convex.cloud/api/storage/document.pdf",
        pdfBytes: new Uint8Array([1, 2, 3]),
        mimeType: "application/pdf",
        images: [{ imageBase64: "AQID", mimeType: "image/png" }],
      },
    };

    await expect(generateObject(input)).resolves.toEqual({
      object: { ok: true },
      usage: { inputTokens: 41, outputTokens: 7 },
    });
    await generateObject(input);

    expect(ctx.runQuery).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://router.example.test/v1/generate");
    const request = JSON.parse(init.body as string);
    expect(request).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      task: "extraction",
      taskKind: "extraction_source_tree",
      system: "Extract only sourced values.",
      maxTokens: 4_096,
      sessionKey: "trace-1",
      settings: ctx.settings,
      routing: {
        allowFallback: true,
      },
      trace: {
        traceId: "trace-1",
        label: "Build source tree",
        phase: "source_tree",
        taskKind: "extraction_source_tree",
        policyId: "policy-1",
        channel: "convex",
      },
    });
    expect(request.routing).not.toHaveProperty("pin");
    expect(request.schema).toMatchObject({
      type: "object",
      properties: { ok: { type: "boolean" } },
    });
    const messageParts = request.messages[0].content as Array<
      Record<string, unknown>
    >;
    expect(messageParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          image: "AQID",
          mediaType: "image/png",
        }),
        expect.objectContaining({
          type: "file",
          source: {
            url: "https://merry-platypus-82.convex.cloud/api/storage/document.pdf",
            mediaType: "application/pdf",
            filename: "document.pdf",
            sizeBytes: 3,
          },
        }),
      ]),
    );
    expect(messageParts.find((part) => part.type === "text")?.text).toBe(
      "Return effectiveDate and expirationDate.",
    );

    const traceEvent = (
      ctx.runMutation.mock.calls as unknown[][]
    )[0]?.[1] as Record<string, unknown>;
    expect(traceEvent).toMatchObject({
      traceId: "trace-1",
      kind: "model_call",
      task: "extraction",
      taskKind: "extraction_source_tree",
      provider: "openai",
      model: "gpt-5.4-mini",
      routeSource: "org",
      transport: "cl-router",
      attempt: 2,
      inputTokens: 41,
      outputTokens: 7,
      cachedInputTokens: 11,
      routerRequestId: "generate-request-1",
      costUsd: 0.00125,
      costStatus: "priced",
      routingDecision: "pinned",
      routing: generationResponse(null).routing,
      status: "complete",
    });
  });

  test("stages large PDF and image references and cleans them after router failure", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    vi.stubEnv("CONVEX_SITE_URL", "https://actions.spot.insure");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const settings = generationContext().settings;
    const storageIds = ["storage-image", "storage-pdf"] as Id<"_storage">[];
    const assetIds = ["asset-image", "asset-pdf"] as Id<"routerAssets">[];
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(settings)
        .mockResolvedValueOnce({ storageId: storageIds[0] })
        .mockResolvedValueOnce({ storageId: storageIds[1] }),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce(assetIds[0])
        .mockResolvedValueOnce(assetIds[1])
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true),
      storage: {
        store: vi
          .fn()
          .mockResolvedValueOnce(storageIds[0])
          .mockResolvedValueOnce(storageIds[1]),
        delete: vi.fn(async () => undefined),
      },
    };
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body));
        const file = request.messages[0].content.find(
          (part: { type: string }) => part.type === "file",
        );
        expect(file).toMatchObject({
          type: "file",
          source: {
            url: expect.stringMatching(
              /^https:\/\/actions\.spot\.insure\/router-assets\?/,
            ),
            sizeBytes: 3 * 1024 * 1024,
          },
        });
        expect(file).not.toHaveProperty("data");
        const image = request.messages[0].content.find(
          (part: { type: string }) => part.type === "image",
        );
        expect(image).toMatchObject({
          type: "image",
          source: {
            url: expect.stringMatching(
              /^https:\/\/actions\.spot\.insure\/router-assets\?/,
            ),
            sizeBytes: 3 * 1024 * 1024,
          },
        });
        expect(image).not.toHaveProperty("image");
        return Response.json(
          {
            error: {
              code: "router_unavailable",
              message: "Router unavailable",
              retryable: true,
              executionStarted: false,
              attempts: [],
            },
          },
          { status: 503 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeGenerateObject("extraction", {
        ctx: ctx as never,
        orgId: "org-1" as Id<"organizations">,
      })({
        prompt: "Extract",
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 100,
        providerOptions: {
          pdfBytes: new Uint8Array(3 * 1024 * 1024),
          mimeType: "application/pdf",
          images: [
            {
              imageBase64: Buffer.alloc(3 * 1024 * 1024).toString("base64"),
              mimeType: "image/png",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ routerCode: "router_unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(ctx.storage.store).toHaveBeenCalledTimes(2);
    expect(ctx.storage.delete).toHaveBeenCalledWith(storageIds[0]);
    expect(ctx.storage.delete).toHaveBeenCalledWith(storageIds[1]);
  });

  test("cleans an earlier staged asset when a later asset exceeds the per-asset limit", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    vi.stubEnv("CONVEX_SITE_URL", "https://actions.spot.insure");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const settings = generationContext().settings;
    const storageId = "storage-first" as Id<"_storage">;
    const assetId = "asset-first" as Id<"routerAssets">;
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(settings)
        .mockResolvedValueOnce({ storageId }),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce(assetId)
        .mockResolvedValueOnce(true),
      storage: {
        store: vi.fn(async () => storageId),
        delete: vi.fn(async () => undefined),
      },
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeGenerateObject("extraction", {
        ctx: ctx as never,
        orgId: "org-1" as Id<"organizations">,
      })({
        prompt: "Extract",
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 100,
        providerOptions: {
          images: [
            {
              imageBase64: Buffer.alloc(3 * 1024 * 1024).toString("base64"),
              mimeType: "image/png",
            },
            {
              imageBase64: Buffer.alloc(12 * 1024 * 1024 + 1).toString(
                "base64",
              ),
              mimeType: "image/png",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ kind: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.storage.store).toHaveBeenCalledOnce();
    expect(ctx.storage.delete).toHaveBeenCalledWith(storageId);
  });

  test("returns a successful router result when signed asset cleanup fails", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    vi.stubEnv("CONVEX_SITE_URL", "https://actions.spot.insure");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const settings = generationContext().settings;
    const storageId = "storage-cleanup-failure" as Id<"_storage">;
    const assetId = "asset-cleanup-failure" as Id<"routerAssets">;
    const cleanupFailure = new Error("cleanup lookup failed");
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce(settings)
        .mockRejectedValueOnce(cleanupFailure),
      runMutation: vi
        .fn()
        .mockResolvedValueOnce(assetId)
        .mockResolvedValueOnce(undefined),
      storage: {
        store: vi.fn(async () => storageId),
        delete: vi.fn(async () => undefined),
      },
    };
    const fetchMock = vi.fn(async () =>
      Response.json(generationResponse({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      makeGenerateObject("extraction", {
        ctx: ctx as never,
        orgId: "org-1" as Id<"organizations">,
      })({
        prompt: "Extract",
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 100,
        providerOptions: {
          pdfBytes: new Uint8Array(3 * 1024 * 1024),
          mimeType: "application/pdf",
        },
      }),
    ).resolves.toEqual({
      object: { ok: true },
      usage: { inputTokens: 41, outputTokens: 7 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[cl-router] 1 staged asset cleanups failed",
    );
  });
});
