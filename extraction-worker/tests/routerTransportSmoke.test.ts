import assert from "node:assert/strict";
import test from "node:test";

import type { ClRouterGenerateResponse } from "../src/clRouterClient.js";
import {
  renderWorkerRouterTransportSmokeResult,
  runWorkerRouterTransportSmoke,
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
