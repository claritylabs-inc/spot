import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  inlineRouterImageFits,
  planExplicitRouterAssets,
  routerAssetUploadRequest,
  stageRouterAsset,
  validateRouterAssetUploadResponse,
  validatedConvexSiteUrl,
} from "../src/routerAssetUpload.js";
import {
  CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES,
  CL_ROUTER_MAX_ASSET_BYTES,
  CL_ROUTER_MAX_JSON_BYTES,
} from "../src/clRouterClient.js";

test("explicit extraction assets are preserved and validated as one router budget", () => {
  const screenshot = {
    imageBase64: Buffer.from("screenshot").toString("base64"),
    mimeType: "image/png",
  };
  assert.deepEqual(
    planExplicitRouterAssets({ pdfBase64: undefined, images: [screenshot] }),
    {
      images: [screenshot],
      imageSizes: [Buffer.byteLength("screenshot")],
      pdfSize: 0,
    },
  );

  const pdfBase64 = Buffer.from("pdf").toString("base64");
  assert.deepEqual(planExplicitRouterAssets({ pdfBase64 }), {
    images: [],
    imageSizes: [],
    pdfBase64,
    pdfSize: 3,
  });

  assert.throws(
    () =>
      planExplicitRouterAssets({
        images: [screenshot, { imageBase64: "", mimeType: "image/png" }],
      }),
    /image 2.*nonempty canonical base64/i,
  );
  assert.throws(
    () =>
      planExplicitRouterAssets({
        images: [
          { imageBase64: screenshot.imageBase64, mimeType: "text/plain" },
        ],
      }),
    /image 1.*malformed/i,
  );
  assert.throws(
    () => planExplicitRouterAssets({ pdfBase64: "", images: [] }),
    /PDF base64.*nonempty canonical base64/i,
  );
  assert.throws(
    () =>
      planExplicitRouterAssets({
        pdfBase64,
        pdfBytes: Uint8Array.from([1]),
      }),
    /two PDF representations/i,
  );
});

test("explicit extraction assets fail before exceeding router binary limits", () => {
  assert.throws(
    () =>
      planExplicitRouterAssets({
        pdfBytes: new Uint8Array(CL_ROUTER_MAX_ASSET_BYTES + 1),
      }),
    /PDF exceeds.*asset limit/i,
  );

  const onePixel = Buffer.from("pixel").toString("base64");
  assert.throws(
    () =>
      planExplicitRouterAssets({
        images: Array.from({ length: 9 }, () => ({
          imageBase64: onePixel,
          mimeType: "image/png",
        })),
      }),
    /8-asset router limit/i,
  );

  const pdfBytes = new Uint8Array(10 * 1024 * 1024);
  const imageBytes = Buffer.alloc(
    CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES - pdfBytes.byteLength + 1,
  );
  assert.throws(
    () =>
      planExplicitRouterAssets({
        pdfBytes,
        images: [
          {
            imageBase64: imageBytes.toString("base64"),
            mimeType: "image/png",
          },
        ],
      }),
    /aggregate limit/i,
  );
});

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

test("the shared runtime staging helper uploads, hashes, and validates one asset", async () => {
  const bytes = Uint8Array.from([1, 2, 3]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = await stageRouterAsset({
    siteUrl: "https://actions.spot.insure",
    secret: "worker-secret",
    lease: {
      jobKind: "policy",
      jobId: "policy-id",
      leaseId: "lease-id",
      orgId: "org-id",
    },
    mediaType: "image/png",
    filename: "pixel.png",
    bytes,
    fetch: async (_input, init) => {
      assert.deepEqual(
        Buffer.from(init?.body as Uint8Array),
        Buffer.from(bytes),
      );
      return Response.json(
        {
          assetId: "asset-id",
          reference: {
            url: "https://actions.spot.insure/router-assets?assetId=asset-id&expiresAt=2000000000000&signature=signature",
            mediaType: "image/png",
            filename: "pixel.png",
            sizeBytes: bytes.byteLength,
            sha256,
          },
          cleanup: {
            expiresAt: 2_000_000_000_000,
            signature: "signature",
          },
        },
        { status: 201 },
      );
    },
  });
  assert.equal(result.reference.sha256, sha256);
  assert.deepEqual(result.cleanup, {
    assetId: "asset-id",
    expiresAt: 2_000_000_000_000,
    signature: "signature",
  });
});

test("invalid staging responses trigger marker-bound cleanup without masking validation", async () => {
  const cleanups: unknown[] = [];
  await assert.rejects(
    stageRouterAsset({
      siteUrl: "https://actions.spot.insure",
      secret: "worker-secret",
      lease: {
        jobKind: "policy",
        jobId: "policy-id",
        leaseId: "lease-id",
        orgId: "org-id",
      },
      mediaType: "image/png",
      filename: "pixel.png",
      bytes: Uint8Array.from([1, 2, 3]),
      fetch: async () =>
        Response.json(
          {
            assetId: "asset-id",
            reference: {
              url: "https://evil.example/router-assets",
              mediaType: "image/png",
              sizeBytes: 3,
            },
            cleanup: {
              expiresAt: 2_000_000_000_000,
              signature: "signature",
            },
          },
          { status: 201 },
        ),
      cleanupInvalidResponse: async (cleanup) => {
        cleanups.push(cleanup);
        throw new Error("cleanup transport failed");
      },
    }),
    /invalid staged router asset reference/i,
  );
  assert.deepEqual(cleanups, [
    {
      assetId: "asset-id",
      expiresAt: 2_000_000_000_000,
      signature: "signature",
    },
  ]);
});
