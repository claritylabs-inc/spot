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
  DecisionQuestion,
} from "../../contracts/cl-router/policy";
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
  if (!images.length) throw new Error("Jev image decisions need an image");
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
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return {
    left: clamp(region.left + inner.left * width),
    right: clamp(region.left + inner.right * width),
    top: clamp(region.top + inner.top * height),
    bottom: clamp(region.top + inner.bottom * height),
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

/** Box questions per request stay under Jev's 128-question limit (two per target). */
const MAX_PAGE_TARGETS_PER_REQUEST = 60;
/** Zoomed crops per request, keeping staged assets well under 16 MiB. */
const MAX_CROPS_PER_REQUEST = 20;

/** A presence Noul and a Box per target, each pointing at its image in state. */
function targetQuestions(
  indices: number[],
  image: (index: number) => string,
): Record<string, DecisionQuestion> {
  const questions: Record<string, DecisionQuestion> = {};
  for (const index of indices) {
    questions[`present_${index}`] = {
      type: "noul",
      instructions: `Does \`${image(index)}\` show \`targets.t${index}\`?`,
    };
    questions[`box_${index}`] = {
      type: "box",
      instructions: `\`targets.t${index}\` in \`${image(index)}\``,
    };
  }
  return questions;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

/**
 * Locates one target on one PDF page. The first request asks a presence Noul
 * and a full-page Box together (Box has no "not found" answer). Full-page Box
 * edges are coarse (0.01 steps), so a second Box runs on a zoomed crop around
 * the padded first box, and its edges are mapped back to page fractions.
 */
export async function locateOnPdfPage(
  ctx: ActionCtx,
  params: Omit<Parameters<typeof locateTargetsOnPdfPage>[1], "targets"> & {
    /** What to find, written as a noun phrase, e.g. a quoted line of text. */
    target: DecisionEntry;
  },
): Promise<PdfPageLocation> {
  const { target, ...rest } = params;
  return (await locateTargetsOnPdfPage(ctx, { ...rest, targets: [target] }))[0];
}

/**
 * Batched `locateOnPdfPage` for many targets on one page: one full-page
 * request asks every presence Noul and coarse Box together, then zoomed crops
 * of the targets Jev found are refined together. Results follow input order.
 */
export async function locateTargetsOnPdfPage(
  ctx: ActionCtx,
  params: {
    pdfBytes: Uint8Array;
    page: number;
    /** What to find, each written as a noun phrase or a small object. */
    targets: DecisionEntry[];
    orgId?: Id<"organizations">;
    task: string;
    surface: string;
    sessionKey: string;
    traceId?: string;
    /** Reuse an already rendered full page. */
    pageImage?: PdfPageImage;
  },
): Promise<PdfPageLocation[]> {
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
  const unlocated = (present: number): PdfPageLocation => ({
    present,
    box: null,
    bbox: null,
    confidence: 0,
    pageWidth: pageImage.pageWidth,
    pageHeight: pageImage.pageHeight,
  });
  const results = params.targets.map(() => unlocated(0));
  const coarse = new Map<number, DecisionBox>();

  const full = await stageJevImages(ctx, [pdfPageJevImage(pageImage)], scope);
  try {
    for (const group of chunks(
      params.targets.map((target, index) => ({ target, index })),
      MAX_PAGE_TARGETS_PER_REQUEST,
    )) {
      const result = await clRouterDecide(
        {
          ...request,
          state: {
            page: full.refs[0],
            targets: Object.fromEntries(
              group.map(({ target, index }) => [`t${index}`, target]),
            ),
          },
          assets: full.assets,
          questions: targetQuestions(
            group.map(({ index }) => index),
            () => "page",
          ),
        },
        { telemetry: ctx },
      );
      for (const { index } of group) {
        const presentAnswer = result.answers[`present_${index}`];
        const boxAnswer = result.answers[`box_${index}`];
        const present =
          presentAnswer?.type === "noul" ? presentAnswer.noul : 0;
        results[index] = unlocated(present);
        if (jevProceeds(present) && boxAnswer?.type === "box")
          // The page image may be margin-trimmed; map its box back to page fractions.
          coarse.set(index, mapFromRegion(boxAnswer.box, pageImage.region));
      }
    }
  } finally {
    await full.cleanup();
  }

  for (const group of chunks([...coarse], MAX_CROPS_PER_REQUEST)) {
    const crops = [];
    for (const [index, box] of group) {
      const crop = await renderPdfPageRegion({
        pdfBytes: params.pdfBytes,
        page: params.page,
        region: padBox(box, ZOOM_PADDING),
      });
      crops.push({ index, crop });
    }
    const zoomed = await stageJevImages(
      ctx,
      crops.map(({ index, crop }) => ({
        ...pdfPageJevImage(crop),
        label: `page-${params.page}-crop-${index}`,
      })),
      scope,
    );
    try {
      const result = await clRouterDecide(
        {
          ...request,
          state: {
            crops: Object.fromEntries(
              crops.map(({ index }, position) => [
                `t${index}`,
                zoomed.refs[position],
              ]),
            ),
            targets: Object.fromEntries(
              crops.map(({ index }) => [`t${index}`, params.targets[index]]),
            ),
          },
          assets: zoomed.assets,
          questions: targetQuestions(
            crops.map(({ index }) => index),
            (index) => `crops.t${index}`,
          ),
        },
        { telemetry: ctx },
      );
      for (const { index, crop } of crops) {
        const cropPresent = result.answers[`present_${index}`];
        const answer = result.answers[`box_${index}`];
        // The coarse box can land on a similar label; require the crop to show the target too.
        if (
          cropPresent?.type !== "noul" ||
          !jevProceeds(cropPresent.noul) ||
          answer?.type !== "box"
        )
          continue;
        const box = mapFromRegion(answer.box, crop.region);
        results[index] = {
          ...results[index],
          box,
          bbox: boxToPdfBbox(
            box,
            params.page,
            pageImage.pageWidth,
            pageImage.pageHeight,
          ),
          confidence: answer.confidence,
        };
      }
    } finally {
      await zoomed.cleanup();
    }
  }
  return results;
}
