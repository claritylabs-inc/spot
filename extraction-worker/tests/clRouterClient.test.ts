import assert from "node:assert/strict";
import test from "node:test";
import {
  ClRouterConnectionError,
  ClRouterHttpError,
  ClRouterProtocolError,
  CL_ROUTER_MAX_ASSET_BYTES,
  CL_ROUTER_MAX_JSON_BYTES,
  buildClRouterGenerateRequest,
  createClRouterClient,
} from "../src/clRouterClient.js";

const responseBody = {
  output: { policyNumber: "SYN-1" },
  usage: {
    inputTokens: 20,
    outputTokens: 4,
    cachedInputTokens: 2,
    cacheWriteTokens: 1,
  },
  costUsd: 0.00004,
  costStatus: "priced",
  model: {
    provider: "fireworks",
    model: "accounts/fireworks/models/deepseek-v3p2",
  },
  routing: {
    decision: "autonomous",
    candidatesConsidered: [
      {
        provider: "fireworks",
        model: "accounts/fireworks/models/deepseek-v3p2",
      },
    ],
    policyVersion: "policy-v1",
    cacheStickinessApplied: false,
    routeSource: "autonomous",
    attemptCount: 1,
    shadowMode: true,
    wouldHaveChosen: {
      provider: "openai",
      model: "gpt-5-mini",
      decision: "autonomous_primary",
    },
    wouldHaveMatched: false,
  },
  requestId: "router-request-1",
};

test("request builder strips provider keys and references the signed PDF with integrity", () => {
  const schema = {
    type: "object",
    properties: { policyNumber: { type: "string" } },
  };
  const settings: {
    routes: Record<string, { provider: string; model: string }>;
    routeSources: Record<string, string>;
    providerKeys?: Record<string, string>;
  } = {
    routes: { extraction: { provider: "openai", model: "gpt-5.4-mini" } },
    routeSources: { extraction: "broker" },
    providerKeys: { openai: "broker-secret" },
  };
  const request = buildClRouterGenerateRequest({
    task: "extraction",
    taskKind: "extraction_focused",
    tenantId: "spot",
    orgId: "org-1",
    settings,
    prompt: "Extract the policy.",
    schema,
    maxTokens: 4096,
    routing: {
      pin: { provider: "openai", model: "gpt-5.4-mini" },
      allowFallback: true,
    },
    assets: {
      pdfUrl: "https://storage.example.test/policy.pdf",
      pdfBytes: Uint8Array.from([1, 2, 3]),
      images: [{ imageBase64: "image-data", mimeType: "image/png" }],
    },
  });
  assert.deepEqual(request.settings, {
    routes: settings.routes,
    routeSources: settings.routeSources,
  });
  assert.equal("providerKeys" in (request.settings ?? {}), false);
  assert.deepEqual(request.routing, {
    pin: { provider: "openai", model: "gpt-5.4-mini" },
    allowFallback: true,
  });
  assert.deepEqual(request.schema, schema);
  assert.equal(request.prompt, undefined);
  assert.equal(request.messages?.[0]?.content[0]?.type, "image");
  assert.deepEqual(request.messages?.[0]?.content[1], {
    type: "file",
    source: {
      url: "https://storage.example.test/policy.pdf",
      mediaType: "application/pdf",
      filename: "document.pdf",
      sizeBytes: 3,
      sha256:
        "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    },
  });
});

test("request builder enforces fetchable references and exact router payload limits", () => {
  const base = {
    task: "extraction",
    tenantId: "glass",
    prompt: "Extract.",
    schema: { type: "object" },
  };
  assert.throws(
    () =>
      buildClRouterGenerateRequest({
        ...base,
        assets: {
          pdfUrl: "http://storage.example.test/policy.pdf",
          pdfBytes: Uint8Array.from([1]),
        },
      }),
    /HTTPS URLs/,
  );
  assert.doesNotThrow(() =>
    buildClRouterGenerateRequest({
      ...base,
      assets: {
        pdfUrl: "http://127.0.0.1:3211/router-assets?assetId=local",
        pdfBytes: Uint8Array.from([1]),
      },
    }),
  );
  assert.throws(
    () =>
      buildClRouterGenerateRequest({
        ...base,
        assets: {
          images: [
            {
              imageBase64: Buffer.alloc(CL_ROUTER_MAX_ASSET_BYTES + 1).toString(
                "base64",
              ),
              mimeType: "image/png",
            },
          ],
        },
      }),
    /asset limit|assets must be between/,
  );
  const jsonOverflowBytes = Math.floor(CL_ROUTER_MAX_JSON_BYTES * 0.76);
  assert.throws(
    () =>
      buildClRouterGenerateRequest({
        ...base,
        assets: {
          images: [
            {
              imageBase64: Buffer.alloc(jsonOverflowBytes).toString("base64"),
              mimeType: "image/png",
            },
          ],
        },
      }),
    /JSON limit/,
  );
  const reference = {
    url: "https://actions.spot.insure/router-assets?assetId=asset-1&expiresAt=1&signature=sig",
    mediaType: "image/png",
    sizeBytes: 1,
    sha256: "00",
  };
  const referenced = buildClRouterGenerateRequest({
    ...base,
    assets: { images: [{ source: reference }] },
  });
  assert.deepEqual(referenced.messages?.[0]?.content[0], {
    type: "image",
    source: reference,
  });
  assert.throws(
    () =>
      buildClRouterGenerateRequest({
        ...base,
        assets: {
          images: Array.from({ length: 9 }, () => ({ source: reference })),
        },
      }),
    /at most 8 assets/,
  );
  assert.throws(
    () =>
      buildClRouterGenerateRequest({
        ...base,
        assets: {
          images: [
            { source: { ...reference, sizeBytes: 9 * 1024 * 1024 } },
            { source: { ...reference, sizeBytes: 8 * 1024 * 1024 } },
          ],
        },
      }),
    /aggregate limit/,
  );
});

test("client authenticates and preserves routing lineage", async () => {
  let request: RequestInit | undefined;
  const client = createClRouterClient({
    baseUrl: "https://router.internal/",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async (_input, init) => {
      request = init;
      return Response.json(responseBody);
    },
  });
  const result = await client.generate({
    task: "extraction_preview",
    tenantId: "spot",
    prompt: "Extract preview.",
    schema: { type: "object" },
  });
  assert.equal(
    new Headers(request?.headers).get("authorization"),
    "Bearer shared-secret",
  );
  assert.equal(JSON.parse(String(request?.body)).executionBudgetMs, 100);
  assert.equal(result.requestId, "router-request-1");
  assert.equal(result.model.provider, "fireworks");
  assert.equal(result.routing.policyVersion, "policy-v1");
});

test("client permits plaintext only for loopback hosts", async () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const client = createClRouterClient({
      baseUrl: `http://${host}:3000`,
      secret: "shared-secret",
      timeoutMs: 1000,
      fetch: async () => Response.json(responseBody),
    });
    await client.generate({
      task: "extraction",
      tenantId: "spot",
      prompt: "Extract.",
      schema: { type: "object" },
    });
  }

  assert.throws(
    () =>
      createClRouterClient({
        baseUrl: "http://router.internal",
        secret: "shared-secret",
        timeoutMs: 1000,
      }),
    /must use HTTPS/,
  );
});

test("client preserves connection failures without a direct-provider fallback", async () => {
  const disconnected = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        code: "ECONNREFUSED",
      });
    },
  });
  await assert.rejects(
    disconnected.generate({
      task: "extraction",
      tenantId: "spot",
      prompt: "Extract.",
      schema: { type: "object" },
    }),
    (error) =>
      error instanceof ClRouterConnectionError && error.kind === "connection",
  );
});

test("client rejects an oversized request as a protocol error before fetch", async () => {
  let fetchCalls = 0;
  const client = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async () => {
      fetchCalls += 1;
      return Response.json(responseBody);
    },
  });
  await assert.rejects(
    client.generate({
      task: "extraction",
      tenantId: "glass",
      prompt: "x".repeat(CL_ROUTER_MAX_JSON_BYTES),
      schema: { type: "object" },
    }),
    (error) =>
      error instanceof ClRouterProtocolError &&
      /JSON limit/.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test("client rejects loopback assets before calling a cloud router", async () => {
  let fetchCalls = 0;
  const client = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async () => {
      fetchCalls += 1;
      return Response.json(responseBody);
    },
  });
  await assert.rejects(
    client.generate({
      task: "extraction",
      tenantId: "glass",
      prompt: "Extract.",
      schema: { type: "object" },
      assets: {
        images: [
          {
            source: {
              url: "http://127.0.0.1:3211/router-assets?assetId=local",
              mediaType: "image/png",
              sizeBytes: 3,
            },
          },
        ],
      },
    }),
    (error) =>
      error instanceof ClRouterProtocolError &&
      /loopback cl-router/.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test("client preserves typed router failure metadata", async () => {
  const client = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async () =>
      Response.json(
        {
          error: {
            code: "router_unavailable",
            message: "No eligible cross-provider route is available.",
            retryable: true,
            executionStarted: false,
            requestId: "request-typed",
          },
        },
        { status: 503 },
      ),
  });
  await assert.rejects(
    client.generate({
      task: "extraction",
      tenantId: "spot",
      prompt: "Extract.",
      schema: { type: "object" },
    }),
    (error) =>
      error instanceof ClRouterHttpError &&
      error.routerCode === "router_unavailable" &&
      error.executionStarted === false &&
      error.requestId === "request-typed",
  );
});

test("invalid 2xx responses fail closed", async () => {
  const client = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",
    timeoutMs: 1000,
    fetch: async () => Response.json({ output: {} }),
  });
  await assert.rejects(
    client.generate({
      task: "extraction",
      tenantId: "spot",
      prompt: "Extract.",
      schema: { type: "object" },
    }),
    ClRouterProtocolError,
  );
});
