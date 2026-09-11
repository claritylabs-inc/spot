import { afterEach, describe, expect, test, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import { runOperatorWebRetrieval, runWebRetrieval } from "./webRetrieval";

describe("router-owned web retrieval", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test.each([
    { query: "commercial insurance limits" },
    { url: "https://example.com/policy" },
  ])("propagates router failure without a direct fallback for $url$query", async (input) => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "router_unavailable",
            message: "Retrieval unavailable",
            retryable: true,
            executionStarted: false,
            attempts: [],
          },
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ctx = {
      runQuery: vi.fn(async () => ({
        routes: { chat: { provider: "openai", model: "gpt-5.5" } },
        webRetrieval: { primary: "parallel" },
      })),
    };

    await expect(
      runWebRetrieval(
        ctx as never,
        "org-1" as Id<"organizations">,
        input,
      ),
    ).rejects.toMatchObject({ routerCode: "router_unavailable" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://router.example.test/v1/retrieve",
    );
  });

  test("routes operator retrieval through cl-router with the selected native pin", async () => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () =>
      Response.json({
        provider: "openai",
        attempts: [{ provider: "openai", ok: true }],
        text: "Synthetic result",
        sources: [{ url: "https://example.com" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ webRetrieval: { primary: "model_default" } })
      .mockResolvedValueOnce({ provider: "openai", model: "gpt-5.5" });

    await expect(
      runOperatorWebRetrieval(
        { runQuery } as never,
        { query: "synthetic operator search" },
      ),
    ).resolves.toMatchObject({ provider: "openai", text: "Synthetic result" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://router.example.test/v1/retrieve");
    expect(JSON.parse(String(init.body))).toMatchObject({
      tenantId: "glass",
      input: { query: "synthetic operator search" },
      config: {
        primary: "model_default",
        route: { provider: "openai", model: "gpt-5.5" },
      },
    });
  });
});
