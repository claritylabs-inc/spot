import { describe, expect, test, vi } from "vitest";

import {
  ClRouterRequestError,
  assertSpotRouterAssetUrl,
  clRouterCapabilities,
  clRouterGenerate,
  clRouterGenerateStream,
  clRouterRetrieve,
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
      decision: "policy",
      candidatesConsidered: [{ provider: "openai", model: "gpt-5-mini" }],
      policyVersion: "policy-v1",
      cacheStickinessApplied: false,
      routeSource: "org",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      cachedInputTokens: 0,
      cacheWriteTokens: 1,
    },
    costUsd: 0.0001,
    costStatus: "priced",
  };
}

describe("cl-router requests", () => {
  test("sends only route metadata and preserves router lineage", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ...responseMetadata(),
        output: { disposition: "deliver" },
        finishReason: "stop",
      }),
    );
    await clRouterGenerate(
      {
        task: "classification",
        orgId: "org-1",
        settings: {
          routes: {
            classification: { provider: "openai", model: "gpt-5-mini" },
          },
          routeSources: { classification: "org" },
        },
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
    expect(body).toMatchObject({ tenantId: "glass", orgId: "org-1" });
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
        { task: "extraction", prompt: "Extract." },
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
        { task: "chat", prompt: "x".repeat(4 * 1024 * 1024) },
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
          task: "chat",
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
            task: "chat",
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
    ).toThrowError(/loopback cl-router/);
  });
});
