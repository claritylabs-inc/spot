import assert from "node:assert/strict";
import test from "node:test";
import {
  inlineRouterImageFits,
  routerAssetUploadRequest,
  validateRouterAssetUploadResponse,
  validatedConvexSiteUrl,
} from "../src/routerAssetUpload.js";
import { CL_ROUTER_MAX_JSON_BYTES } from "../src/clRouterClient.js";

test("generated images are staged before the 4 MiB JSON envelope is exceeded", () => {
  assert.equal(inlineRouterImageFits(1_000, "a".repeat(1_000)), true);
  assert.equal(
    inlineRouterImageFits(CL_ROUTER_MAX_JSON_BYTES - 128, "a"),
    false,
  );
});

test("router asset uploads use only the canonical environment HTTP-action hosts", () => {
  assert.equal(
    validatedConvexSiteUrl("https://acoustic-caiman-755.convex.site", "dev"),
    "https://acoustic-caiman-755.convex.site/",
  );
  assert.equal(
    validatedConvexSiteUrl("https://actions.spot.insure", "production"),
    "https://actions.spot.insure/",
  );
  assert.equal(
    validatedConvexSiteUrl("http://127.0.0.1:3211", "local"),
    "http://127.0.0.1:3211/",
  );
  assert.throws(
    () =>
      validatedConvexSiteUrl(
        "https://merry-platypus-82.convex.site",
        "production",
      ),
    /actions\.spot\.insure/,
  );
  assert.throws(
    () =>
      validatedConvexSiteUrl("https://acoustic-caiman-755.convex.cloud", "dev"),
    /acoustic-caiman-755\.convex\.site/,
  );
  for (const invalid of [
    "https://actions.spot.insure:8443",
    "https://worker@actions.spot.insure",
    "https://actions.spot.insure/unexpected",
    "https://actions.spot.insure?lane=production",
  ]) {
    assert.throws(
      () => validatedConvexSiteUrl(invalid, "production"),
      /actions\.spot\.insure/,
    );
  }
});

test("router asset upload is one authenticated binary handoff bound to the lease", () => {
  const body = Uint8Array.from([1, 2, 3]);
  const request = routerAssetUploadRequest({
    siteUrl: "https://actions.spot.insure/",
    secret: "worker-secret",
    lease: {
      jobKind: "proposal",
      jobId: "proposal-job",
      leaseId: "lease-1",
      orgId: "org-1",
    },
    mediaType: "image/png",
    filename: "page.png",
    contentLength: body.byteLength,
    body,
  });
  const headers = new Headers(request.init.headers);
  assert.equal(
    request.url.toString(),
    "https://actions.spot.insure/router-assets/upload",
  );
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, body);
  assert.equal(headers.get("authorization"), "Bearer worker-secret");
  assert.equal(headers.get("content-type"), "image/png");
  assert.equal(headers.get("content-length"), "3");
  assert.equal(headers.get("x-spot-router-asset-job-kind"), "proposal");
  assert.equal(headers.get("x-spot-router-asset-job-id"), "proposal-job");
  assert.equal(headers.get("x-spot-router-asset-lease-id"), "lease-1");
  assert.equal(headers.get("x-spot-router-asset-org-id"), "org-1");
  assert.equal(headers.get("x-spot-router-asset-filename"), "page.png");
});

test("staged references stay on the exact site path and bind their expiry signature", () => {
  const valid = {
    assetId: "asset-1",
    reference: {
      url: "https://actions.spot.insure/router-assets?assetId=asset-1&expiresAt=2000000000000&signature=sig-1",
      mediaType: "image/png",
      filename: "page.png",
      sizeBytes: 3,
      sha256: "sha-1",
    },
    cleanup: { expiresAt: 2_000_000_000_000, signature: "sig-1" },
  };
  assert.deepEqual(
    validateRouterAssetUploadResponse({
      siteUrl: "https://actions.spot.insure",
      response: valid,
      mediaType: "image/png",
      sizeBytes: 3,
      sha256: "sha-1",
    }),
    {
      reference: valid.reference,
      cleanup: { assetId: "asset-1", ...valid.cleanup },
    },
  );
  for (const url of [
    "https://merry-platypus-82.convex.site/router-assets?assetId=asset-1&expiresAt=2000000000000&signature=sig-1",
    "https://actions.spot.insure/router-assets/extra?assetId=asset-1&expiresAt=2000000000000&signature=sig-1",
    "https://actions.spot.insure/router-assets?assetId=asset-1&expiresAt=2000000000001&signature=sig-1",
  ]) {
    assert.throws(() =>
      validateRouterAssetUploadResponse({
        siteUrl: "https://actions.spot.insure",
        response: { ...valid, reference: { ...valid.reference, url } },
        mediaType: "image/png",
        sizeBytes: 3,
        sha256: "sha-1",
      }),
    );
  }
});
