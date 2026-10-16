"use node";

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import dayjs from "dayjs";
import {
  buildCitationIndex,
  MATCH_RANK,
  resolveCitationWithIndex,
  type ResolvedCitation,
} from "./citationResolver";
import { locateOnPdfPage, pdfPageJevImage, stageJevImages } from "./jevImages";
import { jevProceeds } from "./jevThreshold";
import { clRouterDecide, runWithPayloadSplitting } from "./clRouterClient";
import type { DecisionQuestion } from "../../contracts/cl-router/policy";
import { renderPdfPageImages, renderPdfPageRegion } from "./pdfPageImages";
import type { SourceSpanLike } from "./sourceTree";
import type { SectionResult } from "./sectionExtraction/merge";
import { citationPageCandidates } from "./sectionExtraction/prompts";
import type { SectionCitation } from "./sectionExtraction/schemas";

const MAX_LOCALIZED_CITATIONS = 40;

function citationsIn(value: unknown): SectionCitation[] {
  if (Array.isArray(value)) return value.flatMap(citationsIn);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "citations" && Array.isArray(child)
      ? child.filter(
          (citation): citation is SectionCitation =>
            !!citation &&
            typeof citation === "object" &&
            typeof citation.page === "number" &&
            typeof citation.quote === "string",
        )
      : citationsIn(child),
  );
}

/** Adds optional presentation boxes; never upgrades citation grounding. */
export async function localizePolicyCitations(args: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  policyId: string;
  pdfBytes: Uint8Array;
  sourceSpans: SourceSpanLike[];
  results: SectionResult[];
  traceId?: string;
  deadlineMs?: number;
  isCancelled?: () => Promise<boolean>;
  log?: (message: string) => Promise<void>;
}): Promise<SourceSpanLike[]> {
  const spans = args.sourceSpans.map((span) => ({ ...span }));
  const deadlineMs = args.deadlineMs ?? dayjs().add(120, "seconds").valueOf();
  const citationIndex = buildCitationIndex(spans);
  const spansById = new Map(
    spans.map((span) => [span.id ?? span.spanId ?? "", span]),
  );
  const seen = new Set<string>();
  let attempted = 0;
  let localized = 0;
  const finish = async (stopped?: string) => {
    await args.log?.(
      `Localized ${localized}/${attempted} citation targets (maximum ${MAX_LOCALIZED_CITATIONS})${stopped ? `; stopped early: ${stopped}` : ""}.`,
    );
    return spans;
  };
  // Stable sorting preserves extraction order within each priority.
  const results = [...args.results].sort(
    (a, b) =>
      Number(b.kind === "declarations") - Number(a.kind === "declarations"),
  );
  const pending = new Map<number, Array<{ quote: string; resolved: ResolvedCitation; targets: SourceSpanLike[] }>>();
  collect: for (const { section, output } of results) {
    for (const citation of citationsIn(output)) {
      if (attempted >= MAX_LOCALIZED_CITATIONS) break collect;
      if (dayjs().valueOf() >= deadlineMs) return finish("time budget");
      const quote = citation.quote.trim();
      if (!quote) continue;
      let resolved: ResolvedCitation | undefined;
      for (const page of citationPageCandidates(citation.page, section)) {
        const candidate = resolveCitationWithIndex(
          { page, quote },
          citationIndex,
        );
        if (
          !resolved ||
          MATCH_RANK[candidate.match] > MATCH_RANK[resolved.match]
        )
          resolved = candidate;
      }
      if (!resolved || resolved.match === "unresolved") continue;
      const page = resolved.page;
      const key = `${page}:${quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const targets = resolved.sourceSpanIds.flatMap((id) => {
        const span = spansById.get(id);
        return span && !span.bbox?.length ? [span] : [];
      });
      if (resolved.match !== "page_only" && !targets.length) continue;
      attempted += 1;
      const pageTargets = pending.get(page) ?? [];
      pageTargets.push({ quote, resolved, targets });
      pending.set(page, pageTargets);
    }
  }
  for (const [page, pageTargets] of pending) {
    if (await args.isCancelled?.()) return finish("cancelled");
    if (dayjs().valueOf() >= deadlineMs) return finish("time budget");
    try {
      const [pageImage] = await renderPdfPageImages({ pdfBytes: args.pdfBytes, pages: [page] });
      if (!pageImage) continue;
      const staged = await stageJevImages(args.ctx, [pdfPageJevImage(pageImage)], {
        orgId: args.orgId, surface: "policy-citations", sessionKey: args.policyId,
      });
      try {
        const batches = await runWithPayloadSplitting(pageTargets, async (batch) => {
          if (await args.isCancelled?.()) return;
          if (dayjs().valueOf() >= deadlineMs) return;
          const questions: Record<string, DecisionQuestion> = {};
          batch.forEach((_, i) => {
            questions[`present_${i}`] = { type: "noul", instructions: `Does \`page\` show the quoted text in \`targets[${i}].quote\`?` };
            questions[`box_${i}`] = { type: "box", instructions: `The quoted text in \`targets[${i}].quote\` on \`page\`.` };
          });
          const coarse = await clRouterDecide({
            orgId: String(args.orgId), task: "policy_citation_localization",
            state: { page: staged.refs[0], targets: batch.map(({ quote }) => ({ quote })) },
            assets: staged.assets, questions,
            trace: args.traceId ? { traceId: args.traceId } : undefined,
          }, { telemetry: args.ctx });
          return { batch, coarse };
        });
        for (const entry of batches) {
          if (!entry) continue;
          const { batch, coarse } = entry;
          for (const [i, { quote, resolved, targets }] of batch.entries()) {
            if (await args.isCancelled?.()) return finish("cancelled");
            if (dayjs().valueOf() >= deadlineMs) return finish("time budget");
            const presence = coarse.answers[`present_${i}`];
            const box = coarse.answers[`box_${i}`];
            if (presence?.type !== "noul" || !jevProceeds(presence.noul) ||
                box?.type !== "box" || !jevProceeds(box.confidence)) continue;
            const region = pageImage.region;
            const crop = await renderPdfPageRegion({
              pdfBytes: args.pdfBytes, page,
              region: {
                left: Math.max(0, region.left + box.box.left * (region.right - region.left) - 0.06),
                right: Math.min(1, region.left + box.box.right * (region.right - region.left) + 0.06),
                top: Math.max(0, region.top + box.box.top * (region.bottom - region.top) - 0.06),
                bottom: Math.min(1, region.top + box.box.bottom * (region.bottom - region.top) + 0.06),
              },
            });
            const [location] = await runWithPayloadSplitting([quote], async () => locateOnPdfPage(args.ctx, {
              pdfBytes: args.pdfBytes, page, pageImage: crop, target: { quote },
              orgId: args.orgId, task: "policy_citation_localization",
              surface: "policy-citations", sessionKey: args.policyId, traceId: args.traceId,
            }));
            if (
              !location.bbox ||
              !jevProceeds(location.present) ||
              !jevProceeds(location.confidence)
            )
              continue;
            // A Box locates presentation evidence; it cannot make an unmatched quote
            // into a grounded fact. Keep page_only annotations separate from text.
            const destinations =
              resolved.match === "page_only"
                ? [
                    {
                      id: `${args.policyId}:citation-box:${page}:${spans.length}`,
                      documentId: args.policyId,
                      sourceKind: "policy_pdf",
                      kind: "pdf_text",
                      sourceUnit: "citation_annotation",
                      pageStart: page,
                      pageEnd: page,
                      text: "",
                      metadata: {
                        citationQuote: quote,
                        citationMatch: "page_only",
                      },
                    } satisfies SourceSpanLike,
                  ]
                : targets;
            for (const span of destinations) {
              const next: SourceSpanLike = {
                ...span,
                bbox: [location.bbox],
                metadata: {
                  ...span.metadata,
                  bboxCoordinateWidth: location.pageWidth,
                  bboxCoordinateHeight: location.pageHeight,
                  bboxSource: "jev_box",
                  bboxConfidence: location.confidence,
                },
              };
              const index = spans.indexOf(span);
              if (index < 0) spans.push(next);
              else spans[index] = next;
              spansById.set(next.id ?? next.spanId ?? "", next);
            }
            localized += 1;
          }
        }
      } finally {
        await staged.cleanup();
      }
    } catch (error) {
      await args.log?.(
        `Citation localization unavailable on page ${page}; retaining page evidence (${error instanceof Error ? error.message : String(error)}).`,
      );
      // Infrastructure failure affects subsequent images too; avoid 40 failed calls.
      return finish("localization unavailable");
    }
  }
  return finish();
}
