"use node";

/**
 * Extraction pipeline — cl-sdk source-span contract.
 */

// ── Still exported from SDK ──
export { stripFences, sanitizeNulls, extractPageRange, getPdfPageCount } from "@claritylabs/cl-sdk";
export { CONTEXT_KEY_MAP } from "@claritylabs/cl-sdk";
export { chunkDocument, createExtractor, runCoverageRecovery } from "@claritylabs/cl-sdk";

// ── Types ──
export type { LogFn, ContextKeyMapping, TokenUsage, ConvertPdfToImagesFn, PdfInput } from "@claritylabs/cl-sdk";
export type { ExtractorConfig, ExtractionResult, ExtractOptions, InsuranceDocument, DocumentChunk, PipelineCheckpoint, AuxiliaryFact } from "@claritylabs/cl-sdk";

// ── Local re-exports ──
export { insuranceDocToPolicy, policyToInsuranceDoc } from "./documentMapping";

// ── Spot extraction factory ──
import { createExtractor } from "@claritylabs/cl-sdk";
import type { LogFn, TokenUsage } from "@claritylabs/cl-sdk";
import { makeDecide, makeGenerateObject } from "./sdkCallbacks";
import { decisionPolicyFromEnvironment, logDecisionEvent } from "./decisions";
import { modelCapabilitiesForTask } from "./modelCatalog";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { PageScreenshot } from "./liteparsePreprocessor";

function readBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function enrichProviderOptionsWithPageImages<T extends { providerOptions?: unknown; trace?: unknown }>(
  params: T,
  screenshots: PageScreenshot[] | undefined,
): T {
  if (!screenshots?.length) return params;
  const trace = params.trace as { startPage?: unknown; endPage?: unknown } | undefined;
  const startPage = typeof trace?.startPage === "number" ? trace.startPage : undefined;
  const endPage = typeof trace?.endPage === "number" ? trace.endPage : startPage;
  if (!startPage || !endPage) return params;
  const maxImages = readBoundedIntEnv("EXTRACTION_MULTIMODAL_MAX_IMAGES", 2, 0, 6);
  if (maxImages <= 0) return params;
  const images = screenshots
    .filter((shot) => shot.page >= startPage && shot.page <= endPage)
    .slice(0, maxImages)
    .map((shot) => ({
      imageBase64: shot.imageBase64,
      mimeType: shot.mimeType,
    }));
  if (images.length === 0) return params;
  return {
    ...params,
    providerOptions: {
      ...((params.providerOptions as Record<string, unknown> | undefined) ?? {}),
      images,
    },
  };
}

export function buildExtractor(opts?: {
  ctx?: ActionCtx;
  orgId?: Id<"organizations">;
  traceId?: string;
  tracePolicyId?: Id<"policies"> | string;
  log?: LogFn;
  onProgress?: (message: string) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
  shouldCancel?: () => Promise<boolean>;
  pageScreenshots?: PageScreenshot[];
}) {
  const routing = opts?.ctx && opts.orgId
    ? {
        ctx: opts.ctx,
        orgId: opts.orgId,
        traceId: opts.traceId,
        tracePolicyId: opts.tracePolicyId,
      }
    : undefined;
  const generateObject = makeGenerateObject("extraction", routing);
  const decide = makeDecide(routing);
  const throwIfCancelled = async () => {
    if (await opts?.shouldCancel?.()) {
      throw new Error("Cancelled by user");
    }
  };

  return createExtractor({
    decide: async (request) => {
      await throwIfCancelled();
      const result = await decide(request);
      await throwIfCancelled();
      return result;
    },
    decisionPolicy: decisionPolicyFromEnvironment(),
    onDecision: logDecisionEvent,
    generateObject: async (params) => {
      await throwIfCancelled();
      const result = await generateObject(
        enrichProviderOptionsWithPageImages(params, opts?.pageScreenshots),
      );
      await throwIfCancelled();
      return result;
    },
    log: opts?.log,
    onProgress: opts?.onProgress,
    onTokenUsage: opts?.onTokenUsage,
    modelCapabilities: modelCapabilitiesForTask("extraction"),
    modelCapabilitiesByTaskKind: {
      extraction_coverage_recovery: modelCapabilitiesForTask(
        "extraction_coverage_recovery",
      ),
    },
  });
}
