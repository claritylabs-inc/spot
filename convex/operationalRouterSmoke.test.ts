import { describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import {
  OPERATIONAL_ROUTER_SMOKE_AUDIO_MAX_BYTES,
  OPERATIONAL_ROUTER_SMOKE_AUDIO_MIN_BYTES,
  OPERATIONAL_ROUTER_SMOKE_PDF_BYTES,
  createOperationalSmokePdf,
  decodeOperationalSmokeAudio,
  runOperationalRouterSmoke,
  summarizeOperationalSmokeEmbeddings,
  type OperationalRouterSmokeAdapters,
} from "./actions/operationalRouterSmoke";

function validM4a(byteLength = OPERATIONAL_ROUTER_SMOKE_AUDIO_MIN_BYTES) {
  const bytes = Buffer.alloc(byteLength);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("M4A ", 8, "ascii");
  return bytes;
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
