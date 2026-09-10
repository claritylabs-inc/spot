import { CL_ROUTER_MAX_JSON_BYTES } from "./clRouterClient.js";
import type { ClRouterAssetReference } from "./clRouterClient.js";

export type RouterAssetLease = {
  jobKind: "policy" | "preview" | "proposal";
  jobId: string;
  leaseId: string;
  orgId: string;
};

export type StagedRouterAssetCleanup = {
  assetId: string;
  expiresAt: number;
  signature: string;
};

export type RouterAssetUploadResponse = {
  assetId: string;
  reference: ClRouterAssetReference;
  cleanup: Omit<StagedRouterAssetCleanup, "assetId">;
};

const ROUTER_IMAGE_PART_OVERHEAD_BYTES = 128;

export function inlineRouterImageFits(
  currentEnvelopeBytes: number,
  imageBase64: string,
): boolean {
  return (
    currentEnvelopeBytes +
      Buffer.byteLength(imageBase64) +
      ROUTER_IMAGE_PART_OVERHEAD_BYTES <=
    CL_ROUTER_MAX_JSON_BYTES
  );
}

export function validatedConvexSiteUrl(raw: string, spotEnv: string): string {
  const url = new URL(raw);
  const environment = spotEnv.trim().toLowerCase();
  const expectedHost =
    environment === "production"
      ? "actions.spot.insure"
      : environment === "dev"
        ? "acoustic-caiman-755.convex.site"
        : undefined;
  if (
    expectedHost &&
    (url.protocol !== "https:" ||
      url.hostname !== expectedHost ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "")
  ) {
    throw new Error(
      `CONVEX_SITE_URL must be https://${expectedHost} when SPOT_ENV=${environment}`,
    );
  }
  if (
    !expectedHost &&
    !(
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "localhost" ||
            url.hostname === "127.0.0.1" ||
            url.hostname === "::1" ||
            url.hostname === "[::1]")))
    )
  ) {
    throw new Error(
      "CONVEX_SITE_URL must use HTTPS unless it targets loopback",
    );
  }
  return url.toString();
}

export function routerAssetUploadRequest(options: {
  siteUrl: string;
  secret: string;
  lease: RouterAssetLease;
  mediaType: string;
  filename: string;
  contentLength: number;
  body: BodyInit;
}): { url: URL; init: RequestInit } {
  return {
    url: new URL("/router-assets/upload", options.siteUrl),
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.secret}`,
        "content-type": options.mediaType,
        "content-length": String(options.contentLength),
        "x-spot-router-asset-job-kind": options.lease.jobKind,
        "x-spot-router-asset-job-id": options.lease.jobId,
        "x-spot-router-asset-lease-id": options.lease.leaseId,
        "x-spot-router-asset-org-id": options.lease.orgId,
        "x-spot-router-asset-filename": options.filename,
      },
      body: options.body,
    },
  };
}

export function validateRouterAssetUploadResponse(options: {
  siteUrl: string;
  response: RouterAssetUploadResponse;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}): {
  reference: ClRouterAssetReference;
  cleanup: StagedRouterAssetCleanup;
} {
  const { response } = options;
  const cleanup = {
    assetId: response.assetId,
    expiresAt: response.cleanup?.expiresAt,
    signature: response.cleanup?.signature,
  };
  if (
    typeof cleanup.assetId !== "string" ||
    cleanup.assetId.length === 0 ||
    !Number.isSafeInteger(cleanup.expiresAt) ||
    cleanup.expiresAt <= 0 ||
    typeof cleanup.signature !== "string" ||
    cleanup.signature.length === 0 ||
    !response.reference ||
    typeof response.reference.url !== "string"
  ) {
    throw new Error("Convex returned invalid staged router asset metadata");
  }
  const referenceUrl = new URL(response.reference.url);
  const expectedSite = new URL(options.siteUrl);
  if (
    referenceUrl.protocol !== expectedSite.protocol ||
    referenceUrl.origin !== expectedSite.origin ||
    referenceUrl.pathname !== "/router-assets" ||
    referenceUrl.searchParams.getAll("assetId").length !== 1 ||
    referenceUrl.searchParams.get("assetId") !== cleanup.assetId ||
    referenceUrl.searchParams.getAll("expiresAt").length !== 1 ||
    referenceUrl.searchParams.get("expiresAt") !== String(cleanup.expiresAt) ||
    referenceUrl.searchParams.getAll("signature").length !== 1 ||
    referenceUrl.searchParams.get("signature") !== cleanup.signature ||
    response.reference.mediaType !== options.mediaType ||
    response.reference.sizeBytes !== options.sizeBytes ||
    response.reference.sha256 !== options.sha256
  ) {
    throw new Error("Convex returned an invalid staged router asset reference");
  }
  return { reference: response.reference, cleanup };
}
