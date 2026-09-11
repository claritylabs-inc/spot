/// <reference types="vite/client" />
// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { makeGenerateObject } from "./sdkCallbacks";

function response(output: unknown) {
  return {
    requestId: "request-1",
    model: { provider: "openai", model: "gpt-5.4-mini" },
    routing: {
      decision: "static",
      candidatesConsidered: [{ provider: "openai", model: "gpt-5.4-mini" }],
      policyVersion: "policy-v1",
      cacheStickinessApplied: false,
      routeSource: "static",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 5,
      outputTokens: 2,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    },
    costUsd: null,
    costStatus: "unpriced",
    output,
  };
}

describe("sdkCallbacks router inputs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("keeps a small PDF inline and executes only through cl-router", async () => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () => Response.json(response({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeGenerateObject("extraction")({
        prompt: "Extract",
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 100,
        providerOptions: {
          pdfBytes: new Uint8Array([1, 2, 3]),
          mimeType: "application/pdf",
        },
      }),
    ).resolves.toMatchObject({ object: { ok: true } });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const request = JSON.parse(String(init.body));
    expect(request.messages[0].content).toContainEqual({
      type: "file",
      data: "AQID",
      mediaType: "application/pdf",
      filename: "document.pdf",
    });
    expect(JSON.stringify(request)).not.toContain("providerKeys");
  });

  test("fails closed when router output violates the schema", async () => {
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn(async () =>
      Response.json(response({ ok: "not-a-boolean" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      makeGenerateObject("extraction")({
        prompt: "Extract",
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 100,
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
