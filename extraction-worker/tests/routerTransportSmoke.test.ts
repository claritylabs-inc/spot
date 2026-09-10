import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { inflateSync } from "node:zlib";

import type { ClRouterGenerateResponse } from "../src/clRouterClient.js";
import {
  renderWorkerRouterTransportSmokeResult,
  runWorkerRouterTransportSmoke,
  WORKER_ROUTER_TRANSPORT_SMOKE_PNG,
  type WorkerRouterTransportSmokeAdapters,
} from "../src/routerTransportSmoke.js";

const requestId = "919d3d23-ce0c-44d9-8dd4-2b75f8639fe2";
const lease = {
  jobKind: "policy" as const,
  jobId: "policy-id",
  leaseId: `worker-router-transport:${requestId}`,
  leaseExpiresAt: 2_000_000_000_000,
  orgId: "org-id",
};
const staged = {
  reference: {
    url: "https://actions.spot.insure/router-assets?assetId=asset-id&expiresAt=2000000000000&signature=signature",
    mediaType: "image/png",
    filename: "synthetic-pixel.png",
    sizeBytes: 68,
    sha256: "hash",
  },
  cleanup: {
    assetId: "asset-id",
    expiresAt: 2_000_000_000_000,
    signature: "signature",
  },
};
const response: ClRouterGenerateResponse = {
  output: { ok: true },
  usage: {
    inputTokens: 2,
    outputTokens: 1,
    cachedInputTokens: 0,
  },
  costUsd: null,
  costStatus: "unpriced",
  model: { provider: "openai", model: "test-model" },
  routing: {
    decision: "default",
    candidatesConsidered: [{ provider: "openai", model: "test-model" }],
    policyVersion: null,
    cacheStickinessApplied: false,
    attemptCount: 1,
  },
  requestId: "router-request-id",
};

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("the staged smoke fixture is a valid 32x32 RGB PNG", () => {
  const png = WORKER_ROUTER_TRANSPORT_SMOKE_PNG;
  assert.equal(png.byteLength, 99);
  assert.equal(
    createHash("sha256").update(png).digest("hex"),
    "66cfd27bba5ff968ba68a78dabe751fe8578156c721c39fe93f7c4e145025cbe",
  );
  assert.deepEqual(
    png.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );

  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  while (offset < png.byteLength) {
    const length = png.readUInt32BE(offset);
    const typeBytes = png.subarray(offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = png.readUInt32BE(offset + 8 + length);
    assert.equal(
      crc32(Buffer.concat([typeBytes, data])),
      expectedCrc,
      `${typeBytes.toString("ascii")} CRC`,
    );
    chunks.push({ type: typeBytes.toString("ascii"), data });
    offset += length + 12;
  }
  assert.equal(offset, png.byteLength);
  assert.deepEqual(
    chunks.map((chunk) => chunk.type),
    ["IHDR", "IDAT", "IEND"],
  );

  const ihdr = chunks[0]?.data;
  assert.ok(ihdr);
  assert.equal(ihdr.byteLength, 13);
  assert.equal(ihdr.readUInt32BE(0), 32);
  assert.equal(ihdr.readUInt32BE(4), 32);
  assert.deepEqual([...ihdr.subarray(8)], [8, 2, 0, 0, 0]);

  const raw = inflateSync(
    Buffer.concat(
      chunks
        .filter((chunk) => chunk.type === "IDAT")
        .map((chunk) => chunk.data),
    ),
  );
  assert.equal(raw.byteLength, 3_104);
  for (let row = 0; row < 32; row += 1) {
    const scanline = raw.subarray(row * 97, (row + 1) * 97);
    assert.equal(scanline[0], 0);
    for (let column = 0; column < 32; column += 1) {
      assert.deepEqual(
        [...scanline.subarray(1 + column * 3, 4 + column * 3)],
        [42, 64, 128],
      );
    }
  }
});

function adapters(events: string[]): WorkerRouterTransportSmokeAdapters {
  return {
    begin: async (receivedRequestId) => {
      events.push(`begin:${receivedRequestId}`);
      return lease;
    },
    stage: async (receivedLease) => {
      assert.deepEqual(receivedLease, lease);
      events.push("stage");
      return staged;
    },
    generate: async (receivedRequestId, receivedLease, reference) => {
      assert.equal(receivedRequestId, requestId);
      assert.deepEqual(receivedLease, lease);
      assert.deepEqual(reference, staged.reference);
      events.push("generate");
      return response;
    },
    deleteAsset: async (cleanup) => {
      assert.deepEqual(cleanup, staged.cleanup);
      events.push("delete-asset");
      return true;
    },
    finish: async (receivedRequestId) => {
      assert.equal(receivedRequestId, requestId);
      events.push("finish");
      return true;
    },
  };
}

test("transport smoke uses the opaque fixture, real staging order, and both cleanups", async () => {
  const events: string[] = [];
  const result = await runWorkerRouterTransportSmoke(
    requestId,
    adapters(events),
  );
  assert.deepEqual(events, [
    `begin:${requestId}`,
    "stage",
    "generate",
    "delete-asset",
    "finish",
  ]);
  assert.deepEqual(result, {
    ok: true,
    smokeRequestId: requestId,
    routerRequestId: "router-request-id",
    began: true,
    uploaded: true,
    generated: true,
    assetCleanupAcknowledged: true,
    fixtureCleanupAcknowledged: true,
  });
  const rendered = renderWorkerRouterTransportSmokeResult(result);
  assert.equal(rendered.split("\n").length, 2);
  assert.match(rendered, /^\[spot:worker-router-transport-smoke\] \{/);
  assert.equal(rendered.includes("openai"), false);
  assert.equal(rendered.includes("test-model"), false);
  assert.equal(rendered.includes("router-assets"), false);
});

test("generation failure is sanitized while attempting both cleanups", async () => {
  const events: string[] = [];
  const failing = adapters(events);
  failing.generate = async () => {
    events.push("generate");
    throw new Error("secret-bearing failure detail");
  };
  const result = await runWorkerRouterTransportSmoke(requestId, failing);
  assert.deepEqual(events, [
    `begin:${requestId}`,
    "stage",
    "generate",
    "delete-asset",
    "finish",
  ]);
  assert.deepEqual(result, {
    ok: false,
    smokeRequestId: requestId,
    began: true,
    uploaded: true,
    generated: false,
    assetCleanupAcknowledged: true,
    fixtureCleanupAcknowledged: true,
  });
  assert.equal(
    renderWorkerRouterTransportSmokeResult(result).includes("secret-bearing"),
    false,
  );
});

test("invalid request IDs are rejected before any worker adapter runs", async () => {
  const events: string[] = [];
  const result = await runWorkerRouterTransportSmoke(
    "policy-id",
    adapters(events),
  );
  assert.deepEqual(events, []);
  assert.deepEqual(result, {
    ok: false,
    smokeRequestId: "policy-id",
    began: false,
    uploaded: false,
    generated: false,
    assetCleanupAcknowledged: false,
    fixtureCleanupAcknowledged: false,
  });
});
