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
    decision: "routed",
    primitive: "reasoning",
    difficulty: "standard",
    requiredTier: 2,
    selectedTier: 2,
    route: {
      provider: "fireworks",
      model: "accounts/fireworks/models/deepseek-v3p2",
    },
    source: "jev",
    attemptCount: 1,
  },
  requestId: "router-request-1",
};

test("request builder maps extraction to a primitive request and never sends settings, pins, or provider keys", () => {
  const schema = {
    type: "object",
    properties: { policyNumber: { type: "string" } },
  };
  const request = buildClRouterGenerateRequest({
    task: "extraction",
    taskKind: "extraction_focused",
    tenantId: "spot",
    orgId: "org-1",
    prompt: "Extract the policy.",
    schema,
    maxTokens: 4096,
    route: { provider: "openai", model: "gpt-5.4-mini" },
    assets: {
      pdfUrl: "https://storage.example.test/policy.pdf",
      pdfBytes: Uint8Array.from([1, 2, 3]),
      images: [{ imageBase64: "image-data", mimeType: "image/png" }],
    },
  });
  assert.equal(request.primitive, "multimodal");
  assert.deepEqual(request.requirements, {
    structuredOutput: true,
  });
  assert.equal("task" in request, false);
  assert.equal("settings" in request, false);
  assert.equal("sessionKey" in request, false);
  assert.equal("routing" in request, false);
  assert.deepEqual(request.route, {
    provider: "openai",
    model: "gpt-5.4-mini",
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
  let url: string | undefined;
  const client = createClRouterClient({
    baseUrl: "https://router.internal/",
    secret: "shared-secret",

    fetch: async (input, init) => {
      url = String(input);
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
  assert.match(String(url), /\/v1\/generate$/);
  const body = JSON.parse(String(request?.body));
  assert.equal(body.executionBudgetMs, undefined);
  assert.equal(body.primitive, "reasoning");
  assert.equal("task" in body, false);
  assert.equal("settings" in body, false);
  assert.equal("routing" in body, false);
  assert.equal(result.requestId, "router-request-1");
  assert.equal(result.model.provider, "fireworks");
  assert.equal(result.routing.decision, "routed");
  assert.equal(result.routing.source, "jev");
});

test("client permits plaintext only for loopback hosts", async () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const client = createClRouterClient({
      baseUrl: `http://${host}:3000`,
      secret: "shared-secret",

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
      }),
    /must use HTTPS/,
  );
});

test("client preserves connection failures without a direct-provider fallback", async () => {
  const disconnected = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",

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

test("client rejects an explicitly empty image before fetch", async () => {
  let fetchCalls = 0;
  const client = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",

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
        images: [{ imageBase64: " \n\t", mimeType: "image/png" }],
      },
    }),
    (error) =>
      error instanceof ClRouterProtocolError &&
      /nonempty base64 data/.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test("client rejects loopback assets before calling a cloud router", async () => {
  let fetchCalls = 0;
  const client = createClRouterClient({
    baseUrl: "https://router.internal",
    secret: "shared-secret",

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

test("pinned extraction uses /v1/manual", async () => {
  let url: string | undefined;
  const client = createClRouterClient({
    baseUrl: "https://router.internal/",
    secret: "shared-secret",
    fetch: async (input) => {
      url = String(input);
      return Response.json({
        ...responseBody,
        routing: {
          ...responseBody.routing,
          decision: "manual",
          source: "manual",
        },
      });
    },
  });
  await client.generate({
    task: "extraction",
    tenantId: "glass",
    prompt: "Extract.",
    schema: { type: "object" },
    route: { provider: "openai", model: "gpt-5.4-mini" },
  });
  assert.match(String(url), /\/v1\/manual$/);
});
