import { createHash } from "node:crypto";

import {
  CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES,
  CL_ROUTER_MAX_ASSET_BYTES,
  CL_ROUTER_MAX_ASSETS,
  CL_ROUTER_MAX_JSON_BYTES,
} from "./clRouterClient.js";
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

export type StagedRouterAsset = {
  reference: ClRouterAssetReference;
  cleanup: StagedRouterAssetCleanup;
};

export type ExplicitRouterImage = {
  imageBase64: string;
  mimeType: string;
};

export type ExplicitRouterAssetPlan = {
  images: ExplicitRouterImage[];
  imageSizes: number[];
  pdfBase64?: string;
  pdfBytes?: Uint8Array;
  pdfSize: number;
};

const ROUTER_IMAGE_PART_OVERHEAD_BYTES = 128;

function canonicalBase64(value: string, label: string): string {
  const normalized = value.replace(/\s/g, "");
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    throw new Error(`${label} must be nonempty canonical base64`);
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) {
    throw new Error(`${label} must be nonempty canonical base64`);
  }
  return normalized;
}

export function planExplicitRouterAssets(
  providerOptions: Record<string, unknown>,
): ExplicitRouterAssetPlan {
  const suppliedPdfBase64 = providerOptions.pdfBase64 !== undefined;
  const suppliedPdfBytes = providerOptions.pdfBytes !== undefined;
  if (suppliedPdfBase64 && suppliedPdfBytes) {
    throw new Error("Extraction input supplied two PDF representations");
  }

  let pdfBase64: string | undefined;
  let pdfBytes: Uint8Array | undefined;
  let pdfSize = 0;
  if (suppliedPdfBase64) {
    if (typeof providerOptions.pdfBase64 !== "string") {
      throw new Error("Extraction PDF base64 must be a string");
    }
    pdfBase64 = canonicalBase64(
      providerOptions.pdfBase64,
      "Extraction PDF base64",
    );
    pdfSize = Buffer.from(pdfBase64, "base64").byteLength;
  } else if (suppliedPdfBytes) {
    if (!(providerOptions.pdfBytes instanceof Uint8Array)) {
      throw new Error("Extraction PDF bytes must be a Uint8Array");
    }
    if (providerOptions.pdfBytes.byteLength === 0) {
      throw new Error("Extraction PDF bytes must be nonempty");
    }
    pdfBytes = providerOptions.pdfBytes;
    pdfSize = pdfBytes.byteLength;
  }
  if (pdfSize > CL_ROUTER_MAX_ASSET_BYTES) {
    throw new Error(
      `Extraction PDF exceeds the ${CL_ROUTER_MAX_ASSET_BYTES}-byte router asset limit`,
    );
  }

  if (
    providerOptions.images !== undefined &&
    !Array.isArray(providerOptions.images)
  ) {
    throw new Error("Extraction images must be an array");
  }
  const rawImages = providerOptions.images ?? [];
  const images = rawImages.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Extraction image ${index + 1} is malformed`);
    }
    const image = value as Record<string, unknown>;
    if (
      typeof image.imageBase64 !== "string" ||
      typeof image.mimeType !== "string" ||
      !image.mimeType.trim().toLowerCase().startsWith("image/")
    ) {
      throw new Error(`Extraction image ${index + 1} is malformed`);
    }
    return {
      imageBase64: canonicalBase64(
        image.imageBase64,
        `Extraction image ${index + 1}`,
      ),
      mimeType: image.mimeType.trim().toLowerCase(),
    };
  });
  const imageSizes = images.map(
    (image) => Buffer.from(image.imageBase64, "base64").byteLength,
  );
  if (imageSizes.some((size) => size > CL_ROUTER_MAX_ASSET_BYTES)) {
    throw new Error(
      `A generated page image exceeds the ${CL_ROUTER_MAX_ASSET_BYTES}-byte router asset limit`,
    );
  }
  if (images.length + (pdfSize > 0 ? 1 : 0) > CL_ROUTER_MAX_ASSETS) {
    throw new Error(
      `Extraction input exceeds the ${CL_ROUTER_MAX_ASSETS}-asset router limit`,
    );
  }
  if (
    pdfSize + imageSizes.reduce((total, size) => total + size, 0) >
    CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES
  ) {
    throw new Error(
      `Extraction input exceeds the ${CL_ROUTER_MAX_AGGREGATE_ASSET_BYTES}-byte router aggregate limit`,
    );
  }
  return {
    images,
    imageSizes,
    ...(pdfBase64 ? { pdfBase64 } : {}),
    ...(pdfBytes ? { pdfBytes } : {}),
    pdfSize,
  };
}

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

export async function stageRouterAsset(options: {
  siteUrl: string;
  secret: string;
  lease: RouterAssetLease;
  mediaType: string;
  filename: string;
  bytes: Uint8Array;
  fetch?: typeof fetch;
  cleanupInvalidResponse?: (
    cleanup: StagedRouterAssetCleanup,
  ) => void | Promise<void>;
}): Promise<StagedRouterAsset> {
  const body = Buffer.from(options.bytes);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const request = routerAssetUploadRequest({
    siteUrl: options.siteUrl,
    secret: options.secret,
    lease: options.lease,
    mediaType: options.mediaType,
    filename: options.filename,
    contentLength: body.byteLength,
    body,
  });
  const upload = await (options.fetch ?? fetch)(request.url, request.init);
  if (!upload.ok) {
    throw new Error(`Failed to stage router asset (${upload.status})`);
  }
  const finalized = (await upload.json()) as RouterAssetUploadResponse;
  try {
    return validateRouterAssetUploadResponse({
      siteUrl: options.siteUrl,
      response: finalized,
      mediaType: options.mediaType,
      sizeBytes: body.byteLength,
      sha256,
    });
  } catch (error) {
    if (
      typeof finalized?.assetId === "string" &&
      Number.isSafeInteger(finalized?.cleanup?.expiresAt) &&
      typeof finalized?.cleanup?.signature === "string" &&
      options.cleanupInvalidResponse
    ) {
      await Promise.allSettled([
        options.cleanupInvalidResponse({
          assetId: finalized.assetId,
          expiresAt: finalized.cleanup.expiresAt,
          signature: finalized.cleanup.signature,
        }),
      ]);
    }
    throw error;
  }
}
