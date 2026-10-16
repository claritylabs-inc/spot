"use node";

// Batched Jev Choice questions over per-item evidence (text, plus an optional
// page image). Items share one request; questions are named per item because
// question IDs are not sent to Jev.

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type {
  DecisionEntry,
  DecisionQuestion,
  JsonValue,
} from "../../contracts/cl-router/policy";
import {
  clRouterDecide,
  isClRouterPayloadTooLarge,
  runWithPayloadSplitting,
} from "./clRouterClient";
import { jevChoiceConfidence } from "./jevThreshold";
import { pdfPageJevImage, stageJevImages } from "./jevImages";
import { renderPdfPageImages, type PdfPageImage } from "./pdfPageImages";

export type EvidenceChoiceItem = {
  key: string;
  /** Structured evidence for this item; Jev reads it at `items.<ref>`. */
  evidence: Record<string, JsonValue>;
  /** 1-based PDF page shown to Jev as an image, placed at `items.<ref>.page`. */
  page?: number;
};

export type EvidenceChoiceSpec = {
  field: string;
  /** `ref` is the backticked path of the item, e.g. `items.i2`. */
  instructions: (ref: string) => DecisionEntry;
  criteria: Record<string, DecisionEntry>;
};

export type EvidenceChoiceAnswer = {
  choice: string;
  /** Lower of Jev's confidence and the chosen option's probability. */
  confidence: number;
};

export type EvidenceChoiceResults = Map<
  string,
  Record<string, EvidenceChoiceAnswer>
>;

/** Jev holds about 6-8 page images per call. */
const DEFAULT_ITEMS_PER_REQUEST = 6;

export async function decideChoicesOverEvidence(
  ctx: ActionCtx,
  params: {
    orgId: Id<"organizations">;
    traceId?: string;
    task: string;
    surface: string;
    sessionKey: string;
    items: EvidenceChoiceItem[];
    specs: EvidenceChoiceSpec[];
    /** Needed only when items carry a `page`; images are skipped if it fails. */
    loadPdf?: () => Promise<Uint8Array | null>;
    itemsPerRequest?: number;
  },
): Promise<EvidenceChoiceResults> {
  const results: EvidenceChoiceResults = new Map();
  if (params.items.length === 0 || params.specs.length === 0) return results;

  const pageImages = new Map<number, PdfPageImage | null>();
  const renderPages = async (pages: number[]) => {
    const missing = [...new Set(pages)].filter((page) => !pageImages.has(page));
    if (missing.length === 0 || !params.loadPdf) return;
    try {
      const pdfBytes = await params.loadPdf();
      if (!pdfBytes) throw new Error("PDF unavailable");
      const rendered = await renderPdfPageImages({ pdfBytes, pages: missing });
      for (const page of missing) {
        pageImages.set(
          page,
          rendered.find((image) => image.page === page) ?? null,
        );
      }
    } catch {
      for (const page of missing) pageImages.set(page, null);
    }
  };

  const requestPart = async (
    part: EvidenceChoiceItem[],
    withImages: boolean,
  ): Promise<EvidenceChoiceResults> => {
    const imageItems = withImages
      ? part.filter(
          (item) =>
            item.page !== undefined && pageImages.get(item.page) != null,
        )
      : [];
    const staged = imageItems.length
      ? await stageJevImages(
          ctx,
          imageItems.map((item) =>
            pdfPageJevImage(pageImages.get(item.page!)!),
          ),
          {
            orgId: params.orgId,
            surface: params.surface,
            sessionKey: params.sessionKey,
          },
        )
      : null;
    try {
      const refByKey = new Map(part.map((item, index) => [item.key, `i${index}`]));
      const items: Record<string, JsonValue> = {};
      const questions: Record<string, DecisionQuestion> = {};
      part.forEach((item, index) => {
        const ref = `i${index}`;
        const imageIndex = imageItems.indexOf(item);
        items[ref] = {
          ...item.evidence,
          ...(staged && imageIndex >= 0 ? { page: staged.refs[imageIndex] } : {}),
        };
        for (const spec of params.specs) {
          questions[`${ref}_${spec.field}`] = {
            type: "choice",
            instructions: spec.instructions(`items.${ref}`),
            criteria: spec.criteria,
          };
        }
      });
      const response = await clRouterDecide(
        {
          orgId: String(params.orgId),
          task: params.task,
          ...(params.traceId ? { trace: { traceId: params.traceId } } : {}),
          state: { items },
          ...(staged ? { assets: staged.assets } : {}),
          questions,
        },
        { telemetry: ctx },
      );
      const out: EvidenceChoiceResults = new Map();
      for (const item of part) {
        const ref = refByKey.get(item.key)!;
        const answers: Record<string, EvidenceChoiceAnswer> = {};
        for (const spec of params.specs) {
          const answer = response.answers[`${ref}_${spec.field}`];
          if (answer?.type !== "choice") continue;
          answers[spec.field] = {
            choice: answer.choice,
            confidence: jevChoiceConfidence(answer),
          };
        }
        out.set(item.key, answers);
      }
      return out;
    } finally {
      await staged?.cleanup();
    }
  };

  const perRequest = Math.max(
    1,
    params.itemsPerRequest ?? DEFAULT_ITEMS_PER_REQUEST,
  );
  const chunks: EvidenceChoiceItem[][] = [];
  for (let index = 0; index < params.items.length; index += perRequest) {
    chunks.push(params.items.slice(index, index + perRequest));
  }
  await renderPages(
    params.items.flatMap((item) => (item.page !== undefined ? [item.page] : [])),
  );
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const parts = await runWithPayloadSplitting(chunk, async (part) => {
          try {
            return await requestPart(part, true);
          } catch (error) {
            // One item whose image alone is too large still gets a text answer.
            if (part.length === 1 && isClRouterPayloadTooLarge(error)) {
              return await requestPart(part, false);
            }
            throw error;
          }
        });
        for (const part of parts) {
          for (const [key, answers] of part) results.set(key, answers);
        }
      } catch {
        // A decision that cannot be made leaves its items unanswered; callers
        // route unanswered items to their low-confidence fallback.
      }
    }),
  );
  return results;
}
