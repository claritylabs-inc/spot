"use node";

// Shared helpers for Jev image decisions: stage images as signed router assets,
// and locate a target on a PDF page with a presence Noul plus a zoomed Box.

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  cleanupSignedRouterAssets,
  createSignedActionRouterAsset,
} from "../actions/routerAssets";
import type {
  DecisionAsset,
  DecisionBox,
  DecisionEntry,
} from "../../contracts/cl-router/policy";
import { MAX_DECISION_ASSET_COUNT } from "../../contracts/cl-router/policy";
import { clRouterDecide } from "./clRouterClient";
import { jevProceeds } from "./jevThreshold";
import {
  renderPdfPageImages,
  renderPdfPageRegion,
  type PdfPageImage,
} from "./pdfPageImages";

export type JevImage = {
  bytes: Uint8Array;
  mediaType: "image/png" | "image/jpeg";
  /** Short readable suffix for the asset reference, e.g. "page-3". */
  label: string;
};

export type StagedJevImages = {
  /** Reference strings, in input order. Place them where each image belongs. */
  refs: string[];
  assets: Record<string, DecisionAsset>;
  cleanup: () => Promise<void>;
};

type StageScope = {
  orgId?: Id<"organizations">;
  surface: string;
  sessionKey: string;
};

/**
 * Stores images as short-lived signed router assets. References are fresh UUIDs
 * so they cannot collide with document text. Always call `cleanup` when done.
 */
export async function stageJevImages(
  ctx: ActionCtx,
  images: JevImage[],
  scope: StageScope,
): Promise<StagedJevImages> {
  if (!images.length || images.length > MAX_DECISION_ASSET_COUNT) {
    throw new Error(
      `Jev decisions accept 1-${MAX_DECISION_ASSET_COUNT} images`,
    );
  }
  const staged: Awaited<ReturnType<typeof createSignedActionRouterAsset>>[] =
    [];
  try {
    for (const image of images) {
      staged.push(
        await createSignedActionRouterAsset(ctx, {
          bytes: image.bytes,
          mediaType: image.mediaType,
          filename: `${image.label}.${image.mediaType === "image/png" ? "png" : "jpg"}`,
          ...(scope.orgId ? { orgId: scope.orgId } : {}),
          surface: scope.surface,
          sessionKey: scope.sessionKey,
        }),
      );
    }
  } catch (error) {
    await cleanupSignedRouterAssets(
      ctx,
      staged.map((entry) => entry.cleanup),
    );
    throw error;
  }
  const refs = images.map((image) => `${crypto.randomUUID()}-${image.label}`);
  const assets: Record<string, DecisionAsset> = {};
  staged.forEach((entry, index) => {
    assets[refs[index]] = {
      source: {
        url: entry.reference.url,
        mediaType: images[index].mediaType,
        sizeBytes: entry.reference.sizeBytes,
        sha256: entry.reference.sha256,
      },
    };
  });
  return {
    refs,
    assets,
    cleanup: () =>
      cleanupSignedRouterAssets(
        ctx,
        staged.map((entry) => entry.cleanup),
      ),
  };
}

export function pdfPageJevImage(image: PdfPageImage): JevImage {
  return {
    bytes: image.bytes,
    mediaType: image.mediaType,
    label: `page-${image.page}`,
  };
}

/** Same coordinates as `sourceSpans.bbox`: PDF points at scale 1, top-left origin. */
export type PdfPageBbox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPageLocation = {
  /** Probability that the target appears on the page. */
  present: number;
  /** Null when the target is absent or Jev is not sure it is present. */
  box: DecisionBox | null;
  bbox: PdfPageBbox | null;
  confidence: number;
  /** PDF page size in points, for `bboxCoordinateWidth/Height` metadata. */
  pageWidth: number;
  pageHeight: number;
};

/** Edge padding (fraction of the page) around the coarse box before zooming. */
const ZOOM_PADDING = 0.06;

function padBox(box: DecisionBox, pad: number): DecisionBox {
  return {
    left: Math.max(0, box.left - pad),
    top: Math.max(0, box.top - pad),
    right: Math.min(1, box.right + pad),
    bottom: Math.min(1, box.bottom + pad),
  };
}

function mapFromRegion(inner: DecisionBox, region: DecisionBox): DecisionBox {
  const width = region.right - region.left;
  const height = region.bottom - region.top;
  return {
    left: region.left + inner.left * width,
    right: region.left + inner.right * width,
    top: region.top + inner.top * height,
    bottom: region.top + inner.bottom * height,
  };
}

export function boxToPdfBbox(
  box: DecisionBox,
  page: number,
  pageWidth: number,
  pageHeight: number,
): PdfPageBbox {
  return {
    page,
    x: box.left * pageWidth,
    y: box.top * pageHeight,
    width: (box.right - box.left) * pageWidth,
    height: (box.bottom - box.top) * pageHeight,
  };
}

/**
 * Locates one target on one PDF page. The first request asks a presence Noul
 * and a full-page Box together (Box has no "not found" answer). Full-page Box
 * edges are coarse (0.01 steps), so a second Box runs on a zoomed crop around
 * the padded first box, and its edges are mapped back to page fractions.
 */
export async function locateOnPdfPage(
  ctx: ActionCtx,
  params: {
    pdfBytes: Uint8Array;
    page: number;
    /** What to find, written as a noun phrase, e.g. a quoted line of text. */
    target: DecisionEntry;
    orgId?: Id<"organizations">;
    task: string;
    surface: string;
    sessionKey: string;
    traceId?: string;
    /** Reuse an already rendered full page. */
    pageImage?: PdfPageImage;
  },
): Promise<PdfPageLocation> {
  const pageImage =
    params.pageImage ??
    (
      await renderPdfPageImages({
        pdfBytes: params.pdfBytes,
        pages: [params.page],
      })
    )[0];
  if (!pageImage) throw new Error(`PDF page ${params.page} does not exist`);
  const scope = {
    orgId: params.orgId,
    surface: params.surface,
    sessionKey: params.sessionKey,
  };
  const request = {
    ...(params.orgId ? { orgId: String(params.orgId) } : {}),
    task: params.task,
    ...(params.traceId ? { trace: { traceId: params.traceId } } : {}),
  };
  const unlocated: PdfPageLocation = {
    present: 0,
    box: null,
    bbox: null,
    confidence: 0,
    pageWidth: pageImage.pageWidth,
    pageHeight: pageImage.pageHeight,
  };

  const full = await stageJevImages(ctx, [pdfPageJevImage(pageImage)], scope);
  let coarse: DecisionBox;
  let present: number;
  try {
    const result = await clRouterDecide(
      {
        ...request,
        state: { page: full.refs[0], target: params.target },
        assets: full.assets,
        questions: {
          present: {
            type: "noul",
            instructions: "Does `page` show `target`?",
          },
          box: { type: "box", instructions: "`target` in `page`" },
        },
      },
      { telemetry: ctx },
    );
    const presentAnswer = result.answers.present;
    const boxAnswer = result.answers.box;
    present = presentAnswer?.type === "noul" ? presentAnswer.noul : 0;
    if (!jevProceeds(present) || boxAnswer?.type !== "box") {
      return { ...unlocated, present };
    }
    coarse = boxAnswer.box;
  } finally {
    await full.cleanup();
  }

  const region = padBox(coarse, ZOOM_PADDING);
  const crop = await renderPdfPageRegion({
    pdfBytes: params.pdfBytes,
    page: params.page,
    region,
  });
  const zoomed = await stageJevImages(
    ctx,
    [{ ...pdfPageJevImage(crop), label: `page-${params.page}-crop` }],
    scope,
  );
  try {
    const result = await clRouterDecide(
      {
        ...request,
        state: { crop: zoomed.refs[0], target: params.target },
        assets: zoomed.assets,
        questions: { box: { type: "box", instructions: "`target` in `crop`" } },
      },
      { telemetry: ctx },
    );
    const answer = result.answers.box;
    if (answer?.type !== "box") return { ...unlocated, present };
    const box = mapFromRegion(answer.box, region);
    return {
      present,
      box,
      bbox: boxToPdfBbox(
        box,
        params.page,
        pageImage.pageWidth,
        pageImage.pageHeight,
      ),
      confidence: answer.confidence,
      pageWidth: pageImage.pageWidth,
      pageHeight: pageImage.pageHeight,
    };
  } finally {
    await zoomed.cleanup();
  }
}
