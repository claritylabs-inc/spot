/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  OPERATIONAL_ROUTER_SMOKE_AUDIO_FILENAME,
  OPERATIONAL_ROUTER_SMOKE_AUDIO_MAX_BYTES,
  OPERATIONAL_ROUTER_SMOKE_AUDIO_MEDIA_TYPE,
  OPERATIONAL_ROUTER_SMOKE_AUDIO_MIN_BYTES,
  OPERATIONAL_ROUTER_SMOKE_PDF_BYTES,
  OPERATIONAL_ROUTER_SMOKE_RETRIEVAL_URL,
  createOperationalSmokePdf,
  decodeOperationalSmokeAudio,
  runOperationalRouterSmoke,
  summarizeOperationalSmokeEmbeddings,
  type OperationalRouterSmokeAdapters,
} from "./actions/operationalRouterSmoke";
import { OPERATIONAL_ROUTER_SMOKE_PREFIX } from "./operationalRouterSmoke";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const runAction = makeFunctionReference<"action">(
  "actions/operationalRouterSmoke:run",
);
const markerPattern = new RegExp(
  `^${OPERATIONAL_ROUTER_SMOKE_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
);

function validM4a(byteLength = OPERATIONAL_ROUTER_SMOKE_AUDIO_MIN_BYTES) {
  const bytes = Buffer.alloc(byteLength);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("M4A ", 8, "ascii");
  return bytes;
}

function routerMetadata(requestId: string, route: unknown) {
  return {
    requestId,
    model: route,
    routing: {
      decision: "pin",
      candidatesConsidered: [route],
      policyVersion: "smoke-policy-v1",
      cacheStickinessApplied: true,
      routeSource: "global",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 4,
      outputTokens: 2,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    },
    costUsd: 0,
    costStatus: "priced",
  };
}

function successfulAdapters(
  overrides: Partial<OperationalRouterSmokeAdapters> = {},
) {
  const fixture = {
    smokeRunId: "smoke-run" as Id<"operationalRouterSmokeRuns">,
    orgId: "smoke-org" as Id<"organizations">,
  };
  const adapters: OperationalRouterSmokeAdapters = {
    createFixture: vi.fn(async () => fixture),
    cleanupFixture: vi.fn(async () => ({
      fixtureDeleted: true,
      routingEventCount: 2,
      durableAssetLedgerCount: 0,
    })),
    generateText: vi.fn(async () => ({ ok: true, requestId: "generate-1" })),
    generateObject: vi.fn(async () => ({ ok: true, requestId: "object-1" })),
    runToolLoop: vi.fn(async () => ({
      ok: true,
      toolCallCount: 1,
      stepCount: 2,
      routePinned: true,
      requestIds: ["tool-1", "tool-2"],
    })),
    embed: vi.fn(async () => ({
      ok: true,
      inputCount: 1,
      vectorCount: 1,
      dimensions: 1536,
    })),
    retrieve: vi.fn(async () => ({
      ok: true,
      attemptCount: 1,
      sourceCount: 1,
    })),
    transcribe: vi.fn(async () => ({ ok: true, requestId: "audio-1" })),
    runPdfAsset: vi.fn(async () => ({
      ok: true,
      decodedByteCount: OPERATIONAL_ROUTER_SMOKE_PDF_BYTES,
      requestId: "pdf-1",
    })),
    ...overrides,
  };
  return { adapters, fixture };
}

describe("operational router smoke input boundary", () => {
  test("keeps the complete validation token visible in the exact-size PDF", async () => {
    const validationToken = "12345678-1234-4123-8123-123456789abc";
    const pdf = await createOperationalSmokePdf(validationToken);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await getDocument({ data: pdf.slice() }).promise;
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const visibleText = content.items
      .flatMap((item) => ("str" in item ? [item.str] : []))
      .join(" ");

    expect(pdf.byteLength).toBe(OPERATIONAL_ROUTER_SMOKE_PDF_BYTES);
    expect(document.numPages).toBe(1);
    expect(visibleText).toContain("SPOT ROUTER ASSET ACCEPTANCE");
    expect(visibleText).toContain(validationToken);
    await document.destroy();
  });

  test("accepts only canonical, bounded M4A container bytes", () => {
    const minimum = validM4a();
    const maximum = validM4a(OPERATIONAL_ROUTER_SMOKE_AUDIO_MAX_BYTES);

    expect(decodeOperationalSmokeAudio(minimum.toString("base64"))).toEqual(
      minimum,
    );
    expect(decodeOperationalSmokeAudio(maximum.toString("base64"))).toEqual(
      maximum,
    );

    const wrongContainer = validM4a();
    wrongContainer.write("moov", 4, "ascii");
    for (const invalid of [
      "",
      "not base64",
      validM4a(OPERATIONAL_ROUTER_SMOKE_AUDIO_MIN_BYTES - 1).toString("base64"),
      validM4a(OPERATIONAL_ROUTER_SMOKE_AUDIO_MAX_BYTES + 1).toString("base64"),
      wrongContainer.toString("base64"),
      `${minimum.toString("base64")}=`,
    ]) {
      expect(() => decodeOperationalSmokeAudio(invalid)).toThrow(
        /operational router smoke audio/i,
      );
    }
  });

  test.each([
    "orgId",
    "userId",
    "url",
    "storageId",
    "marker",
    "model",
    "task",
    "deleteId",
  ])("registered action rejects caller-controlled %s", async (field) => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(runAction, {
        audioBase64: validM4a().toString("base64"),
        [field]: "attacker-controlled",
      }),
    ).rejects.toThrow(/unexpected field|object contains extra field/i);
  });
});

describe("operational router smoke orchestration boundary", () => {
  test("requires a nonempty, finite, fixed-width embedding per input", () => {
    const valid = Array.from({ length: 1536 }, (_, index) => index / 1536);
    expect(summarizeOperationalSmokeEmbeddings([valid], 1)).toEqual({
      ok: true,
      inputCount: 1,
      vectorCount: 1,
      dimensions: 1536,
    });

    for (const embeddings of [
      [],
      [[1]],
      [valid, valid],
      [valid.with(42, Number.NaN)],
      [valid.with(42, Number.POSITIVE_INFINITY)],
    ]) {
      expect(summarizeOperationalSmokeEmbeddings(embeddings, 1).ok).toBe(false);
    }
    expect(summarizeOperationalSmokeEmbeddings([valid], 0).ok).toBe(false);
  });

  test("uses a random marker-owned fixture and returns only sanitized phase results", async () => {
    const { adapters, fixture } = successfulAdapters();
    const audio = validM4a();
    const ctx = {} as ActionCtx;

    const first = await runOperationalRouterSmoke(
      ctx,
      { audioBase64: audio.toString("base64") },
      adapters,
    );
    const firstMarker = vi.mocked(adapters.createFixture).mock.calls[0]?.[1];
    const toolMarker = vi.mocked(adapters.runToolLoop).mock.calls[0]?.[2];
    const pdfMarker = vi.mocked(adapters.runPdfAsset).mock.calls[0]?.[2];

    expect(firstMarker).toMatch(markerPattern);
    expect(toolMarker).toBe(firstMarker);
    expect(pdfMarker).toBe(firstMarker);
    expect(vi.mocked(adapters.transcribe).mock.calls[0]?.[2]).toEqual(audio);
    expect(vi.mocked(adapters.cleanupFixture)).toHaveBeenCalledWith(
      ctx,
      fixture.smokeRunId,
    );
    expect(first).toEqual({
      ok: true,
      generation: { ok: true, requestId: "generate-1" },
      structuredOutput: { ok: true, requestId: "object-1" },
      toolLoop: {
        ok: true,
        toolCallCount: 1,
        stepCount: 2,
        routePinned: true,
        requestIds: ["tool-1", "tool-2"],
      },
      embeddings: {
        ok: true,
        inputCount: 1,
        vectorCount: 1,
        dimensions: 1536,
      },
      retrieval: { ok: true, attemptCount: 1, sourceCount: 1 },
      transcription: { ok: true, requestId: "audio-1" },
      pdfAsset: {
        ok: true,
        decodedByteCount: OPERATIONAL_ROUTER_SMOKE_PDF_BYTES,
        requestId: "pdf-1",
      },
      cleanup: {
        cleanupRequestId: "smoke-run",
        fixtureDeleted: true,
        durableFallbackScheduled: true,
        routingEventCount: 2,
        durableAssetLedgerCount: 0,
      },
    });
    expect(JSON.stringify(first)).not.toMatch(
      /smoke-org|spot-router-operational-smoke|audioBase64|provider|model|secret/i,
    );

    await runOperationalRouterSmoke(
      ctx,
      { audioBase64: audio.toString("base64") },
      adapters,
    );
    const secondMarker = vi.mocked(adapters.createFixture).mock.calls[1]?.[1];
    expect(secondMarker).toMatch(markerPattern);
    expect(secondMarker).not.toBe(firstMarker);
  });

  test("always attempts marker-row cleanup and keeps only a sanitized durable fallback status", async () => {
    const cleanupFixture = vi.fn(async () => {
      throw new Error("storage-id-sensitive-cleanup-failure");
    });
    const generateText = vi.fn(async () => {
      throw new Error("router failed closed");
    });
    const { adapters, fixture } = successfulAdapters({
      cleanupFixture,
      generateText,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await runOperationalRouterSmoke(
      {} as ActionCtx,
      { audioBase64: validM4a().toString("base64") },
      adapters,
    );

    expect(result).toMatchObject({
      ok: false,
      generation: { ok: false, requestId: "" },
      cleanup: {
        cleanupRequestId: "smoke-run",
        fixtureDeleted: false,
        durableFallbackScheduled: true,
      },
    });

    expect(cleanupFixture).toHaveBeenCalledWith(
      expect.anything(),
      fixture.smokeRunId,
    );
    expect(warn).toHaveBeenCalledWith(
      "[cl-router] Operational smoke eager fixture cleanup failed; scheduled cleanup remains active",
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("storage-id-sensitive-cleanup-failure"),
    );
  });
});

describe("operational router smoke live-path contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("exercises every router surface without outbound business effects", async () => {
    vi.stubEnv("SPOT_ENV", "local");
    vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
    vi.stubEnv("CL_ROUTER_URL", "http://127.0.0.1:8787");
    vi.stubEnv("CL_ROUTER_SECRET", "router-smoke-secret");

    const fallbackRoute = {
      provider: "openai" as const,
      model: "gpt-5.6-terra",
    };
    const t = convexTest(schema, modules);
    const unrelatedOrgId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "Unrelated cleanup sentinel",
        type: "client",
      });
      const operatorUserId = await ctx.db.insert("users", {
        email: "router-smoke-operator@example.test",
        accountKind: "operator",
      });
      await ctx.db.insert("globalModelSettings", {
        key: "default",
        routes: { operator_agent: fallbackRoute },
        explicitRouteOverrides: ["operator_agent"],
        updatedBy: operatorUserId,
        updatedAt: 1,
      });
      return orgId;
    });
    const requests: Array<{ url: string; headers: Headers; body: any }> = [];
    let generateCount = 0;
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (!url.startsWith("http://127.0.0.1:8787/v1/")) {
        throw new Error(`Unexpected outbound request: ${url}`);
      }
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = new Headers(init?.headers);
      requests.push({ url, headers, body });
      const route = body?.routing?.pin ?? fallbackRoute;

      if (url.endsWith("/v1/generate")) {
        generateCount += 1;
        const outputs: Array<{ output: unknown; finishReason: string }> = [
          { output: "GENERATION_OK", finishReason: "stop" },
          { output: { ok: true }, finishReason: "stop" },
          {
            output: {
              toolCalls: [
                {
                  toolCallId: "echo-1",
                  toolName: "echo_smoke_marker",
                  input: { value: "SPOT_ROUTER_ECHO_OK" },
                },
              ],
            },
            finishReason: "tool-calls",
          },
          { output: "ECHO_CONTINUATION_OK", finishReason: "stop" },
          { output: "unused", finishReason: "stop" },
        ];
        const selected = outputs[generateCount - 1];
        if (!selected) throw new Error("Unexpected generate request");
        if (generateCount === 5) {
          const source = body.messages
            .flatMap((message: { content?: unknown }) =>
              Array.isArray(message.content) ? message.content : [],
            )
            .find((part: { type?: string }) => part.type === "file")?.source;
          if (!source?.url) throw new Error("PDF asset reference missing");
          const signedUrl = new URL(source.url);
          const pdfResponse = await t.fetch(
            `${signedUrl.pathname}${signedUrl.search}`,
          );
          const pdfText = Buffer.from(await pdfResponse.arrayBuffer()).toString(
            "ascii",
          );
          const validationToken = pdfText.match(
            /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
          )?.[0];
          if (!validationToken) throw new Error("PDF validation token missing");
          selected.output = { validationToken };
        }
        return Response.json({
          ...routerMetadata(`generate-${generateCount}`, route),
          ...selected,
        });
      }
      if (url.endsWith("/v1/embed")) {
        return Response.json({
          ...routerMetadata("embed-1", {
            provider: "openai",
            model: "text-embedding-3-small",
          }),
          embeddings: [
            Array.from({ length: 1536 }, (_, index) => index / 1536),
          ],
        });
      }
      if (url.endsWith("/v1/retrieve")) {
        return Response.json({
          provider: "parallel",
          attempts: [{ provider: "parallel", ok: true }],
          text: "Example Domain",
          sources: [
            {
              title: "Example Domain",
              url: OPERATIONAL_ROUTER_SMOKE_RETRIEVAL_URL,
            },
          ],
        });
      }
      if (url.endsWith("/v1/transcribe")) {
        return Response.json({
          ...routerMetadata("transcribe-1", {
            provider: "openai",
            model: "gpt-4o-mini-transcribe",
          }),
          text: "Synthetic router migration test phrase forty two.",
        });
      }
      throw new Error(`Unexpected router endpoint: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(runAction, {
      audioBase64: validM4a().toString("base64"),
    });

    expect(result.ok).toBe(true);
    expect(result.toolLoop).toMatchObject({
      ok: true,
      toolCallCount: 1,
      stepCount: 2,
      routePinned: true,
    });
    expect(result.embeddings).toEqual({
      ok: true,
      inputCount: 1,
      vectorCount: 1,
      dimensions: 1536,
    });
    expect(result.transcription).toMatchObject({ ok: true });
    expect(result.pdfAsset).toMatchObject({
      ok: true,
      decodedByteCount: OPERATIONAL_ROUTER_SMOKE_PDF_BYTES,
    });
    expect(result.cleanup).toMatchObject({
      fixtureDeleted: true,
      durableFallbackScheduled: true,
      durableAssetLedgerCount: 0,
    });

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/v1/generate",
      "/v1/generate",
      "/v1/generate",
      "/v1/generate",
      "/v1/embed",
      "/v1/retrieve",
      "/v1/transcribe",
      "/v1/generate",
    ]);
    for (const request of requests) {
      expect(request.headers.get("authorization")).toBe(
        "Bearer router-smoke-secret",
      );
      expect(request.body.tenantId).toBe("glass");
      expect(JSON.stringify(request.body)).not.toContain("providerKeys");
      expect(
        new TextEncoder().encode(JSON.stringify(request.body)).byteLength,
      ).toBeLessThanOrEqual(4 * 1024 * 1024);
    }

    const generationRequests = requests.filter(({ url }) =>
      url.endsWith("/v1/generate"),
    );
    expect(generationRequests.slice(0, 2).map(({ body }) => body.task)).toEqual(
      ["classification", "classification"],
    );
    expect(
      generationRequests.slice(0, 2).map(({ body }) => body.maxTokens),
    ).toEqual([256, 256]);
    expect(
      generationRequests.slice(0, 2).every(({ body }) => !body.taskKind),
    ).toBe(true);
    expect(
      generationRequests.some(
        ({ body }) => body.taskKind === "operational_router_smoke",
      ),
    ).toBe(false);

    const toolRequests = requests.filter(
      ({ body }) =>
        body.taskKind === "operator_agent" && body.trace?.phase === "tool_loop",
    );
    expect(toolRequests).toHaveLength(2);
    expect(toolRequests.map(({ body }) => body.maxTokens)).toEqual([512, 512]);
    expect(toolRequests[0]?.body.settings).toMatchObject({
      routes: { operator_agent: fallbackRoute },
      routeSources: { operator_agent: "global" },
    });
    expect(toolRequests[0]?.body.toolChoice).toEqual({
      type: "tool",
      toolName: "echo_smoke_marker",
    });
    expect(toolRequests[0]?.body.routing).toEqual({
      pin: fallbackRoute,
      allowFallback: false,
    });
    expect(toolRequests[1]?.body.routing).toEqual({
      pin: fallbackRoute,
      allowFallback: false,
    });
    expect(toolRequests[1]?.body.trace.parentRequestId).toBe("generate-3");
    expect(JSON.stringify(toolRequests[1]?.body.messages)).toContain(
      "SPOT_ROUTER_ECHO_OK",
    );

    const retrievalRequest = requests.find(({ url }) =>
      url.endsWith("/v1/retrieve"),
    );
    expect(retrievalRequest?.body.input).toEqual({
      url: OPERATIONAL_ROUTER_SMOKE_RETRIEVAL_URL,
      goal: "Retrieve the fixed IANA example page for an operational check.",
      allowedDomains: ["example.com"],
      maxResults: 1,
    });

    const transcriptionRequest = requests.find(({ url }) =>
      url.endsWith("/v1/transcribe"),
    );
    expect(transcriptionRequest?.body.audio).toMatchObject({
      mediaType: OPERATIONAL_ROUTER_SMOKE_AUDIO_MEDIA_TYPE,
      filename: OPERATIONAL_ROUTER_SMOKE_AUDIO_FILENAME,
      sizeBytes: OPERATIONAL_ROUTER_SMOKE_AUDIO_MIN_BYTES,
    });
    expect(transcriptionRequest?.body.audio.url).toMatch(
      /^http:\/\/localhost:3211\/router-assets\?/,
    );

    const pdfRequest = requests.find(
      ({ body }) => body.trace?.phase === "asset_fetch",
    );
    expect(pdfRequest?.body).toMatchObject({
      task: "chat_vision",
      taskKind: "operator_agent",
      maxTokens: 512,
      routing: { pin: fallbackRoute, allowFallback: false },
    });
    const pdfPart = pdfRequest?.body.messages
      .flatMap((message: { content?: unknown }) =>
        Array.isArray(message.content) ? message.content : [],
      )
      .find((part: { type?: string }) => part.type === "file");
    expect(pdfPart?.source).toMatchObject({
      mediaType: "application/pdf",
      filename: "synthetic-router-smoke.pdf",
      sizeBytes: OPERATIONAL_ROUTER_SMOKE_PDF_BYTES,
    });
    expect(pdfPart?.source.url).toMatch(
      /^http:\/\/localhost:3211\/router-assets\?/,
    );

    const tableCounts = await t.run(async (ctx) => {
      const tableNames = [
        "organizations",
        "users",
        "globalModelSettings",
        "orgMemberships",
        "agentChannelSettings",
        "slackChannelBindings",
        "slackChannelMemberships",
        "slackOutboundSends",
        "operatorSlackOutboundSends",
        "imessageOutboundSends",
        "pendingEmails",
        "emailDeliveryAttempts",
        "notifications",
        "routerAssets",
        "operationalRouterSmokeRuns",
        "modelRoutingEvents",
      ] as const;
      return Object.fromEntries(
        await Promise.all(
          tableNames.map(async (table) => [
            table,
            (await ctx.db.query(table).collect()).length,
          ]),
        ),
      );
    });
    expect(
      await t.run(async (ctx) => ctx.db.get(unrelatedOrgId)),
    ).toMatchObject({ name: "Unrelated cleanup sentinel" });
    expect(tableCounts).toEqual({
      ...Object.fromEntries(
        Object.keys(tableCounts).map((table) => [table, 0]),
      ),
      organizations: 1,
      users: 1,
      globalModelSettings: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /router-smoke-secret|spot-router-operational-smoke|audioBase64|storageId|orgId|userId|url|provider|model/i,
    );
  }, 30_000);
});

describe("operational router smoke source guard", () => {
  test("keeps delivery, membership, contact, and channel mutation owners out of the harness", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("./actions/operationalRouterSmoke.ts", import.meta.url),
      ),
      "utf8",
    );

    expect(source).toContain(`"${OPERATIONAL_ROUTER_SMOKE_RETRIEVAL_URL}"`);
    expect(source).toContain("internalAction({");
    expect(source).toMatch(/attempt < 5/);
    expect(source).toContain("ctx.scheduler.runAfter(");
    expect(source).not.toMatch(
      /sendNotification|sendEmail|sendSlack|sendImessage|sendMessage|pendingEmails|slackOutboundSends|operatorSlackOutboundSends|imessageOutboundSends|emailDeliveryAttempts|agentChannelSettings|slackChannelBindings|slackChannelMemberships|contacts\./,
    );
    expect(source).not.toMatch(/ctx\.storage\.delete\s*\(/);
  });
});
