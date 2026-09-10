import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { transcribeAudioForOrg } from "./models";

const route = {
  provider: "openai" as const,
  model: "gpt-4o-mini-transcribe",
};

function context() {
  const runQuery = vi
    .fn()
    .mockResolvedValueOnce({
      routes: { voice_transcription: route },
      routeSources: { voice_transcription: "broker" },
    })
    .mockResolvedValueOnce({ storageId: "storage-audio-1" });
  const runMutation = vi
    .fn()
    .mockResolvedValueOnce("router-asset-1")
    .mockResolvedValueOnce(null);
  const storage = {
    store: vi.fn(async () => "storage-audio-1"),
    delete: vi.fn(async () => undefined),
  };
  return { runQuery, runMutation, storage };
}

function routerResponse() {
  return Response.json({
    requestId: "request-1",
    model: route,
    routing: {
      decision: "snapshot",
      candidatesConsidered: [route],
      policyVersion: "policy-v1",
      cacheStickinessApplied: false,
      routeSource: "broker",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    },
    costUsd: 0.001,
    costStatus: "priced",
    text: "Router transcript.",
  });
}

describe("audio transcription routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("uses router JSON with a short-lived signed asset reference", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    vi.stubEnv("CONVEX_SITE_URL", "https://actions.spot.insure");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const ctx = context();
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      routerResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudioForOrg(
      ctx as never,
      "org-1" as Id<"organizations">,
      {
        data: Buffer.from("voice"),
        filename: "Audio Message.caf",
        mediaType: "audio/mp4",
      },
    );

    expect(result).toMatchObject({
      text: "Router transcript.",
      route,
      routeSource: "broker",
      transport: "cl-router",
      clRouter: { requestId: "request-1", costUsd: 0.001 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://router.example.test/v1/transcribe",
    );
    const request = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(request).toMatchObject({
      tenantId: "glass",
      orgId: "org-1",
      audio: {
        mediaType: "audio/mp4",
        filename: "Audio Message.m4a",
        sizeBytes: 5,
      },
    });
    expect(request.audio.url).toMatch(
      /^https:\/\/actions\.spot\.insure\/router-assets\?/,
    );
    expect(request.audio.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(request.settings).not.toHaveProperty("providerKeys");
    expect(ctx.storage.delete).toHaveBeenCalledWith("storage-audio-1");
  });

  test("fails closed on a router outage and still cleans up the asset", async () => {
    vi.stubEnv("SPOT_ENV", "production");
    vi.stubEnv("CONVEX_SITE_URL", "https://actions.spot.insure");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const ctx = context();
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          error: {
            code: "router_unavailable",
            message: "No eligible route is available.",
            retryable: true,
            executionStarted: false,
            requestId: "failed-transcription-request",
          },
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeAudioForOrg(
        ctx as never,
        "org-1" as Id<"organizations">,
        {
          data: Buffer.from("voice"),
          filename: "Audio Message.m4a",
          mediaType: "audio/mp4",
        },
      ),
    ).rejects.toThrow("No eligible route is available");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://router.example.test/v1/transcribe",
    );
    expect(ctx.storage.delete).toHaveBeenCalledWith("storage-audio-1");
  });
});
