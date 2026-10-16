"use node";

// Renders PDF pages to JPEG for Jev image decisions. Jev rejects images with a
// side under 280px or over 1568px, so every render is sized into that window.

import type { DecisionBox } from "../../contracts/cl-router/policy";

export const JEV_IMAGE_MIN_SIDE = 280;
export const JEV_IMAGE_MAX_SIDE = 1568;
/**
 * Default longest side for whole pages. On October 16, 2026 fixtures, 1280px
 * matched full-size answers at about 70% of the tokens; 1024px lost confidence.
 */
export const JEV_PAGE_MAX_SIDE = 1280;
/** Upper bound on zoom when rendering a small region, to avoid huge rasters. */
const MAX_REGION_SCALE = 8;
/**
 * Jev bills images by pixel area, not file size, so quality mainly shrinks
 * uploads; 60 gave the same answers as 88 at half the bytes.
 */
export const JPEG_QUALITY = 60;

export type PdfPageImage = {
  /** 1-based page number in the original PDF. */
  page: number;
  bytes: Uint8Array;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  /** Page size in PDF points at scale 1, matching `sourceSpans.bbox` coordinates. */
  pageWidth: number;
  pageHeight: number;
  /** Page area the image covers, as fractions of the page; the full page is 0..1. */
  region: DecisionBox;
};

const FULL_PAGE: DecisionBox = { top: 0, bottom: 1, left: 0, right: 1 };

type PdfDocument = Awaited<
  ReturnType<
    typeof import("pdfjs-dist/legacy/build/pdf.mjs").getDocument
  >["promise"]
>;

async function openPdf(pdfBytes: Uint8Array): Promise<PdfDocument> {
  const { getDocument, VerbosityLevel } =
    await import("pdfjs-dist/legacy/build/pdf.mjs");
  return await getDocument({
    data: new Uint8Array(pdfBytes),
    isEvalSupported: false,
    useWasm: false,
    useSystemFonts: true,
    verbosity: VerbosityLevel.ERRORS,
  }).promise;
}

function scaleForRegion(
  regionWidth: number,
  regionHeight: number,
  maxSide: number,
): number {
  const fit = maxSide / Math.max(regionWidth, regionHeight);
  const floor = JEV_IMAGE_MIN_SIDE / Math.min(regionWidth, regionHeight);
  return Math.min(Math.max(fit, floor), MAX_REGION_SCALE);
}

async function renderRegion(
  doc: PdfDocument,
  pageNumber: number,
  region: DecisionBox,
  maxSide: number,
): Promise<PdfPageImage> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const regionWidth = (region.right - region.left) * base.width;
  const regionHeight = (region.bottom - region.top) * base.height;
  const scale = scaleForRegion(regionWidth, regionHeight, maxSide);
  const viewport = page.getViewport({
    scale,
    offsetX: -region.left * base.width * scale,
    offsetY: -region.top * base.height * scale,
  });
  const width = Math.min(
    maxSide,
    Math.max(JEV_IMAGE_MIN_SIDE, Math.round(regionWidth * scale)),
  );
  const height = Math.min(
    maxSide,
    Math.max(JEV_IMAGE_MIN_SIDE, Math.round(regionHeight * scale)),
  );
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  page.cleanup();
  return {
    page: pageNumber,
    bytes: new Uint8Array(await canvas.encode("jpeg", JPEG_QUALITY)),
    mediaType: "image/jpeg",
    width,
    height,
    pageWidth: base.width,
    pageHeight: base.height,
    // The canvas can be clamped (long thin regions) or padded (tiny regions),
    // so report the page area it actually covers for mapping answers back.
    region: {
      left: region.left,
      top: region.top,
      right: region.left + width / (scale * base.width),
      bottom: region.top + height / (scale * base.height),
    },
  };
}

/** Renders whole pages, longest side at most `maxSide` (default JEV_PAGE_MAX_SIDE). */
export async function renderPdfPageImages(params: {
  pdfBytes: Uint8Array;
  pages: number[];
  maxSide?: number;
}): Promise<PdfPageImage[]> {
  const maxSide = Math.min(
    params.maxSide ?? JEV_PAGE_MAX_SIDE,
    JEV_IMAGE_MAX_SIDE,
  );
  const doc = await openPdf(params.pdfBytes);
  try {
    const images: PdfPageImage[] = [];
    for (const page of params.pages) {
      if (page < 1 || page > doc.numPages) continue;
      images.push(await renderRegion(doc, page, FULL_PAGE, maxSide));
    }
    return images;
  } finally {
    await doc.destroy();
  }
}

/** Renders one region of a page at higher resolution, for zoomed Box refinement. */
export async function renderPdfPageRegion(params: {
  pdfBytes: Uint8Array;
  page: number;
  region: DecisionBox;
  maxSide?: number;
}): Promise<PdfPageImage> {
  const doc = await openPdf(params.pdfBytes);
  try {
    return await renderRegion(
      doc,
      params.page,
      params.region,
      Math.min(params.maxSide ?? JEV_IMAGE_MAX_SIDE, JEV_IMAGE_MAX_SIDE),
    );
  } finally {
    await doc.destroy();
  }
}
