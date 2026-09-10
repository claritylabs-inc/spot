"use node";

import { randomUUID } from "crypto";
import dayjs from "dayjs";
import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { runPipeline } from "@claritylabs/cl-pipelines";
import {
  createConvexStorageAdapter,
  createConvexSchedulerAdapter,
} from "@claritylabs/cl-pipelines/convex";
import type { Phase, PhaseResult } from "@claritylabs/cl-pipelines";
import { buildExtractor, runCoverageRecovery } from "../lib/extraction";
import { deletePolicyRowsInBatches } from "../lib/deletePolicyRowsInBatches";
import {
  preparePdfTextWithParserFallback,
  preparePdfTextWithPdfJs,
  tryConvertPdfWithLiteParse,
} from "../lib/liteparsePreprocessor";
import type { ExtractionResult, PipelineCheckpoint } from "../lib/extraction";
import type { ExtractOptions } from "../lib/extraction";
import {
  makeEmbedTexts,
  makeGenerateObject,
  type EmbedTexts,
} from "../lib/sdkCallbacks";
import { modelCapabilitiesForTask } from "../lib/modelCatalog";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { isFeatureEnabled } from "../lib/featureFlags";
import { isSpecimenPolicyDocument } from "../lib/policyDocumentGate";
import {
  buildExtractionCompletionManifest,
  buildPromotionEvidenceLedger,
  buildPromotionSourceCoverageMap,
  type ExtractionCompletionManifest,
} from "../lib/extractionPromotion";

type ExtractionState = Record<string, unknown>;
import {
  openExtractionReviewQuestions,
  postProcessExtractionDocument,
} from "../lib/extractionPostProcess";
import {
  normalizeOperationalProfile,
  normalizeSourceTree,
  operationalProfilePolicyFields,
  sourceNodeFromStoredSource,
  sourceSpanLikeFromStoredSource,
  sourceSpansForSdk,
  sourceTreePolicyFields,
  type DocumentSourceNode,
  type PolicyOperationalProfile,
  type SourceSpanLike,
} from "../lib/sourceTree";
import { z } from "zod";

const CANCELLED_BY_USER = "Cancelled by user";
const NON_INSURANCE_DOCUMENT_ERROR =
  "This document is not a bound insurance policy, binder, endorsement, renewal, or post-binding insurance document, so extraction was stopped.";
const ADVANCE_LEASE_MS = 2 * 60 * 1000;
const ADVANCE_LEASE_HEARTBEAT_MS = 30 * 1000;
const ADVANCE_LEASE_WATCHDOG_GRACE_MS = 15 * 1000;
const EMBEDDING_CONCURRENCY = readBoundedIntEnv(
  "EXTRACTION_EMBEDDING_CONCURRENCY",
  8,
  1,
  16,
);
const EXTERNAL_WORKER_MODE = process.env.EXTRACTION_WORKER_MODE === "external";
const EXPECTED_EXTERNAL_WORKER_PROTOCOL_VERSION =
  process.env.EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION;
const EXPECTED_EXTERNAL_WORKER_CL_SDK_VERSION =
  process.env.EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION;
const EXTERNAL_WORKER_LEASE_MS = readBoundedIntEnv(
  "EXTRACTION_WORKER_LEASE_MS",
  5 * 60 * 1000,
  60 * 1000,
  30 * 60 * 1000,
);
const EMBEDDING_BATCH_SIZE = readBoundedIntEnv(
  "EXTRACTION_EMBEDDING_BATCH_SIZE",
  128,
  1,
  512,
);
const SOURCE_STORAGE_BATCH_SIZE = readBoundedIntEnv(
  "EXTRACTION_SOURCE_STORAGE_BATCH_SIZE",
  200,
  25,
  500,
);

type StoredArtifact = {
  artifactId: string;
  storageId: string;
  byteLength: number;
  durationMs: number;
};
type PipelineLogLevel = "info" | "warn" | "error";

type LeasedPolicyCheckpoint = {
  nextPhase: string;
  state: PolicyExtractionState;
  createdAt: number;
  lease?: {
    id: string;
    phase: string;
    expiresAt: number;
    heartbeatAt?: number;
  };
};

function sourceSpanIdentity(span: SourceSpanLike) {
  const table = span.table && typeof span.table === "object" ? span.table : {};
  const metadata =
    span.metadata && typeof span.metadata === "object" ? span.metadata : {};
  const sourceUnit =
    span.sourceUnit ?? metadata.sourceUnit ?? metadata.elementType ?? "";
  if (sourceUnit === "page") {
    return [
      span.documentId ?? "",
      span.sourceKind ?? "",
      span.pageStart ?? "",
      span.pageEnd ?? "",
      sourceUnit,
    ].join("\u001f");
  }
  return [
    span.documentId ?? "",
    span.sourceKind ?? "",
    span.pageStart ?? "",
    span.pageEnd ?? "",
    sourceUnit,
    typeof table.tableId === "string" ? table.tableId : "",
    typeof table.rowIndex === "number" ? table.rowIndex : "",
    typeof table.columnIndex === "number" ? table.columnIndex : "",
    typeof table.columnName === "string" ? table.columnName : "",
    typeof span.text === "string"
      ? span.text
          .replace(/\s+/g, " ")
          .replace(/^SPECIMEN POLICY — FOR TESTING ONLY\s+/i, "")
          .trim()
      : "",
  ].join("\u001f");
}

function sourceSpanOrder(span: SourceSpanLike, fallbackIndex: number) {
  const id =
    typeof span.id === "string"
      ? span.id
      : typeof span.spanId === "string"
        ? span.spanId
        : "";
  const idIndex = Number(id.match(/:span:\d+:(\d+):/)?.[1]);
  return {
    page:
      typeof span.pageStart === "number"
        ? span.pageStart
        : Number.MAX_SAFE_INTEGER,
    index: Number.isFinite(idIndex) ? idIndex : fallbackIndex,
  };
}

function canonicalSourceSpans(sourceSpans: SourceSpanLike[]) {
  const seen = new Set<string>();
  const deduped: SourceSpanLike[] = [];
  sourceSpans.forEach((span) => {
    const key = sourceSpanIdentity(span);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(span);
  });
  return deduped.sort((left, right) => {
    const leftOrder = sourceSpanOrder(left, sourceSpans.indexOf(left));
    const rightOrder = sourceSpanOrder(right, sourceSpans.indexOf(right));
    return (
      leftOrder.page - rightOrder.page || leftOrder.index - rightOrder.index
    );
  });
}

function sourceKindForStorage(value: unknown) {
  return value === "policy_pdf" ||
    value === "email" ||
    value === "attachment" ||
    value === "manual_note"
    ? value
    : "policy_pdf";
}

function fieldsWithPersistedCarrierIdentity(
  fields: Record<string, unknown>,
  policy: { carrierIdentity?: unknown } | null,
) {
  return policy?.carrierIdentity
    ? { ...fields, carrierIdentity: policy.carrierIdentity }
    : fields;
}

// ─── State Type ────────────────────────────────────────────────────────────────

export type PolicyExtractionState = {
  /** "upload" = direct file upload; "agent_email" = attachment forwarded to the email agent */
  sourceKind: "upload" | "agent_email";
  /** Convex storage ID of the PDF */
  fileId?: string;
  fileName?: string;
  orgId: string;
  userId: string;
  policyFileId?: string;
  policyVersionKind?: "new_policy" | "re_extraction" | "renewal";
  /**
   * Set before replacement fields or files are written. Replacement failures
   * remain operationally complete only while this is explicitly false.
   */
  replacementPromotionStarted?: boolean;
  traceId?: string;
  externalWorker?: boolean;
  /** Client-owned feature snapshot. It must not be re-read during a run. */
  coverageRecovery?: { enabled: boolean; forcedByOperator?: boolean };
  /** Deprecated inline SDK checkpoint. Kept only so legacy stored state can deserialize. */
  clSdkCheckpoint?: PipelineCheckpoint<ExtractionState>;
  /** Deprecated storage-backed SDK checkpoint. New source-span SDK runs do not write it. */
  clSdkCheckpointFileId?: string;
  chunkIds?: string[];
  sourceSpanIds?: string[];
  sourceChunkIds?: string[];
  /** Storage-backed embedding payload produced by extraction and consumed by embed_and_store. */
  embeddingPayloadFileId?: string;
  documentChunksForEmbedding?: Array<{
    id: string;
    type: string;
    text: string;
    metadata: Record<string, unknown>;
  }>;
  sourceSpansForStorage?: Array<{
    id: string;
    documentId?: string;
    sourceKind?: string;
    pageStart?: number;
    pageEnd?: number;
    sectionId?: string;
    formNumber?: string;
    sourceUnit?: string;
    parentSpanId?: string;
    table?: Record<string, unknown>;
    location?: unknown;
    text: string;
    textHash?: string;
    bbox?: unknown;
    metadata?: Record<string, unknown>;
  }>;
  sourceChunksForEmbedding?: Array<{
    id: string;
    documentId?: string;
    sourceSpanIds?: string[];
    text: string;
    metadata?: Record<string, unknown>;
  }>;
  sourceNodesForStorage?: Array<DocumentSourceNode>;
  operationalProfile?: PolicyOperationalProfile;
};

function shouldArchiveRejectedPolicy(
  policyVersionKind: PolicyExtractionState["policyVersionKind"],
) {
  return !policyVersionKind || policyVersionKind === "new_policy";
}

type EmbeddingPayload = Pick<
  PolicyExtractionState,
  | "documentChunksForEmbedding"
  | "sourceSpansForStorage"
  | "sourceChunksForEmbedding"
  | "sourceNodesForStorage"
>;

type ExternalCompletionPayload = {
  protocolVersion?: "source-tree-v1" | "source-tree-v2";
  extractorVersion?: string;
  sections?: ExtractionCompletionManifest["sections"];
  document: unknown;
  chunks: unknown[];
  sourceSpans: unknown[];
  sourceChunks: unknown[];
  sourceTree?: unknown[];
  operationalProfile?: unknown;
  warnings?: string[];
  tokenUsage?: unknown;
  performanceReport?: unknown;
  coverageRecovery?: unknown;
};

type CoverageRecoveryDiagnosticsLike = {
  version?: unknown;
  status?: unknown;
  regionCount?: unknown;
  modelCallCount?: unknown;
  recoveredCoverageCount?: unknown;
  recoveredTermCount?: unknown;
  recoveredScheduleCount?: unknown;
  recoveredFinancialFactCount?: unknown;
  citationRejectionCount?: unknown;
  warnings?: unknown;
};

function coverageRecoverySucceeded(
  state: PolicyExtractionState,
  diagnostics: unknown,
): diagnostics is CoverageRecoveryDiagnosticsLike & { status: "succeeded" } {
  if (
    !state.coverageRecovery?.enabled ||
    !diagnostics ||
    typeof diagnostics !== "object"
  ) {
    return false;
  }
  const value = diagnostics as CoverageRecoveryDiagnosticsLike;
  return (
    value.version === "coverage-recovery-v2" && value.status === "succeeded"
  );
}

function coverageRecoveryLogMessage(diagnostics: unknown): string | undefined {
  if (!diagnostics || typeof diagnostics !== "object") return undefined;
  const value = diagnostics as CoverageRecoveryDiagnosticsLike;
  if (typeof value.status !== "string") return undefined;
  const count = (candidate: unknown) =>
    typeof candidate === "number" ? candidate : 0;
  return [
    `Coverage recovery ${value.status}`,
    `${count(value.recoveredCoverageCount)} coverages`,
    `${count(value.recoveredTermCount)} terms`,
    `${count(value.recoveredScheduleCount)} schedules`,
    `${count(value.recoveredFinancialFactCount)} financial facts`,
    `${count(value.citationRejectionCount)} rejected citations`,
  ].join("; ");
}

async function coverageRecoverySnapshot(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  forcedByOperator = false,
): Promise<NonNullable<PolicyExtractionState["coverageRecovery"]>> {
  if (forcedByOperator) return { enabled: true, forcedByOperator: true };
  const org = await ctx.runQuery(internal.orgs.getInternal, { id: orgId });
  return { enabled: isFeatureEnabled(org, "coverage_recovery_v2") };
}

type ExternalClaimResult = {
  policyId: string;
  leaseId: string;
  leaseExpiresAt: number;
  state: PolicyExtractionState;
  fileUrl: string;
  modelSettings?: {
    routes?: Record<string, { provider: string; model: string }>;
    routeSources?: Record<string, string>;
  };
} | null;

type ExternalPreviewClaimResult = {
  policyId: string;
  leaseId: string;
  leaseExpiresAt: number;
  state: PolicyExtractionState;
  fileUrl: string;
  modelSettings?: {
    routes?: Record<string, { provider: string; model: string }>;
    routeSources?: Record<string, string>;
  };
} | null;

type ExternalAckResult = {
  ok: boolean;
  leaseExpiresAt?: number;
};

type ExternalCompleteArgs = {
  policyId: string;
  leaseId: string;
  state: unknown;
  payloadStorageId?: string;
  document?: unknown;
  chunks?: unknown[];
  sourceSpans?: unknown[];
  sourceChunks?: unknown[];
  sourceTree?: unknown[];
  operationalProfile?: unknown;
  warnings?: string[];
  tokenUsage?: unknown;
  performanceReport?: unknown;
  protocolVersion?: "source-tree-v1" | "source-tree-v2";
  extractorVersion?: string;
  sections?: ExtractionCompletionManifest["sections"];
};

function readBoundedIntEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function nowMs(): number {
  return dayjs().valueOf();
}

async function startTraceSession(
  ctx: ActionCtx,
  args: {
    traceId: string;
    policyId: Id<"policies">;
    orgId: Id<"organizations">;
    userId?: Id<"users">;
    sourceKind: PolicyExtractionState["sourceKind"];
    trigger: string;
    fileName?: string;
  },
) {
  try {
    await ctx.runMutation(
      (internal as any).extractionTraces.startSession,
      args,
    );
  } catch {
    // Extraction telemetry must not block extraction.
  }
}

async function traceEvent(
  ctx: ActionCtx,
  traceId: string | undefined,
  event: {
    kind:
      | "session"
      | "phase"
      | "log"
      | "model_call"
      | "embedding_batch"
      | "worker"
      | "artifact";
    phase?: string;
    level?: string;
    message?: string;
    label?: string;
    task?: string;
    taskKind?: string;
    provider?: string;
    model?: string;
    routeSource?: string;
    transport?: string;
    attempt?: number;
    status?: string;
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    routerRequestId?: string;
    costUsd?: number | null;
    costStatus?: "priced" | "unpriced";
    routingDecision?: string;
    routing?: {
      decision: string;
      candidatesConsidered: Array<{ provider: string; model: string }>;
      policyVersion: string | null;
      cacheStickinessApplied: boolean;
      routeSource?: string;
      attemptCount?: number;
      shadowMode?: boolean;
      wouldHaveChosen?: { provider: string; model: string; decision: string };
      wouldHaveMatched?: boolean;
    };
    error?: string;
    details?: unknown;
  },
) {
  if (!traceId) return;
  try {
    await ctx.runMutation((internal as any).extractionTraces.recordEvent, {
      traceId,
      ...event,
    });
  } catch {
    // Extraction telemetry must not block extraction.
  }
}

async function completeTraceSession(
  ctx: ActionCtx,
  traceId: string | undefined,
  status: "complete" | "error" | "cancelled",
  error?: string,
) {
  if (!traceId) return;
  try {
    await ctx.runMutation((internal as any).extractionTraces.completeSession, {
      traceId,
      status,
      error,
    });
  } catch {
    // Extraction telemetry must not block extraction.
  }
}

function requireExtractionWorkerSecret(secret: string): void {
  const expected = process.env.EXTRACTION_WORKER_SECRET;
  if (!expected || secret !== expected) {
    throw new Error("Unauthorized extraction worker");
  }
}

function normalizeVersionSpec(value: string | undefined): string | undefined {
  return value?.trim().replace(/^[~^=v]+/, "");
}

function validateExternalWorkerCompatibility(args: {
  workerId?: string;
  workerVersion?: string;
  workerProtocolVersion?: string;
  clSdkVersion?: string;
}): string | undefined {
  const allowedProtocols =
    EXPECTED_EXTERNAL_WORKER_PROTOCOL_VERSION === "source-tree-v2"
      ? new Set(["source-tree-v2"])
      : new Set(["source-tree-v1", "source-tree-v2"]);
  if (
    EXPECTED_EXTERNAL_WORKER_PROTOCOL_VERSION &&
    (!args.workerProtocolVersion ||
      !allowedProtocols.has(args.workerProtocolVersion))
  ) {
    return [
      `External worker ${args.workerId ?? "unknown"} is incompatible`,
      `(protocol ${args.workerProtocolVersion ?? "missing"}; expected ${EXPECTED_EXTERNAL_WORKER_PROTOCOL_VERSION})`,
    ].join(" ");
  }
  if (EXPECTED_EXTERNAL_WORKER_CL_SDK_VERSION) {
    const expected = normalizeVersionSpec(
      EXPECTED_EXTERNAL_WORKER_CL_SDK_VERSION,
    );
    const actual = normalizeVersionSpec(args.clSdkVersion);
    if (actual !== expected) {
      return [
        `External worker ${args.workerId ?? "unknown"} has cl-sdk ${args.clSdkVersion ?? "missing"}`,
        `(expected ${EXPECTED_EXTERNAL_WORKER_CL_SDK_VERSION})`,
      ].join(" ");
    }
  }
  return undefined;
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function embedAndStoreBatch<T>({
  items,
  embedTexts,
  textForItem,
  storeItem,
  describeItem,
  logWarning,
  isCancelled,
}: {
  items: T[];
  embedTexts: EmbedTexts;
  textForItem: (item: T) => string;
  storeItem: (item: T, embedding: number[]) => Promise<void>;
  describeItem: (item: T) => string;
  logWarning: (message: string) => Promise<void>;
  isCancelled: () => Promise<boolean>;
}) {
  let embedded = 0;
  let failures = 0;

  const storeWithFailureTracking = async (item: T, embedding: number[]) => {
    try {
      await storeItem(item, embedding);
      embedded++;
    } catch (err) {
      if (isCancelledError(err)) throw err;
      failures++;
      await logWarning(
        `Warning: failed to store embedding for ${describeItem(item)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  for (const batch of chunkItems(items, EMBEDDING_BATCH_SIZE)) {
    if (await isCancelled()) {
      throw new Error(CANCELLED_BY_USER);
    }
    try {
      const embeddings = await embedTexts(batch.map(textForItem));
      await runBounded(batch, EMBEDDING_CONCURRENCY, async (item, index) => {
        if (await isCancelled()) {
          throw new Error(CANCELLED_BY_USER);
        }
        const embedding = embeddings[index];
        if (!embedding) {
          failures++;
          await logWarning(
            `Warning: embedding provider returned no vector for ${describeItem(item)}`,
          );
          return;
        }
        await storeWithFailureTracking(item, embedding);
      });
    } catch (err) {
      if (isCancelledError(err)) throw err;
      await logWarning(
        `Warning: failed to embed batch of ${batch.length}; retrying individually: ${err instanceof Error ? err.message : String(err)}`,
      );
      await runBounded(batch, EMBEDDING_CONCURRENCY, async (item) => {
        if (await isCancelled()) {
          throw new Error(CANCELLED_BY_USER);
        }
        try {
          const [embedding] = await embedTexts([textForItem(item)]);
          if (!embedding) {
            throw new Error("Embedding provider returned no vector");
          }
          await storeWithFailureTracking(item, embedding);
        } catch (retryErr) {
          if (isCancelledError(retryErr)) throw retryErr;
          failures++;
          await logWarning(
            `Warning: failed to embed ${describeItem(item)}: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
        }
      });
    }
  }

  return { embedded, failures };
}

async function isExtractionCancelled(
  ctx: ActionCtx,
  policyId: string,
): Promise<boolean> {
  const policy = await ctx.runQuery(internal.policies.getInternal, {
    id: policyId as Id<"policies">,
  });
  return policy?.pipelineError === CANCELLED_BY_USER;
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === CANCELLED_BY_USER;
}

async function externalLeaseMatches(
  ctx: ActionCtx,
  args: { policyId: string; leaseId: string; state?: unknown },
): Promise<boolean> {
  const job = (await ctx.runQuery(internal.policies.pipelineGetJob, {
    jobId: args.policyId,
  })) as {
    status?: string;
    checkpoint?: LeasedPolicyCheckpoint | null;
  } | null;
  const checkpoint = job?.checkpoint;
  if (
    job?.status !== "running" ||
    checkpoint?.nextPhase !== "extract" ||
    checkpoint.lease?.id !== args.leaseId
  ) {
    return false;
  }
  const claimedState = args.state as PolicyExtractionState | undefined;
  const currentState = checkpoint.state;
  if (
    claimedState?.traceId &&
    currentState.traceId &&
    claimedState.traceId !== currentState.traceId
  ) {
    return false;
  }
  return true;
}

async function loadPdfBytes(
  ctx: ActionCtx,
  fileId: string,
): Promise<Uint8Array | null> {
  const blob = await ctx.storage.get(fileId as Id<"_storage">);
  if (!blob) return null;
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function storeJsonArtifact(
  ctx: ActionCtx,
  jobId: string,
  kind:
    | "cl_sdk_checkpoint"
    | "embedding_payload"
    | "external_completion_payload"
    | "source_bundle"
    | "section_result",
  value: unknown,
  metadata?: {
    sourceFingerprint?: string;
    extractorVersion?: string;
    sectionId?: string;
    metadata?: unknown;
  },
): Promise<StoredArtifact> {
  const json = JSON.stringify(value);
  const byteLength = new TextEncoder().encode(json).byteLength;
  const startedAt = nowMs();
  const blob = new Blob([json], {
    type: "application/json",
  });
  const storageId = String(await ctx.storage.store(blob));
  const artifactId = String(
    await ctx.runMutation(internal.policies.pipelineSaveArtifact, {
      jobId,
      kind,
      storageId: storageId as Id<"_storage">,
      ...metadata,
    }),
  );
  return {
    artifactId,
    storageId,
    byteLength,
    durationMs: nowMs() - startedAt,
  };
}

async function loadJsonArtifact<T>(
  ctx: ActionCtx,
  storageId: string | undefined,
): Promise<T | undefined> {
  if (!storageId) return undefined;
  const blob = await ctx.storage.get(storageId as Id<"_storage">);
  if (!blob) return undefined;
  return JSON.parse(await blob.text()) as T;
}

async function getLatestArtifactStorageId(
  ctx: ActionCtx,
  jobId: string,
  kind:
    | "cl_sdk_checkpoint"
    | "embedding_payload"
    | "external_completion_payload"
    | "source_bundle"
    | "section_result",
): Promise<string | undefined> {
  const artifact = (await ctx.runQuery(internal.policies.pipelineGetArtifact, {
    jobId,
    kind,
  })) as { storageId?: string } | null;
  return artifact?.storageId ? String(artifact.storageId) : undefined;
}

async function persistEvidenceAndPromote(
  ctx: ActionCtx,
  args: {
    policyId: string;
    sourceSpans: SourceSpanLike[];
    sourceNodes: DocumentSourceNode[];
    fields: Record<string, unknown>;
    protocolVersion?: "source-tree-v1" | "source-tree-v2";
    extractorVersion?: string;
    sections?: ExtractionCompletionManifest["sections"];
  },
) {
  const extractorVersion =
    normalizeVersionSpec(args.extractorVersion) ??
    normalizeVersionSpec(EXPECTED_EXTERNAL_WORKER_CL_SDK_VERSION) ??
    "4.6.0";
  const ledger = buildPromotionEvidenceLedger({
    sourceSpans: args.sourceSpans,
    sourceTree: args.sourceNodes,
  });
  const protocolVersion = args.protocolVersion ?? "source-tree-v1";
  const sourceCoverageMap =
    protocolVersion === "source-tree-v2"
      ? buildPromotionSourceCoverageMap({
          sourceSpans: args.sourceSpans,
          sourceTree: args.sourceNodes,
        })
      : undefined;
  const manifest = buildExtractionCompletionManifest({
    protocolVersion,
    extractorVersion,
    ledger,
    sourceCoverageMap,
    sections: args.sections,
  });
  const promotionContext = (await ctx.runQuery(
    (internal as any).policies.pipelineGetPromotionContext,
    { jobId: args.policyId },
  )) as {
    runId: Id<"policyExtractionRuns">;
    leaseId: string;
    promotedAt?: number;
    promotionGateDecision?: {
      allowed: boolean;
      reasons: string[];
      mode: "shadow" | "enforce";
      sourceFingerprint?: string;
      evidenceLedgerHash?: string;
      manifestHash?: string;
    };
  } | null;
  if (!promotionContext) {
    throw new Error("Extraction promotion lost its current run or lease");
  }
  if (promotionContext.promotedAt) {
    const existing = promotionContext.promotionGateDecision;
    if (
      existing &&
      existing.sourceFingerprint === ledger.sourceFingerprint &&
      existing.evidenceLedgerHash === ledger.ledgerHash &&
      existing.manifestHash === manifest.manifestHash
    ) {
      return existing;
    }
    throw new Error(
      "Extraction run was already promoted with different evidence",
    );
  }
  const artifact = await storeJsonArtifact(
    ctx,
    args.policyId,
    "source_bundle",
    {
      sourceSpans: args.sourceSpans,
      sourceTree: args.sourceNodes,
      evidenceLedger: ledger,
      completionManifest: manifest,
    },
    {
      sourceFingerprint: ledger.sourceFingerprint,
      extractorVersion,
      metadata: {
        artifactRole: "promotion_evidence",
        evidenceLedgerHash: ledger.ledgerHash,
        manifestHash: manifest.manifestHash,
        protocolVersion: manifest.protocolVersion,
      },
    },
  );
  const result = (await ctx.runMutation(
    (internal as any).policies.promoteCompletedExtractionInternal,
    {
      id: args.policyId as Id<"policies">,
      runId: promotionContext.runId,
      leaseId: promotionContext.leaseId,
      sourceBundleArtifactId:
        artifact.artifactId as Id<"policyExtractionArtifacts">,
      fields: args.fields,
      evidenceLedger: ledger,
      completionManifest: manifest,
    },
  )) as {
    promoted: boolean;
    decision: {
      allowed: boolean;
      reasons: string[];
      mode: "shadow" | "enforce";
    };
  };
  if (!result.decision.allowed) {
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: args.policyId,
      timestamp: nowMs(),
      message: `Extraction promotion ${result.decision.mode === "enforce" ? "blocked" : "shadow violation"}: ${result.decision.reasons.join("; ")}`,
      phase: "extract",
      level: "warn",
    });
  }
  if (!result.promoted) {
    await ctx.runMutation(internal.policies.pipelineClearArtifacts, {
      jobId: args.policyId,
      kind: "external_completion_payload",
    });
    throw new Error(
      `Extraction promotion blocked: ${result.decision.reasons.join("; ")}`,
    );
  }
  return result.decision;
}

async function storeEmbeddingPayload(
  ctx: ActionCtx,
  jobId: string,
  payload: EmbeddingPayload,
): Promise<string> {
  return (await storeJsonArtifact(ctx, jobId, "embedding_payload", payload))
    .storageId;
}

async function loadExternalCompletionPayload(
  ctx: ActionCtx,
  storageId: string | undefined,
): Promise<ExternalCompletionPayload | undefined> {
  return await loadJsonArtifact<ExternalCompletionPayload>(ctx, storageId);
}

function asOptionalId<T extends string>(value: unknown): T | undefined {
  return typeof value === "string" && value.length > 0
    ? (value as T)
    : undefined;
}

async function loadEmbeddingPayload(
  ctx: ActionCtx,
  jobId: string,
  state: PolicyExtractionState,
): Promise<EmbeddingPayload> {
  if (
    state.documentChunksForEmbedding ||
    state.sourceSpansForStorage ||
    state.sourceChunksForEmbedding ||
    state.sourceNodesForStorage
  ) {
    return {
      documentChunksForEmbedding: state.documentChunksForEmbedding,
      sourceSpansForStorage: state.sourceSpansForStorage,
      sourceChunksForEmbedding: state.sourceChunksForEmbedding,
      sourceNodesForStorage: state.sourceNodesForStorage,
    };
  }
  const storageId =
    state.embeddingPayloadFileId ??
    (await getLatestArtifactStorageId(ctx, jobId, "embedding_payload"));
  return (await loadJsonArtifact<EmbeddingPayload>(ctx, storageId)) ?? {};
}

async function clearArtifacts(
  ctx: ActionCtx,
  jobId: string,
  kind?:
    | "cl_sdk_checkpoint"
    | "embedding_payload"
    | "external_completion_payload"
    | "source_bundle"
    | "section_result",
): Promise<void> {
  await ctx.runMutation(internal.policies.pipelineClearArtifacts, {
    jobId,
    ...(kind ? { kind } : {}),
  });
}

function stripLease(
  checkpoint: LeasedPolicyCheckpoint,
): Omit<LeasedPolicyCheckpoint, "lease"> {
  const { lease: _lease, ...rest } = checkpoint;
  return rest;
}

const extractionGateSchema = z.object({
  shouldExtract: z.boolean(),
  classification: z.enum([
    "bound_policy_document",
    "specimen_policy_document",
    "insurance_related_but_not_bound_policy",
    "non_insurance",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  detectedTitle: z.string().nullable(),
});

type ExtractionGateDecision = z.infer<typeof extractionGateSchema>;

const additionalInsuredEligibilityTermSchema = z.object({
  category: z.string(),
  condition: z.string(),
  summary: z.string(),
  sourceNodeIds: z.array(z.string()),
  sourceSpanIds: z.array(z.string()),
});

const scheduledAdditionalInsuredSchema = z.object({
  name: z.string(),
  scope: z.string(),
  endorsementTitle: z.string().nullable(),
  sourceNodeIds: z.array(z.string()),
  sourceSpanIds: z.array(z.string()),
});

const namedAdditionalInsuredSchema = z.object({
  name: z.string(),
  status: z.enum([
    "scheduled_by_endorsement",
    "automatic_class",
    "review_required",
  ]),
  scope: z.string(),
  endorsementTitle: z.string().nullable(),
  sourceNodeIds: z.array(z.string()),
  sourceSpanIds: z.array(z.string()),
});

const additionalInsuredEligibilitySchema = z.object({
  withoutEndorsement: z.array(additionalInsuredEligibilityTermSchema).max(12),
  requiresEndorsement: z.array(additionalInsuredEligibilityTermSchema).max(12),
  reviewRequired: z.array(additionalInsuredEligibilityTermSchema).max(8),
  scheduledAdditionalInsureds: z
    .array(scheduledAdditionalInsuredSchema)
    .max(40),
  additionalInsureds: z.array(namedAdditionalInsuredSchema).max(60),
  overallSummary: z.string(),
});

type AdditionalInsuredEligibility = z.infer<
  typeof additionalInsuredEligibilitySchema
>;

type OperationalProfileWithEligibility = PolicyOperationalProfile & {
  additionalInsuredEligibility?: AdditionalInsuredEligibility;
  additionalInsureds?: AdditionalInsuredEligibility["additionalInsureds"];
};

function additionalInsuredEligibilityExcerpt(
  sourceTree: DocumentSourceNode[],
): {
  text: string;
  count: number;
} {
  const candidateNodes = sourceTree
    .filter((node) => node.kind !== "document")
    .filter((node) => {
      const text = [
        node.kind,
        node.title,
        node.description,
        node.textExcerpt,
        node.path,
      ]
        .filter(Boolean)
        .join(" ");
      return /\b(additional insured|insured or subsidiary|subsidiar(?:y|ies)|scheduled additional insured|certificate holder|written contract|endorsement|endorse)\b/i.test(
        text,
      );
    })
    .sort((left, right) => left.order - right.order)
    .slice(0, 80)
    .map((node) => ({
      nodeId: node.id,
      kind: node.kind,
      page: node.pageStart,
      path: node.path,
      title: node.title,
      sourceSpanIds: node.sourceSpanIds,
      text: [node.description, node.textExcerpt]
        .filter(Boolean)
        .join(" ")
        .slice(0, 1200),
    }));
  return {
    text: JSON.stringify({ sourceNodes: candidateNodes }, null, 2).slice(
      0,
      22000,
    ),
    count: candidateNodes.length,
  };
}

function validateAdditionalInsuredEligibility(
  value: AdditionalInsuredEligibility,
  sourceTree: DocumentSourceNode[],
): AdditionalInsuredEligibility {
  const validNodeIds = new Set(sourceTree.map((node) => node.id));
  const spanIdsByNodeId = new Map(
    sourceTree.map((node) => [node.id, node.sourceSpanIds]),
  );
  const sourceBackedScheduledRequirement = () => {
    const node = sourceTree
      .filter((candidate) => candidate.kind !== "document")
      .find((candidate) => {
        const text = [
          candidate.title,
          candidate.description,
          candidate.textExcerpt,
          candidate.path,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          /\bscheduled additional insured\b/i.test(text) &&
          /\b(endorsement|endorsed|added by endorsement|subject to such endorsement)\b/i.test(
            text,
          )
        );
      });
    if (!node) return null;
    return {
      category: "Scheduled Additional Insureds",
      condition:
        "A person or company must be scheduled, named, added, or endorsed as a Scheduled Additional Insured before Spot treats them as already added.",
      summary:
        "Scheduled Additional Insured status requires endorsement-backed scheduling/naming in the policy evidence.",
      sourceNodeIds: [node.id],
      sourceSpanIds: node.sourceSpanIds,
    };
  };
  const normalizeEvidence = (
    sourceNodeIdsInput: string[],
    sourceSpanIdsInput: string[],
  ) => {
    const sourceNodeIds = [
      ...new Set(
        sourceNodeIdsInput.filter((nodeId) => validNodeIds.has(nodeId)),
      ),
    ];
    const sourceSpanIds = [
      ...new Set(
        [
          ...sourceSpanIdsInput,
          ...sourceNodeIds.flatMap(
            (nodeId) => spanIdsByNodeId.get(nodeId) ?? [],
          ),
        ].filter(
          (spanId): spanId is string =>
            typeof spanId === "string" && spanId.length > 0,
        ),
      ),
    ];
    return { sourceNodeIds, sourceSpanIds };
  };
  const cleanTerms = (
    terms: AdditionalInsuredEligibility["withoutEndorsement"],
  ) =>
    terms
      .map((term) => {
        const evidence = normalizeEvidence(
          term.sourceNodeIds,
          term.sourceSpanIds,
        );
        return {
          category: term.category.trim().slice(0, 120),
          condition: term.condition.trim().slice(0, 500),
          summary: term.summary.trim().slice(0, 800),
          sourceNodeIds: evidence.sourceNodeIds,
          sourceSpanIds: evidence.sourceSpanIds,
        };
      })
      .filter(
        (term) =>
          term.category &&
          term.summary &&
          (term.sourceNodeIds.length > 0 || term.sourceSpanIds.length > 0),
      );
  const cleanScheduled = (
    terms: AdditionalInsuredEligibility["scheduledAdditionalInsureds"],
  ) =>
    terms
      .map((term) => {
        const evidence = normalizeEvidence(
          term.sourceNodeIds,
          term.sourceSpanIds,
        );
        return {
          name: term.name.trim().slice(0, 180),
          scope: term.scope.trim().slice(0, 700),
          endorsementTitle: term.endorsementTitle?.trim().slice(0, 180) || null,
          sourceNodeIds: evidence.sourceNodeIds,
          sourceSpanIds: evidence.sourceSpanIds,
        };
      })
      .filter(
        (term) =>
          term.name &&
          (term.sourceNodeIds.length > 0 || term.sourceSpanIds.length > 0),
      );
  const cleanNamed = (
    terms: AdditionalInsuredEligibility["additionalInsureds"],
  ) =>
    terms
      .map((term) => {
        const evidence = normalizeEvidence(
          term.sourceNodeIds,
          term.sourceSpanIds,
        );
        return {
          name: term.name.trim().slice(0, 180),
          status: term.status,
          scope: term.scope.trim().slice(0, 700),
          endorsementTitle: term.endorsementTitle?.trim().slice(0, 180) || null,
          sourceNodeIds: evidence.sourceNodeIds,
          sourceSpanIds: evidence.sourceSpanIds,
        };
      })
      .filter(
        (term) =>
          term.name &&
          (term.sourceNodeIds.length > 0 || term.sourceSpanIds.length > 0),
      );
  const isEndorsementOnlyAdditionalInsured = (
    term: ReturnType<typeof cleanTerms>[number],
  ) => {
    const text = [term.category, term.condition, term.summary].join(" ");
    return (
      /\bscheduled additional insured\b/i.test(text) &&
      /\b(endorsement|endorsed|scheduled|named|added)\b/i.test(text)
    );
  };
  const automaticTerms = cleanTerms(value.withoutEndorsement);
  const movedEndorsementTerms = automaticTerms.filter(
    isEndorsementOnlyAdditionalInsured,
  );
  const withoutEndorsement = automaticTerms.filter(
    (term) => !isEndorsementOnlyAdditionalInsured(term),
  );
  const requiresEndorsement = [
    ...cleanTerms(value.requiresEndorsement),
    ...movedEndorsementTerms.map((term) => ({
      ...term,
      category: term.category || "Scheduled Additional Insureds",
      summary:
        term.summary ||
        "Scheduled Additional Insured status requires endorsement-backed scheduling/naming in the policy evidence.",
    })),
  ];
  const scheduledRequirement = sourceBackedScheduledRequirement();
  if (
    scheduledRequirement &&
    !requiresEndorsement.some((term) =>
      /\bscheduled additional insured/i.test(term.category),
    )
  ) {
    requiresEndorsement.push(scheduledRequirement);
  }
  return {
    withoutEndorsement,
    requiresEndorsement,
    reviewRequired: cleanTerms(value.reviewRequired ?? []),
    scheduledAdditionalInsureds: cleanScheduled(
      value.scheduledAdditionalInsureds ?? [],
    ),
    additionalInsureds: cleanNamed(value.additionalInsureds ?? []),
    overallSummary: value.overallSummary.trim().slice(0, 1200),
  };
}

async function extractAdditionalInsuredEligibility(params: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  traceId?: string;
  policyId: string;
  sourceTree: DocumentSourceNode[];
  profile: PolicyOperationalProfile;
  log?: (message: string, level?: PipelineLogLevel) => Promise<void>;
}): Promise<PolicyOperationalProfile> {
  const excerpt = additionalInsuredEligibilityExcerpt(params.sourceTree);
  if (excerpt.count === 0) {
    return params.profile;
  }
  const generateEligibilityObject = makeGenerateObject("extraction", {
    ctx: params.ctx,
    orgId: params.orgId,
    traceId: params.traceId,
    tracePolicyId: params.policyId,
  });
  try {
    const result = await generateEligibilityObject({
      schema: additionalInsuredEligibilitySchema,
      maxTokens: 2200,
      system: `You extract additional-insured certificate eligibility from insurance policy source nodes.

Rules:
- Separate classes that can be treated as additional insureds without a new endorsement from classes that require a scheduled/additional endorsement.
- "Without endorsement" means the policy wording itself automatically includes the class, usually subject to stated conditions.
- "Requires endorsement" means the class only qualifies when scheduled, named, added, or endorsed.
- If the policy only says "any Scheduled Additional Insured added by endorsement", that belongs under requiresEndorsement, not withoutEndorsement.
- Extract scheduledAdditionalInsureds when an endorsement, schedule, table, or form names a specific person/company as an additional insured.
- Extract additionalInsureds as a lookup list of named people/companies already identifiable from policy or endorsement evidence. Do not include generic classes like "subsidiary" unless a specific name is shown.
- Do not decide whether a specific certificate holder qualifies unless the wording identifies that class.
- Use only sourceNodeIds supplied in the evidence. Do not invent IDs.
- Keep categories short and operational, suitable for COI gating.`,
      prompt: `Extract additional insured eligibility from these source nodes.

Return:
- withoutEndorsement: each automatic class and its conditions.
- requiresEndorsement: each class or situation that needs a scheduled/named/additional endorsement.
- reviewRequired: ambiguous classes that need human review.
- scheduledAdditionalInsureds: specific people/companies already named or scheduled by endorsement as additional insureds.
- additionalInsureds: every specific named additional insured, with status scheduled_by_endorsement, automatic_class, or review_required.
- overallSummary: one concise sentence explaining certificate impact.

Evidence:
${excerpt.text}`,
    });
    const eligibility = validateAdditionalInsuredEligibility(
      result.object as AdditionalInsuredEligibility,
      params.sourceTree,
    );
    if (
      eligibility.withoutEndorsement.length === 0 &&
      eligibility.requiresEndorsement.length === 0 &&
      eligibility.reviewRequired.length === 0 &&
      eligibility.scheduledAdditionalInsureds.length === 0 &&
      eligibility.additionalInsureds.length === 0
    ) {
      return params.profile;
    }
    await params.log?.(
      `Additional insured eligibility extracted: ${eligibility.withoutEndorsement.length} automatic, ${eligibility.requiresEndorsement.length} endorsement-required, ${eligibility.scheduledAdditionalInsureds.length} scheduled, ${eligibility.additionalInsureds.length} named`,
      "info",
    );
    return {
      ...params.profile,
      additionalInsuredEligibility: eligibility,
      additionalInsureds: eligibility.additionalInsureds,
    } as OperationalProfileWithEligibility;
  } catch (error) {
    await params.log?.(
      `Additional insured eligibility extraction skipped: ${error instanceof Error ? error.message : String(error)}`,
      "warn",
    );
    return params.profile;
  }
}

function buildDocumentGateExcerpt(
  sourceSpans: Array<{
    pageStart?: number;
    text: string;
    metadata?: Record<string, unknown>;
  }>,
): string {
  const pageSpans = sourceSpans.filter(
    (span) => span.metadata?.sourceUnit !== "section_candidate",
  );
  const uniquePages = new Set<number>();
  const excerpts: string[] = [];

  for (const span of pageSpans) {
    const page =
      typeof span.pageStart === "number" ? span.pageStart : excerpts.length + 1;
    if (uniquePages.has(page)) continue;
    uniquePages.add(page);
    const text = span.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    excerpts.push(`Page ${page}: ${text.slice(0, 1200)}`);
    if (excerpts.join("\n\n").length >= 7000 || uniquePages.size >= 8) break;
  }

  return (
    excerpts.join("\n\n") ||
    "No machine-readable text was extracted from the PDF."
  );
}

async function classifyInsuranceExtractability(params: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  traceId?: string;
  policyId?: string;
  pdfBytes: Uint8Array;
  sourceSpans: Array<{
    pageStart?: number;
    text: string;
    metadata?: Record<string, unknown>;
  }>;
}): Promise<ExtractionGateDecision> {
  if (isSpecimenPolicyDocument(params.sourceSpans)) {
    return {
      shouldExtract: true,
      classification: "specimen_policy_document",
      confidence: 1,
      reason:
        "The PDF is explicitly labeled as a specimen policy and is allowed as a testing fixture.",
      detectedTitle: "Specimen policy",
    };
  }

  const generateGateObject = makeGenerateObject("classification", {
    ctx: params.ctx,
    orgId: params.orgId,
    traceId: params.traceId,
    tracePolicyId: params.policyId,
  });
  const excerpt = buildDocumentGateExcerpt(params.sourceSpans);
  const result = await generateGateObject({
    schema: extractionGateSchema,
    maxTokens: 600,
    system: `You are a strict intake gate for Spot post-binding insurance extraction.

Decide whether an uploaded PDF should be processed by a bound-policy extractor. Allow extraction when the document is clearly an already-bound insurance policy, binder, declarations page, renewal policy, insurance schedule, policy wording, endorsement, or post-binding supplement that contains bound policy terms.

Also allow a document explicitly labeled as a specimen policy, sample policy, or testing-only policy when it represents a policy artifact suitable for extraction testing. Return classification "specimen_policy_document" for those testing fixtures. A disclaimer such as "not an actual policy" or "not evidence of insurance" does not disqualify an otherwise valid specimen policy.

Reject unbound quotes, proposals, submissions, applications, marketing material, invoices, novels, books, textbooks, resumes, generic contracts, unrelated legal documents, and any document that is merely about insurance but is not itself a bound policy artifact. If uncertain, return classification "unknown" and shouldExtract false only when the document is more likely not extractable than extractable.`,
    prompt: `Classify this PDF before extraction.

Return shouldExtract=true for bound or post-binding insurance policy artifacts and for specimen policy testing fixtures.

Machine-readable excerpts:
${excerpt}`,
    providerOptions: {
      pdfBytes: params.pdfBytes,
      mimeType: "application/pdf",
    },
  });
  return result.object as ExtractionGateDecision;
}

function shouldRejectDocument(decision: ExtractionGateDecision): boolean {
  if (
    (decision.classification === "bound_policy_document" ||
      decision.classification === "specimen_policy_document") &&
    decision.shouldExtract
  ) {
    return false;
  }
  if (
    decision.classification === "non_insurance" &&
    decision.confidence >= 0.5
  ) {
    return true;
  }
  if (
    decision.classification === "insurance_related_but_not_bound_policy" &&
    decision.confidence >= 0.65
  ) {
    return true;
  }
  return !decision.shouldExtract && decision.confidence >= 0.7;
}

async function notifyExtractionReviewRequired(
  ctx: ActionCtx,
  args: {
    orgId: Id<"organizations">;
    policyId: string;
    policyNumber?: string;
    carrier?: string;
    questionCount: number;
  },
) {
  const label =
    args.policyNumber && args.policyNumber !== "Unknown"
      ? `policy ${args.policyNumber}`
      : args.carrier
        ? `${args.carrier} policy`
        : "a policy";
  await ctx.runMutation((internal as any).lib.notify.notifyInternal, {
    orgId: args.orgId,
    type: "incomplete_extraction",
    title: "Policy extraction needs review",
    body: `Spot finished extracting ${label}, but ${args.questionCount} coverage ${args.questionCount === 1 ? "term needs" : "terms need"} review.`,
    severity: "warning",
    actionType: "view_policy",
    actionPayload: { policyId: args.policyId, tab: "review" },
    sourceRef: { policyId: args.policyId, kind: "extraction_review" },
  });
}

async function advanceLeasedPhase(
  ctx: ActionCtx,
  jobId: string,
  phases: Phase<PolicyExtractionState>[],
): Promise<void> {
  const leaseId = randomUUID();
  const leaseExpiresAt = Date.now() + ADVANCE_LEASE_MS;
  const checkpoint = (await ctx.runMutation(
    internal.policies.pipelineAcquireLease,
    { jobId, leaseId, leaseExpiresAt },
  )) as LeasedPolicyCheckpoint | null;

  if (!checkpoint) {
    const reconciled = (await ctx.runMutation(
      (internal as any).policies.pipelineReconcileTerminalState,
      { jobId },
    )) as { terminal?: boolean } | null;
    if (reconciled?.terminal) {
      await ctx.runMutation(
        (internal as any).extractionTraces.reconcileTerminalPolicy,
        { policyId: jobId },
      );
    }
    return;
  }
  const traceId = checkpoint.state?.traceId;

  const scheduleWatchdog = async (expiresAt: number) => {
    await ctx.scheduler.runAfter(
      Math.max(0, expiresAt - Date.now() + ADVANCE_LEASE_WATCHDOG_GRACE_MS),
      internal.actions.policyExtraction.advance,
      { jobId },
    );
  };

  await scheduleWatchdog(leaseExpiresAt);

  const phase = phases.find((p) => p.name === checkpoint.nextPhase);
  if (!phase) {
    await ctx.runMutation(internal.policies.pipelineCompleteLease, {
      jobId,
      leaseId,
      status: "error",
      error: `Unknown phase: ${checkpoint.nextPhase}`,
      checkpoint: stripLease(checkpoint),
    });
    return;
  }

  let latestCheckpoint = stripLease(checkpoint);
  const saveState = async (state: PolicyExtractionState) => {
    const createdAt = Date.now();
    const ok = await ctx.runMutation(
      internal.policies.pipelineSaveStateForLease,
      {
        jobId,
        leaseId,
        nextPhase: phase.name,
        state,
        leaseExpiresAt: createdAt + ADVANCE_LEASE_MS,
      },
    );
    if (!ok) {
      throw new Error("Pipeline phase lease lost");
    }
    await scheduleWatchdog(createdAt + ADVANCE_LEASE_MS);
    latestCheckpoint = {
      nextPhase: phase.name,
      state,
      createdAt,
    };
  };

  const log = async (message: string, level: string = "info") => {
    const timestamp = Date.now();
    await ctx.runMutation(internal.policies.pipelineAppendLog, {
      jobId,
      timestamp,
      message,
      phase: phase.name,
      level,
    });
  };

  let heartbeatInFlight = false;
  let heartbeatPromise: Promise<void> | null = null;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight = true;
    heartbeatPromise = (async () => {
      try {
        const nextExpiresAt = Date.now() + ADVANCE_LEASE_MS;
        const ok = await ctx.runMutation(
          internal.policies.pipelineExtendLease,
          {
            jobId,
            leaseId,
            leaseExpiresAt: nextExpiresAt,
          },
        );
        if (ok) {
          await scheduleWatchdog(nextExpiresAt);
        }
      } catch {
        // The phase will fail its next checkpoint/complete call if the lease was lost.
      } finally {
        heartbeatInFlight = false;
      }
    })();
  }, ADVANCE_LEASE_HEARTBEAT_MS);

  try {
    const result = await phase.run({
      jobId,
      checkpoint: stripLease(checkpoint),
      log,
      saveState,
    });

    if (result.kind === "done") {
      await ctx.runMutation(internal.policies.pipelineCompleteLease, {
        jobId,
        leaseId,
        status: "complete",
        error: null,
        checkpoint: null,
      });
      await completeTraceSession(ctx, traceId, "complete");
      return;
    }

    if (result.kind === "error") {
      await ctx.runMutation(internal.policies.pipelineCompleteLease, {
        jobId,
        leaseId,
        status: "error",
        error: result.error,
        checkpoint: latestCheckpoint,
      });
      await completeTraceSession(
        ctx,
        traceId,
        result.error === CANCELLED_BY_USER ? "cancelled" : "error",
        result.error,
      );
      return;
    }

    const checkpointUpdated = await ctx.runMutation(
      internal.policies.pipelineCompleteLease,
      {
        jobId,
        leaseId,
        checkpoint: {
          nextPhase: result.nextPhase,
          state: result.state,
          createdAt: Date.now(),
        },
      },
    );
    if (checkpointUpdated) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.policyExtraction.advance,
        { jobId },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await log(`Phase "${phase.name}" threw: ${msg}`, "error");
    await ctx.runMutation(internal.policies.pipelineCompleteLease, {
      jobId,
      leaseId,
      status: "error",
      error: msg,
      checkpoint: latestCheckpoint,
    });
    await completeTraceSession(
      ctx,
      traceId,
      msg === CANCELLED_BY_USER ? "cancelled" : "error",
      msg,
    );
  } finally {
    clearInterval(heartbeat);
    if (heartbeatPromise) {
      await heartbeatPromise;
    }
  }
}

// ─── Convex mutations ref builder ──────────────────────────────────────────────

function makeMutations() {
  return {
    getJob: internal.policies.pipelineGetJob,
    setStatus: internal.policies.pipelineSetStatus,
    setCheckpoint: internal.policies.pipelineSetCheckpoint,
    appendLog: internal.policies.pipelineAppendLog,
    clearLog: internal.policies.pipelineClearLog,
  };
}

// ─── Phase factory ─────────────────────────────────────────────────────────────

export function makePhases(
  convexCtx: ActionCtx,
): Phase<PolicyExtractionState>[] {
  // ── Phase 1: load_pdf ─────────────────────────────────────────────────────────
  const loadPdfPhase: Phase<PolicyExtractionState> = {
    name: "load_pdf",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      if (await isExtractionCancelled(convexCtx, pCtx.jobId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      if (!state.fileId) {
        return { kind: "error", error: "load_pdf: missing fileId" };
      }
      await pCtx.log("Loading PDF from storage…");
      const pdfBytes = await loadPdfBytes(convexCtx, state.fileId);
      if (!pdfBytes)
        return { kind: "error", error: "File not found in storage" };
      await pCtx.log(`PDF ready for extraction (${pdfBytes.byteLength} bytes)`);
      return { kind: "next", nextPhase: "extract", state };
    },
  };

  // ── Phase 2: extract ──────────────────────────────────────────────────────────
  const extractPhase: Phase<PolicyExtractionState> = {
    name: "extract",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      if (await isExtractionCancelled(convexCtx, pCtx.jobId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      if (!state.fileId) {
        return {
          kind: "error",
          error: "extract: missing fileId — load_pdf phase must run first",
        };
      }

      await pCtx.log("Starting policy extraction…");

      const pdfBytes = await loadPdfBytes(convexCtx, state.fileId);
      if (!pdfBytes)
        return { kind: "error", error: "File not found in storage" };

      const policyId = pCtx.jobId;
      const pdfSource = await preparePdfTextWithParserFallback({
        pdfBytes,
        documentId: policyId,
        sourceKind: "policy_pdf",
      });
      if (pdfSource.sourceSpans.length > 0) {
        await pCtx.log(
          `Prepared ${pdfSource.sourceSpans.length} ${pdfSource.parserBackend} source spans for source-grounded extraction`,
        );
      }

      await pCtx.log("Checking whether the PDF is a bound policy document…");
      try {
        const gateDecision = await classifyInsuranceExtractability({
          ctx: convexCtx,
          orgId: state.orgId as Id<"organizations">,
          traceId: state.traceId,
          policyId,
          pdfBytes,
          sourceSpans: pdfSource.sourceSpans,
        });
        await pCtx.log(
          `Document gate: ${gateDecision.classification} (${Math.round(gateDecision.confidence * 100)}% confidence) — ${gateDecision.reason}`,
        );

        if (shouldRejectDocument(gateDecision)) {
          const rejectionSummary =
            `${NON_INSURANCE_DOCUMENT_ERROR} ${gateDecision.reason}`.slice(
              0,
              1000,
            );
          if (shouldArchiveRejectedPolicy(state.policyVersionKind)) {
            await convexCtx.runMutation(
              (internal as any).policies.updateExtractionInternal,
              {
                id: policyId,
                fields: {
                  carrier: "Non-insurance document",
                  policyNumber: "Not applicable",
                  linesOfBusiness: ["UN"],
                  insuredName: "Not applicable",
                  effectiveDate: "Not applicable",
                  expirationDate: "Not applicable",
                  summary: rejectionSummary,
                  excludeFromSearch: true,
                },
              },
            );

            if (state.fileId) {
              await convexCtx.runMutation(
                (internal as any).policies.updateFiles,
                {
                  id: policyId,
                  files: [
                    {
                      fileId: state.fileId as Id<"_storage">,
                      fileName: state.fileName || "upload.pdf",
                      fileType: "unknown",
                      status: "not_insurance",
                    },
                  ],
                  reconciliationStatus: "error" as const,
                },
              );
            }

            await convexCtx.runMutation(
              (internal as any).policies.archiveRejectedDocumentInternal,
              {
                id: policyId,
                userId: state.userId,
              },
            );
          }

          return { kind: "error", error: rejectionSummary };
        }
      } catch (error) {
        await pCtx.log(
          `Warning: document gate failed; continuing extraction (${error instanceof Error ? error.message : String(error)})`,
          "warn",
        );
      }

      const extractor = buildExtractor({
        ctx: convexCtx,
        orgId: state.orgId as Id<"organizations">,
        traceId: state.traceId,
        tracePolicyId: policyId,
        log: async (msg) => {
          await pCtx.log(msg);
        },
        onProgress: async (msg) => {
          await pCtx.log(msg);
        },
        shouldCancel: async () => isExtractionCancelled(convexCtx, policyId),
        pageScreenshots: pdfSource.pageScreenshots,
      });

      const extractOptions: ExtractOptions = {
        ...(pdfSource.sourceSpans.length > 0
          ? {
              sourceSpans: pdfSource.sourceSpans as Array<Record<string, any>>,
            }
          : {}),
        coverageRecovery: state.coverageRecovery ?? { enabled: false },
      };

      let result: ExtractionResult;
      try {
        result = await extractor.extract(pdfBytes, policyId, extractOptions);
      } catch (error) {
        if (isCancelledError(error)) {
          await pCtx.log("Extraction cancelled by user", "warn");
          return { kind: "error", error: CANCELLED_BY_USER };
        }
        throw error;
      }

      if (await isExtractionCancelled(convexCtx, pCtx.jobId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      const resultSourceSpans = Array.isArray((result as any).sourceSpans)
        ? ((result as any).sourceSpans as Array<Record<string, any>>)
        : [];
      const resultSourceChunks = Array.isArray((result as any).sourceChunks)
        ? ((result as any).sourceChunks as Array<Record<string, any>>)
        : [];
      const resultSourceTree = Array.isArray((result as any).sourceTree)
        ? ((result as any).sourceTree as Array<Record<string, any>>)
        : [];
      const sourceSpans =
        resultSourceSpans.length > 0
          ? resultSourceSpans
          : (pdfSource.sourceSpans as Array<Record<string, any>>);
      const canonicalSpans = canonicalSourceSpans(
        sourceSpans as SourceSpanLike[],
      );
      const sourceChunks =
        resultSourceChunks.length > 0
          ? resultSourceChunks
          : (pdfSource.sourceChunks as Array<Record<string, any>>);
      const chunks = result.chunks;
      const tokenUsage = result.tokenUsage;
      const coverageRecovery = result.coverageRecovery;

      await pCtx.log(
        `Extraction complete. Type: ${(result.document as Record<string, unknown>).type}. ${chunks.length} chunks, ${sourceSpans.length} source spans. Tokens: ${tokenUsage.inputTokens}in/${tokenUsage.outputTokens}out`,
      );
      if (result.performanceReport) {
        const totalSeconds = Math.round(
          result.performanceReport.totalModelCallDurationMs / 1000,
        );
        await pCtx.log(
          `Extraction model calls: ${result.performanceReport.modelCalls.length}; total model time: ${totalSeconds}s`,
        );
      }
      const recoveryLog = coverageRecoveryLogMessage(coverageRecovery);
      if (recoveryLog) await pCtx.log(recoveryLog);

      const processed = await postProcessExtractionDocument({
        ctx: convexCtx,
        orgId: state.orgId as Id<"organizations">,
        document: result.document as Record<string, unknown>,
        sourceSpans: canonicalSpans as Array<Record<string, any>>,
        traceId: state.traceId,
        policyId,
        skipDeterministicCoverageRecovery: coverageRecoverySucceeded(
          state,
          coverageRecovery,
        ),
        log: async (message, level) => {
          await pCtx.log(message, level);
        },
      });
      result.document = processed.document as typeof result.document;
      const doc = processed.document;
      const sourceNodes = normalizeSourceTree(
        resultSourceTree,
        canonicalSpans,
        policyId,
      );
      const normalizedOperationalProfile = normalizeOperationalProfile(
        (result as any).operationalProfile,
        sourceNodes,
        canonicalSpans,
      );
      const operationalProfile = await extractAdditionalInsuredEligibility({
        ctx: convexCtx,
        orgId: state.orgId as Id<"organizations">,
        traceId: state.traceId,
        policyId,
        sourceTree: sourceNodes,
        profile: normalizedOperationalProfile,
        log: async (message, level) => {
          await pCtx.log(message, level);
        },
      });
      const fields = processed.fields;
      const docName = doc.policyNumber || "policy";
      const resolvedFileName = state.fileName || `${String(docName)}.pdf`;
      const existingPolicy = (await convexCtx.runQuery(
        internal.policies.getInternal,
        {
          id: policyId as Id<"policies">,
        },
      )) as {
        linesOfBusiness?: string[];
        carrierIdentity?: unknown;
      } | null;
      const promotionState: PolicyExtractionState =
        state.policyVersionKind === "re_extraction" ||
        state.policyVersionKind === "renewal"
          ? { ...state, replacementPromotionStarted: true }
          : state;
      if (promotionState !== state) {
        await pCtx.saveState(promotionState);
      }

      const finalFields = {
        fileName: resolvedFileName,
        ...fields,
        ...sourceTreePolicyFields({
          sourceTree: sourceNodes,
          operationalProfile,
          sourceSpans: canonicalSpans,
          existingDocumentMetadata: doc.documentMetadata,
          existingDeclarations: doc.declarations,
          existingLinesOfBusiness: existingPolicy?.linesOfBusiness,
          existingPolicyFields: fieldsWithPersistedCarrierIdentity(
            fields,
            existingPolicy,
          ),
        }),
      };
      await persistEvidenceAndPromote(convexCtx, {
        policyId,
        sourceSpans: canonicalSpans,
        sourceNodes,
        fields: finalFields,
      });

      await convexCtx.runMutation((internal as any).policies.updateFiles, {
        id: policyId,
        files: [
          {
            fileId: state.fileId as Id<"_storage">,
            fileName: resolvedFileName,
            fileType: "unknown",
            status: "complete",
          },
        ],
        primaryFileId: state.fileId as Id<"_storage">,
      });

      const embeddingPayloadFileId = await storeEmbeddingPayload(
        convexCtx,
        policyId,
        {
          documentChunksForEmbedding: chunks,
          sourceSpansForStorage:
            canonicalSpans as PolicyExtractionState["sourceSpansForStorage"],
          sourceChunksForEmbedding:
            sourceChunks as PolicyExtractionState["sourceChunksForEmbedding"],
          sourceNodesForStorage: sourceNodes,
        },
      );
      const chunkIds = chunks.map((c: { id: string }) => c.id);
      const nextState: PolicyExtractionState = {
        ...promotionState,
        embeddingPayloadFileId,
        chunkIds,
        sourceSpanIds: canonicalSpans.map((span) => String(span.id)),
        sourceChunkIds: sourceChunks.map((chunk) => String(chunk.id)),
        operationalProfile,
        fileName: resolvedFileName,
      };

      return { kind: "next", nextPhase: "embed_and_store", state: nextState };
    },
  };

  // ── Phase 3: embed_and_store ──────────────────────────────────────────────────
  const embedAndStorePhase: Phase<PolicyExtractionState> = {
    name: "embed_and_store",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      const embeddingPayload = await loadEmbeddingPayload(
        convexCtx,
        policyId,
        state,
      );
      const chunks = embeddingPayload.documentChunksForEmbedding;
      const sourceSpans = embeddingPayload.sourceSpansForStorage;
      const sourceChunks = embeddingPayload.sourceChunksForEmbedding;
      const sourceNodes = embeddingPayload.sourceNodesForStorage;
      const embedTexts = makeEmbedTexts(
        convexCtx,
        state.orgId as Id<"organizations">,
        {
          maxParallelCalls: EMBEDDING_CONCURRENCY,
        },
      );
      const isCancelled = () => isExtractionCancelled(convexCtx, policyId);
      const logEmbedWarning = (message: string) => pCtx.log(message, "warn");

      if (!chunks || chunks.length === 0) {
        await pCtx.log(
          "No chunks to embed (phase resumed or no chunks extracted)",
        );
      } else {
        await pCtx.log(`Embedding ${chunks.length} chunks for vector search…`);
        await deletePolicyRowsInBatches(
          convexCtx,
          (internal as any).documentChunks.deleteByPolicy,
          policyId as Id<"policies">,
        );
        const embedStartedAt = nowMs();
        const { embedded, failures: embedFailures } = await embedAndStoreBatch({
          items: chunks,
          embedTexts,
          textForItem: (chunk) => chunk.text,
          describeItem: (chunk) => `chunk ${chunk.id}`,
          isCancelled,
          logWarning: logEmbedWarning,
          storeItem: async (chunk, embedding) => {
            await convexCtx.runMutation(
              (internal as any).documentChunks.insert,
              {
                orgId: state.orgId,
                policyId,
                chunkId: chunk.id,
                chunkType: chunk.type,
                text: chunk.text,
                metadata: chunk.metadata,
                embedding,
                createdAt: nowMs(),
              },
            );
          },
        });
        await traceEvent(convexCtx, state.traceId, {
          kind: "embedding_batch",
          label: "document chunks",
          task: "embeddings",
          provider: "openai",
          model: "text-embedding-3-small",
          status: embedFailures > 0 ? "partial" : "complete",
          durationMs: nowMs() - embedStartedAt,
          details: {
            requested: chunks.length,
            embedded,
            failures: embedFailures,
            batchSize: EMBEDDING_BATCH_SIZE,
          },
        });
        await pCtx.log(`Stored ${embedded}/${chunks.length} chunks`);
      }

      if (sourceSpans?.length || sourceChunks?.length || sourceNodes?.length) {
        await pCtx.log(
          `Storing ${sourceSpans?.length ?? 0} source spans, ${sourceNodes?.length ?? 0} source nodes, and ${sourceChunks?.length ?? 0} compatibility source chunks in batches of ${SOURCE_STORAGE_BATCH_SIZE}...`,
        );
        await deletePolicyRowsInBatches(
          convexCtx,
          (internal as any).sourceSpans.deleteByPolicy,
          policyId as Id<"policies">,
        );
        await deletePolicyRowsInBatches(
          convexCtx,
          (internal as any).sourceNodes.deleteByPolicy,
          policyId as Id<"policies">,
        );

        const spanRows = (sourceSpans ?? []).map((span) => {
          const table = span.table;
          return {
            orgId: state.orgId,
            policyId,
            spanId: span.id,
            documentId: span.documentId ?? policyId,
            sourceKind: sourceKindForStorage(span.sourceKind),
            pageStart: span.pageStart,
            pageEnd: span.pageEnd,
            sectionId: span.sectionId,
            formNumber: span.formNumber,
            sourceUnit: span.sourceUnit ?? span.metadata?.sourceUnit,
            parentSpanId:
              span.parentSpanId ??
              table?.rowSpanId ??
              table?.tableSpanId ??
              span.metadata?.parentSpanId ??
              span.metadata?.rowSpanId ??
              span.metadata?.tableSpanId,
            table,
            location: span.location,
            text: span.text,
            textHash: span.textHash ?? span.id,
            bbox: span.bbox,
            metadata: span.metadata,
            createdAt: nowMs(),
          };
        });
        for (const batch of chunkItems(spanRows, SOURCE_STORAGE_BATCH_SIZE)) {
          if (await isCancelled()) throw new Error(CANCELLED_BY_USER);
          await convexCtx.runMutation(
            (internal as any).sourceSpans.insertSpansBatch,
            { spans: batch },
          );
        }
        if (spanRows.length)
          await pCtx.log(
            `Stored ${spanRows.length}/${spanRows.length} source spans`,
          );

        if (sourceNodes?.length) {
          const nodeRows = sourceNodes.map((node) => ({
            orgId: state.orgId,
            policyId,
            nodeId: node.id,
            documentId: node.documentId || policyId,
            parentNodeId: node.parentId,
            kind: node.kind,
            title: node.title,
            description: node.description,
            textExcerpt: node.textExcerpt,
            sourceSpanIds: node.sourceSpanIds,
            pageStart: node.pageStart,
            pageEnd: node.pageEnd,
            bbox: node.bbox,
            order: node.order,
            path: node.path,
            metadata: node.metadata,
            createdAt: nowMs(),
          }));
          let storedSourceNodes = 0;
          for (const batch of chunkItems(nodeRows, SOURCE_STORAGE_BATCH_SIZE)) {
            if (await isCancelled()) throw new Error(CANCELLED_BY_USER);
            await convexCtx.runMutation(
              (internal as any).sourceNodes.insertNodesBatch,
              { nodes: batch },
            );
            storedSourceNodes += batch.length;
          }
          await pCtx.log(
            `Stored ${storedSourceNodes}/${sourceNodes.length} source nodes`,
          );
        }

        if (sourceChunks?.length) {
          const chunkRows = sourceChunks.map((chunk) => ({
            orgId: state.orgId,
            policyId,
            chunkId: chunk.id,
            documentId: chunk.documentId ?? policyId,
            sourceSpanIds: chunk.sourceSpanIds ?? [],
            text: chunk.text,
            metadata: chunk.metadata,
            createdAt: nowMs(),
          }));
          let storedSourceChunks = 0;
          for (const batch of chunkItems(
            chunkRows,
            SOURCE_STORAGE_BATCH_SIZE,
          )) {
            if (await isCancelled()) throw new Error(CANCELLED_BY_USER);
            await convexCtx.runMutation(
              (internal as any).sourceSpans.insertChunksBatch,
              { chunks: batch },
            );
            storedSourceChunks += batch.length;
          }
          await pCtx.log(
            `Stored ${storedSourceChunks}/${sourceChunks.length} source chunks`,
          );
        }
      }

      await clearArtifacts(convexCtx, policyId, "embedding_payload");
      await clearArtifacts(convexCtx, policyId, "cl_sdk_checkpoint");

      // Drop the raw chunks from state after durable storage.
      const {
        documentChunksForEmbedding: _dropped,
        sourceSpansForStorage: _droppedSpans,
        sourceChunksForEmbedding: _droppedSourceChunks,
        sourceNodesForStorage: _droppedSourceNodes,
        embeddingPayloadFileId: _droppedEmbeddingPayload,
        ...cleanState
      } = state;
      return { kind: "next", nextPhase: "post_process", state: cleanState };
    },
  };

  // ── Phase 4: post_process (terminal — persists enrichment and downstream work)
  const postProcessPhase: Phase<PolicyExtractionState> = {
    name: "post_process",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      // Record the document-event policy version after the current policy row has
      // been materialized and before downstream certificate workflows inspect it.
      let policyVersionId: Id<"policyVersions"> | undefined;
      try {
        if (
          state.policyVersionKind === "re_extraction" ||
          state.policyVersionKind === "renewal"
        ) {
          policyVersionId = await convexCtx.runMutation(
            (internal as any).policyVersions.createInternal,
            {
              policyId,
              versionKind: state.policyVersionKind,
              sourcePolicyFileIds: state.policyFileId
                ? [state.policyFileId as Id<"policyFiles">]
                : undefined,
              sourceFileIds: state.fileId
                ? [state.fileId as Id<"_storage">]
                : undefined,
              createdByUserId: state.userId as Id<"users">,
            },
          );
        } else {
          policyVersionId = await convexCtx.runMutation(
            (internal as any).policyVersions.ensureInitialInternal,
            {
              policyId,
              createdByUserId: state.userId as Id<"users">,
            },
          );
        }
      } catch (error) {
        console.warn(
          "[policyExtraction] policy version creation failed",
          error,
        );
      }

      if (state.policyVersionKind === "renewal" && policyVersionId) {
        try {
          await convexCtx.runMutation(
            (internal as any).certificateWorkflowJobs
              .createRenewalJobsForPolicyInternal,
            {
              orgId: state.orgId as Id<"organizations">,
              policyId,
              policyVersionId,
              createdByUserId: state.userId as Id<"users">,
            },
          );
        } catch (error) {
          console.warn(
            "[policyExtraction] renewal certificate job creation failed",
            error,
          );
        }
      }

      // Audit log
      try {
        await convexCtx.runMutation((internal as any).policyAuditLog.append, {
          policyId,
          userId: state.userId,
          orgId: state.orgId,
          action: "extraction_complete",
        });
      } catch {
        /* non-critical */
      }

      // Final policy enrichment and downstream work
      try {
        const finalPolicy = (await convexCtx.runQuery(
          internal.policies.getInternal,
          { id: policyId as any },
        )) as {
          uploadedByBrokerOrgId?: string;
          orgId?: string;
          uploadedBySide?: string;
          extractionReview?: unknown;
          policyNumber?: string;
          carrier?: string;
        } | null;
        let carrierDisplayName = finalPolicy?.carrier;
        if (finalPolicy?.orgId) {
          try {
            const carrierIdentity = (await convexCtx.runAction(
              internal.actions.enrichCarrierIdentity.ensureInternal,
              { policyId: policyId as Id<"policies"> },
            )) as { success: boolean };
            await pCtx.log(
              carrierIdentity.success
                ? "Stored carrier branding"
                : "Carrier branding unavailable",
              carrierIdentity.success ? "info" : "warn",
            );
            if (carrierIdentity.success) {
              const enrichedPolicy = await convexCtx.runQuery(
                internal.policies.getInternal,
                { id: policyId as Id<"policies"> },
              );
              carrierDisplayName =
                enrichedPolicy?.carrier ?? carrierDisplayName;
            }
          } catch (error) {
            console.warn("[policyExtraction] carrier branding failed", error);
            await pCtx.log("Carrier branding could not be stored", "warn");
          }
          await convexCtx.runMutation(
            (internal as any).declarationFacts.syncPolicyInternal,
            { policyId },
          );
          await convexCtx.runMutation(
            (internal as any).certificateHolders.populateForPolicyInternal,
            { policyId },
          );
          const reviewQuestions = openExtractionReviewQuestions(
            finalPolicy.extractionReview,
          );
          if (reviewQuestions.length > 0) {
            await notifyExtractionReviewRequired(convexCtx, {
              orgId: finalPolicy.orgId as Id<"organizations">,
              policyId,
              policyNumber: finalPolicy.policyNumber,
              carrier: carrierDisplayName,
              questionCount: reviewQuestions.length,
            });
            await pCtx.log(
              `Created extraction review notification for ${reviewQuestions.length} coverage ${reviewQuestions.length === 1 ? "term" : "terms"}`,
            );
          }
        }
      } catch {
        /* non-critical */
      }

      await pCtx.log("Post-processing complete");
      return { kind: "done" };
    },
  };

  const withTrace = (
    phase: Phase<PolicyExtractionState>,
  ): Phase<PolicyExtractionState> => ({
    ...phase,
    run: async (pCtx) => {
      const traceId = pCtx.checkpoint.state.traceId;
      const startedAt = nowMs();
      await traceEvent(convexCtx, traceId, {
        kind: "phase",
        phase: phase.name,
        label: phase.name,
        status: "started",
      });
      try {
        const result = await phase.run(pCtx);
        await traceEvent(convexCtx, traceId, {
          kind: "phase",
          phase: phase.name,
          label: phase.name,
          status: result.kind,
          durationMs: nowMs() - startedAt,
          error: result.kind === "error" ? result.error : undefined,
        });
        return result;
      } catch (error) {
        await traceEvent(convexCtx, traceId, {
          kind: "phase",
          phase: phase.name,
          label: phase.name,
          status: "error",
          durationMs: nowMs() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  return [loadPdfPhase, extractPhase, embedAndStorePhase, postProcessPhase].map(
    withTrace,
  );
}

// ─── advance internal action ───────────────────────────────────────────────────

export const advance = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const phases = makePhases(ctx);
    await advanceLeasedPhase(ctx, jobId, phases);
  },
});

export const sweepStale = internalAction({
  args: {
    olderThanMs: v.optional(v.number()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = (await ctx.runMutation(
      (internal as any).policies.pipelineRequeueStale,
      {
        olderThanMs: args.olderThanMs,
        batchSize: args.batchSize,
      },
    )) as {
      requeued: string[];
      markedError: string[];
      scanned: number;
    };
    if (result.requeued.length || result.markedError.length) {
      console.log(
        `Stale extraction sweep scanned ${result.scanned}; requeued ${result.requeued.length}; marked error ${result.markedError.length}`,
      );
    }
    const traces = (await ctx.runMutation(
      (internal as any).extractionTraces.reconcileTerminalRunningSessions,
      { batchSize: args.batchSize },
    )) as {
      scanned: number;
      closed: string[];
      closedPolicyIds: string[];
      skipped: string[];
    };
    for (const policyId of traces.closedPolicyIds) {
      await ctx.runMutation(
        (internal as any).policies.pipelineReconcileTerminalState,
        { jobId: policyId },
      );
    }
    if (traces.closed.length) {
      console.log(
        `Terminal trace reconciliation scanned ${traces.scanned}; closed ${traces.closed.length}`,
      );
    }
    return { ...result, traces };
  },
});

export const claimExternalJob = action({
  args: {
    secret: v.string(),
    workerId: v.optional(v.string()),
    workerVersion: v.optional(v.string()),
    workerProtocolVersion: v.optional(v.string()),
    clSdkVersion: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ExternalClaimResult> => {
    requireExtractionWorkerSecret(args.secret);
    const incompatibility = validateExternalWorkerCompatibility(args);
    if (incompatibility) {
      console.warn(incompatibility);
      return null;
    }
    const leaseId = `${args.workerId ?? "worker"}:${randomUUID()}`;
    const leaseExpiresAt = nowMs() + EXTERNAL_WORKER_LEASE_MS;
    const claimed = (await ctx.runMutation(
      (internal as any).policies.pipelineClaimExternalWorkerJob,
      { leaseId, leaseExpiresAt },
    )) as {
      policyId: string;
      checkpoint: {
        state: PolicyExtractionState;
      };
    } | null;

    if (!claimed) return null;
    const fileId = claimed.checkpoint.state.fileId;
    if (!fileId) {
      await ctx.runMutation((internal as any).policies.pipelineCompleteLease, {
        jobId: claimed.policyId,
        leaseId,
        status: "error",
        error: "External worker claimed job without fileId",
        checkpoint: null,
      });
      await completeTraceSession(
        ctx,
        claimed.checkpoint.state.traceId,
        "error",
        "External worker claimed job without fileId",
      );
      return null;
    }

    const fileUrl = await ctx.storage.getUrl(fileId as Id<"_storage">);
    if (!fileUrl) {
      await ctx.runMutation((internal as any).policies.pipelineCompleteLease, {
        jobId: claimed.policyId,
        leaseId,
        status: "error",
        error: "External worker could not resolve source file URL",
        checkpoint: null,
      });
      await completeTraceSession(
        ctx,
        claimed.checkpoint.state.traceId,
        "error",
        "External worker could not resolve source file URL",
      );
      return null;
    }
    await traceEvent(ctx, claimed.checkpoint.state.traceId, {
      kind: "worker",
      phase: "worker",
      label: "external worker claim",
      status: "claimed",
      message: `External worker claimed job${args.workerId ? ` (${args.workerId})` : ""}`,
      details: { workerId: args.workerId, leaseId },
    });

    let modelSettings:
      | {
          routes?: Record<string, { provider: string; model: string }>;
          routeSources?: Record<string, string>;
        }
      | undefined;
    try {
      modelSettings = (await ctx.runQuery(
        (internal as any).modelSettings.resolveForOrg,
        {
          orgId: claimed.checkpoint.state.orgId as Id<"organizations">,
        },
      )) as typeof modelSettings;
    } catch (error) {
      console.warn(
        `External worker model settings unavailable for ${claimed.policyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      policyId: claimed.policyId,
      leaseId,
      leaseExpiresAt,
      state: claimed.checkpoint.state,
      fileUrl,
      modelSettings,
    };
  },
});

export const claimExternalPreviewJob = action({
  args: {
    secret: v.string(),
    workerId: v.optional(v.string()),
    workerVersion: v.optional(v.string()),
    workerProtocolVersion: v.optional(v.string()),
    clSdkVersion: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ExternalPreviewClaimResult> => {
    requireExtractionWorkerSecret(args.secret);
    const incompatibility = validateExternalWorkerCompatibility(args);
    if (incompatibility) {
      console.warn(incompatibility);
      return null;
    }
    const leaseId = `${args.workerId ?? "worker"}:preview:${randomUUID()}`;
    const leaseExpiresAt = nowMs() + EXTERNAL_WORKER_LEASE_MS;
    const claimed = (await ctx.runMutation(
      (internal as any).policies.pipelineClaimExternalPreviewWorkerJob,
      { leaseId, leaseExpiresAt },
    )) as {
      policyId: string;
      checkpoint: {
        state: PolicyExtractionState;
      };
    } | null;

    if (!claimed) return null;
    const fileId = claimed.checkpoint.state.fileId;
    if (!fileId) {
      await ctx.runMutation(
        (internal as any).policies.pipelineCompletePreviewLease,
        {
          jobId: claimed.policyId,
          leaseId,
        },
      );
      return null;
    }

    const fileUrl = await ctx.storage.getUrl(fileId as Id<"_storage">);
    if (!fileUrl) {
      await ctx.runMutation(
        (internal as any).policies.pipelineCompletePreviewLease,
        {
          jobId: claimed.policyId,
          leaseId,
        },
      );
      return null;
    }
    await traceEvent(ctx, claimed.checkpoint.state.traceId, {
      kind: "worker",
      phase: "preview",
      label: "external worker preview claim",
      status: "claimed",
      message: `External worker claimed preview job${args.workerId ? ` (${args.workerId})` : ""}`,
      details: { workerId: args.workerId, leaseId },
    });

    let modelSettings:
      | {
          routes?: Record<string, { provider: string; model: string }>;
          routeSources?: Record<string, string>;
        }
      | undefined;
    try {
      modelSettings = (await ctx.runQuery(
        (internal as any).modelSettings.resolveForOrg,
        {
          orgId: claimed.checkpoint.state.orgId as Id<"organizations">,
        },
      )) as typeof modelSettings;
    } catch (error) {
      console.warn(
        `External worker preview model settings unavailable for ${claimed.policyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      policyId: claimed.policyId,
      leaseId,
      leaseExpiresAt,
      state: claimed.checkpoint.state,
      fileUrl,
      modelSettings,
    };
  },
});

export const heartbeatExternalJob = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    const leaseExpiresAt = nowMs() + EXTERNAL_WORKER_LEASE_MS;
    const ok = (await ctx.runMutation(
      (internal as any).policies.pipelineExtendLease,
      {
        jobId: args.policyId,
        leaseId: args.leaseId,
        leaseExpiresAt,
      },
    )) as boolean;
    return { ok, leaseExpiresAt };
  },
});

export const heartbeatExternalPreviewJob = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    const leaseExpiresAt = nowMs() + EXTERNAL_WORKER_LEASE_MS;
    const ok = (await ctx.runMutation(
      (internal as any).policies.pipelineExtendPreviewLease,
      {
        jobId: args.policyId,
        leaseId: args.leaseId,
        leaseExpiresAt,
      },
    )) as boolean;
    return { ok, leaseExpiresAt };
  },
});

export const logExternalJob = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    message: v.string(),
    phase: v.optional(v.string()),
    level: v.optional(
      v.union(v.literal("info"), v.literal("warn"), v.literal("error")),
    ),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    if (!(await externalLeaseMatches(ctx, args))) return { ok: false };
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: args.policyId,
      timestamp: nowMs(),
      message: args.message,
      phase: args.phase ?? "worker",
      level: args.level ?? "info",
    });
    return { ok: true };
  },
});

export const createExternalExtractionArtifactUploadUrl = action({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireExtractionWorkerSecret(args.secret);
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const finalizeExternalExtractionArtifact = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    kind: v.union(v.literal("source_bundle"), v.literal("section_result")),
    storageId: v.string(),
    sourceFingerprint: v.string(),
    extractorVersion: v.string(),
    sectionId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    { ok: false; artifactId?: undefined } | { ok: true; artifactId: string }
  > => {
    requireExtractionWorkerSecret(args.secret);
    if (!(await externalLeaseMatches(ctx, args))) return { ok: false };
    if (args.kind === "section_result" && !args.sectionId) {
      throw new Error("section_result artifacts require sectionId");
    }
    const artifactId: unknown = await ctx.runMutation(
      (internal as any).policies.pipelineSaveArtifact,
      {
        jobId: args.policyId,
        kind: args.kind,
        storageId: args.storageId as Id<"_storage">,
        sourceFingerprint: args.sourceFingerprint,
        extractorVersion: args.extractorVersion,
        sectionId: args.sectionId,
        metadata: args.metadata,
      },
    );
    return { ok: true, artifactId: String(artifactId) };
  },
});

export const getExternalExtractionResumeArtifacts = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
  },
  handler: async (ctx, args) => {
    requireExtractionWorkerSecret(args.secret);
    if (!(await externalLeaseMatches(ctx, args)))
      return { ok: false, artifacts: [] };
    const result = (await ctx.runQuery(
      (internal as any).policies.pipelineListResumableArtifacts,
      { jobId: args.policyId },
    )) as {
      runId: Id<"policyExtractionRuns">;
      artifacts: Array<{
        _id: Id<"policyExtractionArtifacts">;
        kind: "source_bundle" | "section_result";
        storageId: Id<"_storage">;
        sourceFingerprint?: string;
        extractorVersion?: string;
        sectionId?: string;
        metadata?: unknown;
      }>;
    } | null;
    if (!result) return { ok: true, artifacts: [] };
    const artifacts = await Promise.all(
      result.artifacts.map(async (artifact) => ({
        artifactId: String(artifact._id),
        kind: artifact.kind,
        url: await ctx.storage.getUrl(artifact.storageId),
        sourceFingerprint: artifact.sourceFingerprint,
        extractorVersion: artifact.extractorVersion,
        sectionId: artifact.sectionId,
        metadata: artifact.metadata,
      })),
    );
    return {
      ok: true,
      runId: String(result.runId),
      artifacts: artifacts.filter((artifact) => Boolean(artifact.url)),
    };
  },
});

export const recordExternalTraceEvent = action({
  args: {
    secret: v.string(),
    traceId: v.optional(v.string()),
    kind: v.union(
      v.literal("model_call"),
      v.literal("worker"),
      v.literal("phase"),
      v.literal("embedding_batch"),
      v.literal("artifact"),
    ),
    phase: v.optional(v.string()),
    label: v.optional(v.string()),
    task: v.optional(v.string()),
    taskKind: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    routeSource: v.optional(v.string()),
    transport: v.optional(v.string()),
    attempt: v.optional(v.number()),
    status: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    routerRequestId: v.optional(v.string()),
    costUsd: v.optional(v.union(v.number(), v.null())),
    costStatus: v.optional(v.union(v.literal("priced"), v.literal("unpriced"))),
    routingDecision: v.optional(v.string()),
    routing: v.optional(
      v.object({
        decision: v.string(),
        candidatesConsidered: v.array(
          v.object({ provider: v.string(), model: v.string() }),
        ),
        policyVersion: v.union(v.string(), v.null()),
        cacheStickinessApplied: v.boolean(),
        routeSource: v.optional(v.string()),
        attemptCount: v.optional(v.number()),
        shadowMode: v.optional(v.boolean()),
        wouldHaveChosen: v.optional(
          v.object({
            provider: v.string(),
            model: v.string(),
            decision: v.string(),
          }),
        ),
        wouldHaveMatched: v.optional(v.boolean()),
      }),
    ),
    error: v.optional(v.string()),
    details: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    await traceEvent(ctx, args.traceId, {
      kind: args.kind,
      phase: args.phase,
      label: args.label,
      task: args.task,
      taskKind: args.taskKind,
      provider: args.provider,
      model: args.model,
      routeSource: args.routeSource,
      transport: args.transport,
      attempt: args.attempt,
      status: args.status,
      durationMs: args.durationMs,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cachedInputTokens: args.cachedInputTokens,
      routerRequestId: args.routerRequestId,
      costUsd: args.costUsd,
      costStatus: args.costStatus,
      routingDecision: args.routingDecision,
      routing: args.routing,
      error: args.error,
      details: args.details,
    });
    return { ok: true };
  },
});

async function externalCompletionLeaseIsCurrent(
  ctx: ActionCtx,
  args: ExternalCompleteArgs,
): Promise<boolean> {
  return await externalLeaseMatches(ctx, args);
}

async function completeExternalExtractFromPayload(
  ctx: ActionCtx,
  args: ExternalCompleteArgs,
): Promise<ExternalAckResult> {
  if (!(await externalCompletionLeaseIsCurrent(ctx, args))) {
    return { ok: false };
  }
  const state = args.state as PolicyExtractionState;
  const policyId = args.policyId;
  const payload = args.payloadStorageId
    ? await loadExternalCompletionPayload(ctx, args.payloadStorageId)
    : undefined;
  if (args.payloadStorageId && !payload) {
    throw new Error(
      "External extraction completion payload artifact is missing",
    );
  }
  const document = payload?.document ?? args.document;
  const chunks = (payload?.chunks ?? args.chunks ?? []) as Array<{
    id?: string;
  }>;
  const sourceSpans = (payload?.sourceSpans ??
    args.sourceSpans ??
    []) as SourceSpanLike[];
  const canonicalSpans = canonicalSourceSpans(sourceSpans);
  const sourceChunks = (payload?.sourceChunks ??
    args.sourceChunks ??
    []) as Array<{ id?: unknown }>;
  const rawSourceTree = payload?.sourceTree ?? args.sourceTree ?? [];
  const operationalProfileInput =
    payload?.operationalProfile ?? args.operationalProfile;
  const coverageRecovery = payload?.coverageRecovery;
  const performanceReport = (payload?.performanceReport ??
    args.performanceReport) as
    | {
        modelCallCount?: number;
        modelCalls?: unknown[];
        totalModelCallDurationMs?: number;
      }
    | undefined;
  const protocolVersion = payload?.protocolVersion ?? args.protocolVersion;
  const extractorVersion = payload?.extractorVersion ?? args.extractorVersion;
  const rawSections = payload?.sections ?? args.sections;
  const sections = Array.isArray(rawSections)
    ? rawSections.flatMap((value): ExtractionCompletionManifest["sections"] => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return [];
        const section = value as Record<string, unknown>;
        const id = section.id ?? section.sectionId;
        if (
          id !== "extraction_policy_core" &&
          id !== "extraction_policy_coverage" &&
          id !== "extraction_coverage_cleanup"
        ) {
          return [];
        }
        const status = section.status;
        if (
          status !== "complete" &&
          status !== "not_applicable" &&
          status !== "degraded"
        ) {
          return [];
        }
        return [
          {
            id,
            status,
            sourceSpanIds: Array.isArray(section.sourceSpanIds)
              ? section.sourceSpanIds.filter(
                  (spanId): spanId is string => typeof spanId === "string",
                )
              : [],
            ...(typeof section.resultHash === "string" && section.resultHash
              ? { resultHash: section.resultHash }
              : {}),
          },
        ];
      })
    : undefined;
  let doc = document as Record<string, unknown>;
  if (!state.orgId || !state.userId) {
    throw new Error("External extraction completion missing orgId or userId");
  }

  await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
    jobId: policyId,
    timestamp: nowMs(),
    message: `External extraction complete. Type: ${String(doc.type ?? "policy")}. ${chunks.length} chunks, ${sourceSpans.length} source spans.`,
    phase: "extract",
    level: "info",
  });
  const traceCounters = (await ctx.runQuery(
    (internal as any).extractionTraces.getSessionCounters,
    {
      traceId: state.traceId,
    },
  )) as { modelCallCount?: number; modelDurationMs?: number } | null;
  const modelCallCount =
    traceCounters?.modelCallCount ||
    performanceReport?.modelCallCount ||
    performanceReport?.modelCalls?.length;
  if (modelCallCount) {
    const totalModelCallDurationMs =
      traceCounters?.modelDurationMs ??
      performanceReport?.totalModelCallDurationMs ??
      0;
    const totalSeconds = Math.round(totalModelCallDurationMs / 1000);
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: policyId,
      timestamp: nowMs(),
      message: `External extraction model calls: ${modelCallCount}; total model time: ${totalSeconds}s`,
      phase: "extract",
      level: "info",
    });
  }
  const recoveryLog = coverageRecoveryLogMessage(coverageRecovery);
  if (recoveryLog) {
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: policyId,
      timestamp: nowMs(),
      message: recoveryLog,
      phase: "extract",
      level: coverageRecoverySucceeded(state, coverageRecovery)
        ? "info"
        : "warn",
    });
  }
  const processed = await postProcessExtractionDocument({
    ctx,
    orgId: state.orgId as Id<"organizations">,
    document: doc,
    sourceSpans: canonicalSpans,
    traceId: state.traceId,
    policyId,
    runModelReview: false,
    skipDeterministicCoverageRecovery: coverageRecoverySucceeded(
      state,
      coverageRecovery,
    ),
    log: async (message, level = "info") => {
      await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
        jobId: policyId,
        timestamp: nowMs(),
        message,
        phase: "extract",
        level,
      });
    },
  });
  doc = processed.document;
  const sourceNodes = normalizeSourceTree(
    rawSourceTree,
    canonicalSpans,
    policyId,
  );
  const normalizedOperationalProfile = normalizeOperationalProfile(
    operationalProfileInput,
    sourceNodes,
    canonicalSpans,
  );
  const operationalProfile = normalizedOperationalProfile;
  const fields = processed.fields;
  if (processed.coverageReviewQuestionCount > 0) {
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: policyId,
      timestamp: nowMs(),
      message: `Extraction review has ${processed.coverageReviewQuestionCount} open question${processed.coverageReviewQuestionCount === 1 ? "" : "s"}`,
      phase: "extract",
      level: "warn",
    });
  }
  const docName = doc.policyNumber || "policy";
  const resolvedFileName = state.fileName || `${String(docName)}.pdf`;
  const existingPolicy = (await ctx.runQuery(internal.policies.getInternal, {
    id: policyId as Id<"policies">,
  })) as {
    linesOfBusiness?: string[];
    carrierIdentity?: unknown;
  } | null;
  const promotionState: PolicyExtractionState =
    state.policyVersionKind === "re_extraction" ||
    state.policyVersionKind === "renewal"
      ? { ...state, replacementPromotionStarted: true }
      : state;
  const promotionLeaseCurrent = (await ctx.runMutation(
    (internal as any).policies.pipelineSaveStateForLease,
    {
      jobId: policyId,
      leaseId: args.leaseId,
      nextPhase: "extract",
      state: promotionState,
      leaseExpiresAt: nowMs() + EXTERNAL_WORKER_LEASE_MS,
    },
  )) as boolean;
  if (!promotionLeaseCurrent) {
    return { ok: false };
  }

  const finalFields = {
    fileName: resolvedFileName,
    ...fields,
    ...sourceTreePolicyFields({
      sourceTree: sourceNodes,
      operationalProfile: normalizedOperationalProfile,
      sourceSpans: canonicalSpans,
      existingDocumentMetadata: doc.documentMetadata,
      existingDeclarations: doc.declarations,
      existingLinesOfBusiness: existingPolicy?.linesOfBusiness,
      existingPolicyFields: fieldsWithPersistedCarrierIdentity(
        fields,
        existingPolicy,
      ),
    }),
  };
  await persistEvidenceAndPromote(ctx, {
    policyId,
    sourceSpans: canonicalSpans,
    sourceNodes,
    fields: finalFields,
    protocolVersion,
    extractorVersion,
    sections,
  });

  if (state.fileId) {
    await ctx.runMutation((internal as any).policies.updateFiles, {
      id: policyId,
      files: [
        {
          fileId: state.fileId as Id<"_storage">,
          fileName: resolvedFileName,
          fileType: "unknown",
          status: "complete",
        },
      ],
      primaryFileId: state.fileId as Id<"_storage">,
    });
  }

  const embeddingPayloadFileId = await storeEmbeddingPayload(ctx, policyId, {
    documentChunksForEmbedding:
      chunks as PolicyExtractionState["documentChunksForEmbedding"],
    sourceSpansForStorage:
      canonicalSpans as PolicyExtractionState["sourceSpansForStorage"],
    sourceChunksForEmbedding:
      sourceChunks as PolicyExtractionState["sourceChunksForEmbedding"],
    sourceNodesForStorage: sourceNodes,
  });
  const nextState: PolicyExtractionState = {
    ...promotionState,
    embeddingPayloadFileId,
    chunkIds: chunks.map((chunk) => String(chunk.id)),
    sourceSpanIds: canonicalSpans.map((span) => String(span.id)),
    sourceChunkIds: sourceChunks.map((chunk) => String(chunk.id)),
    operationalProfile,
    fileName: resolvedFileName,
    externalWorker: undefined,
  };
  const checkpointUpdated = (await ctx.runMutation(
    (internal as any).policies.pipelineCompleteLease,
    {
      jobId: policyId,
      leaseId: args.leaseId,
      checkpoint: {
        nextPhase: "embed_and_store",
        state: nextState,
        createdAt: nowMs(),
      },
    },
  )) as boolean;
  if (checkpointUpdated) {
    await ctx.scheduler.runAfter(
      0,
      (internal as any).actions.policyExtraction.advance,
      { jobId: policyId },
    );
    await traceEvent(ctx, state.traceId, {
      kind: "phase",
      phase: "external_extract",
      label: "external_extract",
      status: "next",
      message: "External extraction handed off to embed_and_store",
    });
  }
  return { ok: checkpointUpdated };
}

export const completeExternalExtract = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    state: v.any(),
    payloadStorageId: v.optional(v.string()),
    document: v.optional(v.any()),
    chunks: v.optional(v.array(v.any())),
    sourceSpans: v.optional(v.array(v.any())),
    sourceChunks: v.optional(v.array(v.any())),
    sourceTree: v.optional(v.array(v.any())),
    operationalProfile: v.optional(v.any()),
    warnings: v.optional(v.array(v.string())),
    tokenUsage: v.optional(v.any()),
    performanceReport: v.optional(v.any()),
    protocolVersion: v.optional(
      v.union(v.literal("source-tree-v1"), v.literal("source-tree-v2")),
    ),
    extractorVersion: v.optional(v.string()),
    sections: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    return await completeExternalExtractFromPayload(ctx, args);
  },
});

export const completeExternalExtractFromStoredPayload = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    state: v.any(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<ExternalAckResult & { replayed?: boolean }> => {
    requireExtractionWorkerSecret(args.secret);
    const payloadStorageId = await getLatestArtifactStorageId(
      ctx,
      args.policyId,
      "external_completion_payload",
    );
    if (!payloadStorageId) return { ok: false, replayed: false };
    const result = await completeExternalExtractFromPayload(ctx, {
      policyId: args.policyId,
      leaseId: args.leaseId,
      state: args.state,
      payloadStorageId,
    });
    return { ...result, replayed: true };
  },
});

export const completeExternalPreview = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    state: v.any(),
    fields: v.any(),
    previewVersion: v.string(),
    previewModel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    const ok = (await ctx.runMutation(
      (internal as any).policies.pipelineCompletePreviewLease,
      {
        jobId: args.policyId,
        leaseId: args.leaseId,
      },
    )) as boolean;
    if (!ok) return { ok: false };

    const updated = (await ctx.runMutation(
      (internal as any).policies.updatePreviewExtractionInternal,
      {
        id: args.policyId as Id<"policies">,
        fields: args.fields,
        previewVersion: args.previewVersion,
        previewModel: args.previewModel,
      },
    )) as { updated: boolean; reason?: string };

    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: args.policyId,
      timestamp: nowMs(),
      message: updated.updated
        ? "Provisional policy extraction is ready"
        : `Provisional policy extraction skipped${updated.reason ? ` (${updated.reason})` : ""}`,
      phase: "preview",
      level: updated.updated ? "info" : "warn",
    });
    await traceEvent(
      ctx,
      (args.state as PolicyExtractionState | undefined)?.traceId,
      {
        kind: "phase",
        phase: "preview",
        label: "external_preview_extract",
        status: updated.updated ? "complete" : "skipped",
        message: updated.updated
          ? "External preview extraction completed"
          : `External preview extraction skipped${updated.reason ? ` (${updated.reason})` : ""}`,
        details: {
          previewVersion: args.previewVersion,
          previewModel: args.previewModel,
          updated,
        },
      },
    );
    return { ok: true };
  },
});

export const failExternalPreviewJob = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    state: v.optional(v.any()),
    error: v.string(),
    previewVersion: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ExternalAckResult> => {
    requireExtractionWorkerSecret(args.secret);
    const ok = (await ctx.runMutation(
      (internal as any).policies.pipelineCompletePreviewLease,
      {
        jobId: args.policyId,
        leaseId: args.leaseId,
      },
    )) as boolean;
    if (!ok) return { ok: false };
    await ctx.runMutation(
      (internal as any).policies.failPreviewExtractionInternal,
      {
        id: args.policyId as Id<"policies">,
        error: args.error,
        previewVersion: args.previewVersion,
      },
    );
    await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
      jobId: args.policyId,
      timestamp: nowMs(),
      message: `Provisional policy extraction failed: ${args.error}`,
      phase: "preview",
      level: "warn",
    });
    await traceEvent(
      ctx,
      (args.state as PolicyExtractionState | undefined)?.traceId,
      {
        kind: "phase",
        phase: "preview",
        label: "external_preview_extract",
        status: "error",
        message: args.error,
        details: { previewVersion: args.previewVersion },
      },
    );
    return { ok: true };
  },
});

export const failExternalJob = action({
  args: {
    secret: v.string(),
    policyId: v.string(),
    leaseId: v.string(),
    state: v.optional(v.any()),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    requireExtractionWorkerSecret(args.secret);
    if (!(await externalLeaseMatches(ctx, args))) return { ok: false };
    const checkpoint = args.state
      ? {
          nextPhase: "extract",
          state: args.state,
          createdAt: nowMs(),
        }
      : null;
    const hasReplayableCompletionPayload =
      args.error !== CANCELLED_BY_USER
        ? Boolean(
            await getLatestArtifactStorageId(
              ctx,
              args.policyId,
              "external_completion_payload",
            ),
          )
        : false;
    if (checkpoint && hasReplayableCompletionPayload) {
      // Keep the same extraction run recoverable so the next worker claim can
      // replay the stored completion payload instead of recomputing models.
      const ok = (await ctx.runMutation(
        (internal as any).policies.pipelineCompleteLease,
        {
          jobId: args.policyId,
          leaseId: args.leaseId,
          status: "running",
          error: args.error,
          checkpoint,
        },
      )) as boolean;
      if (ok) {
        await ctx.runMutation((internal as any).policies.pipelineAppendLog, {
          jobId: args.policyId,
          timestamp: nowMs(),
          message: `External extraction failed after saving completion payload; next worker claim will replay stored payload: ${args.error}`,
          phase: "worker",
          level: "warn",
        });
      }
      return { ok, replayable: ok };
    }
    const ok = (await ctx.runMutation(
      (internal as any).policies.pipelineCompleteLease,
      {
        jobId: args.policyId,
        leaseId: args.leaseId,
        status: "error",
        error: args.error,
        checkpoint,
      },
    )) as boolean;
    if (!ok) return { ok: false };
    await completeTraceSession(
      ctx,
      (args.state as PolicyExtractionState | undefined)?.traceId,
      args.error === CANCELLED_BY_USER ? "cancelled" : "error",
      args.error,
    );
    return { ok: true };
  },
});

export const ensurePolicyV3SourceTree = internalAction({
  args: {
    policyId: v.id("policies"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const policy = (await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    })) as {
      fileId?: Id<"_storage">;
      sourceTreeVersion?: string;
      sourceTreeStatus?: string;
      pipelineStatus?: string;
    } | null;
    if (!policy) throw new Error("Policy not found");

    const hasSourceNodes = (await ctx
      .runQuery((internal as any).sourceNodes.hasNodesForPolicy, {
        policyId: args.policyId,
      })
      .catch(() => false)) as boolean;
    if (
      policy.sourceTreeVersion === "v3" &&
      policy.sourceTreeStatus === "ready" &&
      hasSourceNodes
    ) {
      return { status: "ready" as const };
    }
    if (
      policy.pipelineStatus === "running" ||
      policy.sourceTreeStatus === "running" ||
      policy.sourceTreeStatus === "queued"
    ) {
      return { status: "running" as const };
    }
    if (!policy.fileId) {
      await ctx.runMutation(
        (internal as any).policies.updateExtractionInternal,
        {
          id: args.policyId,
          fields: {
            sourceTreeStatus: "failed",
            sourceTreeError:
              "Policy source file is missing; cannot rebuild source tree.",
            sourceTreeUpdatedAt: nowMs(),
          },
        },
      );
      return {
        status: "failed" as const,
        error: "Policy source file is missing",
      };
    }

    await ctx.runMutation((internal as any).policies.updateExtractionInternal, {
      id: args.policyId,
      fields: {
        sourceTreeVersion: "v3",
        sourceTreeStatus: "queued",
        sourceTreeError: undefined,
        sourceTreeUpdatedAt: nowMs(),
      },
    });
    await ctx.scheduler.runAfter(
      0,
      (internal as any).actions.policyExtraction.retryPolicyExtraction,
      {
        policyId: args.policyId,
        mode: "full",
      },
    );
    return { status: "queued" as const, reason: args.reason };
  },
});

export const backfillStoredCoverageRecovery = internalAction({
  args: {
    policyId: v.id("policies"),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const policy = (await ctx.runQuery(internal.policies.getInternal, {
      id: args.policyId,
    })) as
      | (Record<string, unknown> & {
          orgId?: Id<"organizations">;
          operationalProfile?: unknown;
        })
      | null;
    if (!policy) throw new Error("Policy not found");
    if (!policy.orgId) throw new Error("Policy is missing orgId");

    const snapshot = await coverageRecoverySnapshot(
      ctx,
      policy.orgId,
      args.force === true,
    );
    if (!snapshot.enabled) {
      return { ok: false as const, status: "disabled" as const };
    }

    const [spanDocs, nodeDocs] = await Promise.all([
      ctx.runQuery((internal as any).sourceSpans.listSpansByPolicyInternal, {
        policyId: args.policyId,
      }) as Promise<Array<Record<string, any>>>,
      ctx.runQuery((internal as any).sourceNodes.listByPolicyInternal, {
        policyId: args.policyId,
      }) as Promise<Array<Record<string, any>>>,
    ]);
    if (spanDocs.length === 0) {
      throw new Error("Policy is missing stored source spans");
    }

    const sourceSpans = canonicalSourceSpans(
      spanDocs.map((span) =>
        sourceSpanLikeFromStoredSource(span, args.policyId),
      ),
    );
    const storedSourceTree = nodeDocs
      .map((node) => sourceNodeFromStoredSource(node, args.policyId))
      .filter(
        (
          node,
        ): node is NonNullable<ReturnType<typeof sourceNodeFromStoredSource>> =>
          Boolean(node),
      );
    const sourceTree = normalizeSourceTree(
      storedSourceTree,
      sourceSpans,
      args.policyId,
    );
    const sdkSourceSpans = sourceSpansForSdk(sourceSpans, args.policyId);
    const primaryProfile = normalizeOperationalProfile(
      policy.operationalProfile,
      sourceTree,
      sourceSpans,
    );

    const recovery = await runCoverageRecovery({
      sourceTree,
      sourceSpans: sdkSourceSpans,
      operationalProfile: primaryProfile,
      generateObject: makeGenerateObject("extraction_coverage_recovery", {
        ctx,
        orgId: policy.orgId,
        tracePolicyId: args.policyId,
      }),
      modelCapabilities: modelCapabilitiesForTask(
        "extraction_coverage_recovery",
      ),
    });
    if (recovery.diagnostics.status !== "succeeded") {
      return {
        ok: false as const,
        status: "failed" as const,
        diagnostics: recovery.diagnostics,
      };
    }

    const operationalProfile = normalizeOperationalProfile(
      recovery.operationalProfile,
      sourceTree,
      sourceSpans,
    );
    const recoveredFields = operationalProfilePolicyFields(
      operationalProfile,
      policy,
    );
    const recoveryProjection = Object.fromEntries(
      [
        "operationalProfile",
        "coverages",
        "coverageSchedules",
        "premium",
        "premiumAmount",
        "premiumBreakdown",
        "taxesAndFees",
        "totalCost",
        "totalCostAmount",
        "linesOfBusiness",
      ].flatMap((key) =>
        Object.prototype.hasOwnProperty.call(recoveredFields, key)
          ? [[key, recoveredFields[key]]]
          : [],
      ),
    );

    await ctx.runMutation((internal as any).policies.updateExtractionInternal, {
      id: args.policyId,
      fields: recoveryProjection,
    });
    return {
      ok: true as const,
      status: "complete" as const,
      forced: snapshot.forcedByOperator === true,
      diagnostics: recovery.diagnostics,
      sourceSpanCount: sourceSpans.length,
      sourceNodeCount: sourceTree.length,
    };
  },
});

// ─── Entry point: start from upload ───────────────────────────────────────────

/**
 * Mirrors the in-Convex extract-phase document gate for external worker mode,
 * where the worker never runs `classifyInsuranceExtractability`. Runs before the
 * job is handed to the external queue so non-policy documents are rejected with
 * a user-facing error instead of completing as empty "Unknown" policies.
 * Returns true when the document was rejected and the handoff must not happen.
 */
async function rejectedByDocumentGateBeforeExternalHandoff(
  ctx: ActionCtx,
  params: {
    policyId: string;
    state: {
      fileId?: string;
      fileName?: string;
      orgId?: string;
      userId?: string;
      traceId?: string;
      policyVersionKind?: PolicyExtractionState["policyVersionKind"];
    };
  },
): Promise<boolean> {
  const { fileId, fileName, orgId, userId, traceId } = params.state;
  if (!fileId || !orgId) return false;
  let gateDecision: ExtractionGateDecision;
  try {
    const pdfBytes = await loadPdfBytes(ctx, fileId);
    if (!pdfBytes) return false;
    const converted = await tryConvertPdfWithLiteParse({
      pdfBytes,
      documentId: params.policyId,
      sourceKind: "policy_pdf",
    });
    const sourceSpans = converted?.sourceSpans?.length
      ? converted.sourceSpans
      : (
          await preparePdfTextWithPdfJs({
            pdfBytes,
            documentId: params.policyId,
            sourceKind: "policy_pdf",
          })
        ).sourceSpans;
    gateDecision = await classifyInsuranceExtractability({
      ctx,
      orgId: orgId as Id<"organizations">,
      traceId,
      policyId: params.policyId,
      pdfBytes,
      sourceSpans,
    });
  } catch (error) {
    // Gate parity with the in-Convex path: never block extraction on gate
    // infrastructure failures.
    await traceEvent(ctx, traceId, {
      kind: "log",
      phase: "gate",
      level: "warn",
      message: `Document gate failed; continuing extraction (${error instanceof Error ? error.message : String(error)})`,
    });
    return false;
  }
  await traceEvent(ctx, traceId, {
    kind: "log",
    phase: "gate",
    message: `Document gate: ${gateDecision.classification} (${Math.round(gateDecision.confidence * 100)}% confidence) — ${gateDecision.reason}`,
  });
  if (!shouldRejectDocument(gateDecision)) return false;

  const rejectionSummary =
    `${NON_INSURANCE_DOCUMENT_ERROR} ${gateDecision.reason}`.slice(0, 1000);
  const archivePolicy = shouldArchiveRejectedPolicy(
    params.state.policyVersionKind,
  );
  if (archivePolicy) {
    await ctx.runMutation((internal as any).policies.updateExtractionInternal, {
      id: params.policyId,
      fields: {
        carrier: "Non-insurance document",
        policyNumber: "Not applicable",
        linesOfBusiness: ["UN"],
        insuredName: "Not applicable",
        effectiveDate: "Not applicable",
        expirationDate: "Not applicable",
        summary: rejectionSummary,
        excludeFromSearch: true,
      },
    });
    await ctx.runMutation((internal as any).policies.updateFiles, {
      id: params.policyId,
      files: [
        {
          fileId: fileId as Id<"_storage">,
          fileName: fileName || "upload.pdf",
          fileType: "unknown",
          status: "not_insurance",
        },
      ],
      reconciliationStatus: "error" as const,
    });
  }
  await ctx.runMutation((internal as any).policies.pipelineRejectExternalJob, {
    jobId: params.policyId,
    error: rejectionSummary,
    userId,
    archivePolicy,
    state: archivePolicy ? undefined : params.state,
  });
  await completeTraceSession(ctx, traceId, "error", rejectionSummary);
  return true;
}

export const startPolicyExtractionFromUpload = internalAction({
  args: {
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    policyFileId: v.optional(v.id("policyFiles")),
    policyVersionKind: v.optional(
      v.union(
        v.literal("new_policy"),
        v.literal("re_extraction"),
        v.literal("renewal"),
      ),
    ),
  },
  handler: async (
    ctx,
    {
      policyId,
      fileId,
      fileName,
      orgId,
      userId,
      policyFileId,
      policyVersionKind,
    },
  ) => {
    const coverageRecovery = await coverageRecoverySnapshot(ctx, orgId);
    const traceId = randomUUID();
    await startTraceSession(ctx, {
      traceId,
      policyId,
      orgId,
      userId,
      sourceKind: "upload",
      trigger: "upload",
      fileName,
    });
    if (EXTERNAL_WORKER_MODE) {
      const externalState = {
        sourceKind: "upload",
        fileId: String(fileId),
        fileName,
        orgId: String(orgId),
        userId: String(userId),
        policyFileId: policyFileId ? String(policyFileId) : undefined,
        policyVersionKind,
        replacementPromotionStarted:
          policyVersionKind === "re_extraction" ||
          policyVersionKind === "renewal"
            ? false
            : undefined,
        coverageRecovery,
        traceId,
      };
      if (
        await rejectedByDocumentGateBeforeExternalHandoff(ctx, {
          policyId: String(policyId),
          state: externalState,
        })
      ) {
        return;
      }
      await ctx.runMutation(internal.policies.pipelineClearLog, {
        jobId: String(policyId),
      });
      await clearArtifacts(ctx, String(policyId));
      await ctx.runMutation(
        (internal as any).policies.pipelineStartExternalWorkerJob,
        {
          jobId: String(policyId),
          state: externalState,
        },
      );
      return;
    }

    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<PolicyExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.policyExtraction.advance,
    });
    await ctx.runMutation(internal.policies.pipelineClearLog, {
      jobId: String(policyId),
    });
    await clearArtifacts(ctx, String(policyId));
    const phases = makePhases(ctx);
    await runPipeline<PolicyExtractionState>({
      jobId: String(policyId),
      phases,
      storage,
      scheduler,
      initialState: {
        sourceKind: "upload",
        fileId: String(fileId),
        fileName,
        orgId: String(orgId),
        userId: String(userId),
        policyFileId: policyFileId ? String(policyFileId) : undefined,
        policyVersionKind,
        replacementPromotionStarted:
          policyVersionKind === "re_extraction" ||
          policyVersionKind === "renewal"
            ? false
            : undefined,
        coverageRecovery,
        traceId,
      },
    });
  },
});

// ─── Entry point: retry ────────────────────────────────────────────────────────

export function policyExtractionRetrySource(params: {
  mode: "resume" | "restart" | "full";
  policy: {
    orgId?: string;
    userId?: string;
    uploadedByUserId?: string;
    fileId?: string;
    fileName?: string;
  };
  existingState?: PolicyExtractionState;
}): Pick<
  PolicyExtractionState,
  | "sourceKind"
  | "fileId"
  | "fileName"
  | "orgId"
  | "userId"
  | "policyFileId"
  | "policyVersionKind"
  | "replacementPromotionStarted"
> {
  const retryState = params.mode === "full" ? undefined : params.existingState;
  return {
    sourceKind: retryState?.sourceKind ?? "upload",
    fileId: retryState?.fileId ?? params.policy.fileId,
    fileName: retryState?.fileName ?? params.policy.fileName,
    orgId: retryState?.orgId ?? String(params.policy.orgId ?? ""),
    userId:
      retryState?.userId ??
      String(params.policy.userId ?? params.policy.uploadedByUserId ?? ""),
    policyFileId: retryState?.policyFileId,
    policyVersionKind:
      params.mode === "full" ? "re_extraction" : retryState?.policyVersionKind,
    replacementPromotionStarted:
      params.mode === "full" ? false : retryState?.replacementPromotionStarted,
  };
}

export const retryPolicyExtraction = internalAction({
  args: {
    policyId: v.id("policies"),
    mode: v.union(v.literal("resume"), v.literal("restart"), v.literal("full")),
  },
  handler: async (ctx, { policyId, mode }) => {
    const mutations = makeMutations();
    const storage = createConvexStorageAdapter<PolicyExtractionState>({
      ctx: ctx as any,
      mutations,
    });
    const scheduler = createConvexSchedulerAdapter({
      ctx: ctx as any,
      advanceAction: internal.actions.policyExtraction.advance,
    });

    if (mode === "full") {
      await ctx.runMutation(internal.policies.pipelineClearLog, {
        jobId: String(policyId),
      });
      await clearArtifacts(ctx, String(policyId));
    }

    // Fetch policy to recover initial state for "full" restart
    const policy = (await ctx.runQuery(internal.policies.getInternal, {
      id: policyId,
    })) as {
      orgId?: string;
      userId?: string;
      uploadedByUserId?: string;
      fileId?: string;
      fileName?: string;
      pipelineCheckpoint?: { state?: PolicyExtractionState };
    } | null;
    if (!policy) throw new Error("Policy not found");

    const existingState = policy.pipelineCheckpoint?.state;
    const retrySource = policyExtractionRetrySource({
      mode,
      policy,
      existingState,
    });
    if (!policy.orgId) throw new Error("Policy is missing orgId");
    const coverageRecovery =
      mode === "resume" && existingState?.coverageRecovery
        ? existingState.coverageRecovery
        : await coverageRecoverySnapshot(
            ctx,
            policy.orgId as Id<"organizations">,
          );
    const traceId =
      mode === "resume" && existingState?.traceId
        ? existingState.traceId
        : randomUUID();
    if (mode === "full" || !existingState?.traceId) {
      await startTraceSession(ctx, {
        traceId,
        policyId,
        orgId: String(policy.orgId ?? "") as Id<"organizations">,
        userId: asOptionalId<Id<"users">>(retrySource.userId),
        sourceKind: retrySource.sourceKind,
        trigger: `retry_${mode}`,
        fileName: retrySource.fileName,
      });
    } else {
      await traceEvent(ctx, traceId, {
        kind: "session",
        status: "resumed",
        message: "Extraction retry resumed existing trace",
      });
    }
    if (EXTERNAL_WORKER_MODE) {
      const nextState = {
        ...retrySource,
        coverageRecovery,
        traceId,
      };
      if (!nextState.fileId) throw new Error("Policy source file is missing");
      if (
        mode === "full" &&
        (await rejectedByDocumentGateBeforeExternalHandoff(ctx, {
          policyId: String(policyId),
          state: nextState,
        }))
      ) {
        return { success: true, traceId };
      }
      if (mode === "full") {
        await ctx.runMutation(internal.policies.pipelineClearLog, {
          jobId: String(policyId),
        });
        await clearArtifacts(ctx, String(policyId));
      }
      await ctx.runMutation(
        (internal as any).policies.pipelineStartExternalWorkerJob,
        {
          jobId: String(policyId),
          state: nextState,
        },
      );
      return { success: true, traceId };
    }

    const phases = makePhases(ctx);
    await runPipeline<PolicyExtractionState>({
      jobId: String(policyId),
      phases,
      storage,
      scheduler,
      retryMode: mode === "restart" ? "full" : mode,
      initialState: {
        ...retrySource,
        coverageRecovery,
        traceId,
      },
    });
    return { success: true, traceId };
  },
});
