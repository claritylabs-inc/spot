"use node";

import type { ExtractionTraceRouting } from "../lib/extractionTraceRouterFields";

import { randomUUID } from "crypto";
import dayjs from "dayjs";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { runPipeline } from "@claritylabs/cl-pipelines";
import {
  createConvexStorageAdapter,
  createConvexSchedulerAdapter,
} from "@claritylabs/cl-pipelines/convex";
import type { Phase, PhaseResult } from "@claritylabs/cl-pipelines";
import { deletePolicyRowsInBatches } from "../lib/deletePolicyRowsInBatches";
import { cancelDurableRouterRequest } from "../lib/routerJobClient";
import { makeGenerateObject } from "../lib/sdkCallbacks";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { NON_INSURANCE_DOCUMENT_ERROR } from "../lib/policyDocumentGate";
import {
  buildExtractionCompletionManifest,
  buildPromotionEvidenceLedger,
  extractionContractHash,
  extractionSourceFingerprint,
  sectionPageCoverageReasons,
} from "../lib/extractionPromotion";
import {
  openExtractionReviewQuestions,
  postProcessExtractionDocument,
} from "../lib/extractionPostProcess";
import {
  normalizeOperationalProfile,
  normalizeSourceTree,
  sourceTreePolicyFields,
  type DocumentSourceNode,
  type PolicyOperationalProfile,
  type SourceSpanLike,
} from "../lib/sourceTree";
import { extractPdfText, type PdfPageText } from "../lib/pdfText";
import {
  classifyPolicyIntake,
  type ExistingPolicyCandidate,
  type PolicyIntakeDecision,
} from "../lib/policyIntakeClassification";
import {
  planPolicySections,
  type PolicySection,
  type PolicySectionKind,
  type PolicySectionPlan,
} from "../lib/policySectioning";
import {
  resolveCarrierIdentityDecision,
  type CarrierIdentityDecision,
} from "../lib/carrierIdentitySource";
import type { ModelRoute } from "../lib/modelCatalog";
import {
  declarationsPreviewFields,
  mergeSectionResults,
  modelTranscriptionSpans,
  parseSectionResult,
  type SectionResult,
} from "../lib/sectionExtraction/merge";
import { buildDeclarationsSummary } from "../lib/sectionExtraction/prompts";
import {
  SECTION_EXTRACTOR_VERSION,
  type DeclarationsSectionOutput,
} from "../lib/sectionExtraction/schemas";
import {
  SECTION_TASK_KIND,
  runSectionJob,
  sectionExtractionRoute,
  sectionInvocationKey,
  sectionLabel,
  type SectionJobOutcome,
} from "../lib/sectionExtraction/sectionJobs";
import { z } from "zod";

const CANCELLED_BY_USER = "Cancelled by user";
const ADVANCE_LEASE_MS = 2 * 60 * 1000;
const ADVANCE_LEASE_HEARTBEAT_MS = 30 * 1000;
const ADVANCE_LEASE_WATCHDOG_GRACE_MS = 15 * 1000;
// Delay before an advance polls section router jobs that are still running.
const ROUTER_JOB_POLL_DELAY_MS = 3_000;
const SECTION_SUBMISSIONS_PER_ADVANCE = 6;
const SECTION_POLL_CONCURRENCY = 6;
// One automatic retry per section, like cl-sdk safeGenerateObject's default.
const SECTION_AUTO_RETRIES = 1;
const INTAKE_CANDIDATE_LIMIT = 20;
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
type PipelineArtifactKind =
  | "cl_sdk_checkpoint"
  | "embedding_payload"
  | "source_bundle"
  | "section_result"
  | "parsed_source"
  | "section_plan";

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

/** pdf.js text for the whole PDF, written by parse and read by later phases. */
type ParsedSourceArtifact = {
  version: "parsed-source-v1";
  pageCount: number;
  pages: PdfPageText[];
  sourceSpans: SourceSpanLike[];
  textLayerMissing: boolean;
};

type StoredSectionResult = {
  version: "section-result-v1";
  sectionId: string;
  kind: PolicySectionKind;
  pageStart: number;
  pageEnd: number;
  attempt: number;
  status: "succeeded" | "failed";
  output?: unknown;
  error?: string;
  model?: ModelRoute;
  routerRequestId?: string;
};

type SectionResultArtifact = {
  storageId: string;
  status: StoredSectionResult["status"];
  resultHash: string;
};

// Checkpoints from before the section pipeline that still map to a phase.
const LEGACY_PHASE_ALIASES: Record<string, string> = {
  embed_and_store: "store_sources",
};

class WaitingForRouterJobs extends Error {
  constructor(readonly pending: number) {
    super(`Waiting for ${pending} section extraction jobs`);
    this.name = "WaitingForRouterJobs";
  }
}

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
  const deduped: Array<{
    span: SourceSpanLike;
    order: ReturnType<typeof sourceSpanOrder>;
  }> = [];
  sourceSpans.forEach((span, index) => {
    const key = sourceSpanIdentity(span);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push({ span, order: sourceSpanOrder(span, index) });
  });
  return deduped
    .sort(
      (left, right) =>
        left.order.page - right.order.page ||
        left.order.index - right.order.index,
    )
    .map(({ span }) => span);
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
  workspaceScanImportId?: Id<"operatorWorkspaceScanImports">;
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
  /** Set by the removed extraction worker; such checkpoints restart from load_pdf. */
  externalWorker?: boolean;
  pdfByteLength?: number;
  pageCount?: number;
  /** Fingerprint of the parsed source spans that section results are bound to. */
  sourceFingerprint?: string;
  sectionPlanHash?: string;
  /** Current attempt per section; each attempt is a separate router invocation. */
  sectionAttempts?: Record<string, number>;
  /** Automatic retries used per section since the run or its latest Resume started. */
  sectionRetries?: Record<string, number>;
  previewWritten?: boolean;
  /** Set while extract_sections waits on router jobs between advances. */
  routerWaitStartedAt?: number;
};

function isReplacementRun(state: Pick<PolicyExtractionState, "policyVersionKind">) {
  return (
    state.policyVersionKind === "re_extraction" ||
    state.policyVersionKind === "renewal"
  );
}

/** The source fields a restarted extraction keeps from an unsupported checkpoint. */
function restartState(state: PolicyExtractionState): PolicyExtractionState {
  return {
    workspaceScanImportId: state.workspaceScanImportId,
    sourceKind: state.sourceKind ?? "upload",
    fileId: state.fileId,
    fileName: state.fileName,
    orgId: state.orgId,
    userId: state.userId,
    policyFileId: state.policyFileId,
    policyVersionKind: state.policyVersionKind,
    replacementPromotionStarted: state.replacementPromotionStarted,
    traceId: state.traceId,
  };
}

/**
 * Evidence merge hands to store_sources. Stored under the embedding_payload
 * artifact kind that in-flight runs from earlier deploys also use.
 */
type SourceStoragePayload = {
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
  sourceNodesForStorage?: DocumentSourceNode[];
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
    kind: "session" | "phase" | "model_call";
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
    routing?: ExtractionTraceRouting;
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

async function isExtractionCancelled(
  ctx: ActionCtx,
  policyId: string,
): Promise<boolean> {
  const policy = await ctx.runQuery(internal.policies.getInternal, {
    id: policyId as Id<"policies">,
  });
  return policy?.pipelineError === CANCELLED_BY_USER;
}

/**
 * Best effort: a cancelled run's section router jobs that cannot be cancelled
 * finish, and their results are never read.
 */
async function cancelSectionRouterJobs(ctx: ActionCtx, jobId: string) {
  const invocationKeys: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result: { page: string[]; isDone: boolean; continueCursor: string } =
      await ctx.runQuery(internal.policies.pipelineListCancelledSectionJobs, {
        jobId,
        paginationOpts: { numItems: 100, cursor },
      });
    invocationKeys.push(...result.page);
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  await runBounded(invocationKeys, SECTION_POLL_CONCURRENCY, async (invocationKey) => {
    try {
      await cancelDurableRouterRequest(ctx, invocationKey);
    } catch (error) {
      console.warn(
        `Could not cancel section router job ${invocationKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
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
  kind: PipelineArtifactKind,
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
  kind: PipelineArtifactKind,
): Promise<string | undefined> {
  const artifact = (await ctx.runQuery(internal.policies.pipelineGetArtifact, {
    jobId,
    kind,
  })) as { storageId?: string } | null;
  return artifact?.storageId ? String(artifact.storageId) : undefined;
}

async function loadParsedSource(ctx: ActionCtx, jobId: string) {
  return await loadJsonArtifact<ParsedSourceArtifact>(
    ctx,
    await getLatestArtifactStorageId(ctx, jobId, "parsed_source"),
  );
}

async function loadSectionPlan(ctx: ActionCtx, jobId: string) {
  return await loadJsonArtifact<PolicySectionPlan>(
    ctx,
    await getLatestArtifactStorageId(ctx, jobId, "section_plan"),
  );
}

async function currentRunLease(ctx: ActionCtx, jobId: string) {
  const context = (await ctx.runQuery(
    internal.policies.pipelineGetPromotionContext,
    { jobId },
  )) as { runId: Id<"policyExtractionRuns">; leaseId: string } | null;
  if (!context) throw new Error("Pipeline phase lease lost");
  return context;
}

function sectionResultHash(result: StoredSectionResult): string {
  return extractionContractHash({
    sectionId: result.sectionId,
    kind: result.kind,
    pageStart: result.pageStart,
    pageEnd: result.pageEnd,
    status: result.status,
    output: result.output ?? null,
    error: result.error ?? null,
  });
}

/** This run's section results for the current plan, by section ID. */
async function listSectionResults(
  ctx: ActionCtx,
  jobId: string,
  planHash: string,
): Promise<Map<string, SectionResultArtifact>> {
  const artifacts = (await ctx.runQuery(
    internal.policies.pipelineListSectionResults,
    { jobId },
  )) as Array<{ sectionId?: string; storageId: string; metadata?: unknown }>;
  const results = new Map<string, SectionResultArtifact>();
  for (const artifact of artifacts) {
    const metadata = (artifact.metadata ?? {}) as Partial<
      SectionResultArtifact & { planHash: string }
    >;
    if (
      !artifact.sectionId ||
      metadata.planHash !== planHash ||
      !metadata.status ||
      !metadata.resultHash
    ) {
      continue;
    }
    results.set(artifact.sectionId, {
      storageId: artifact.storageId,
      status: metadata.status,
      resultHash: metadata.resultHash,
    });
  }
  return results;
}

async function storeSectionResult(
  ctx: ActionCtx,
  jobId: string,
  args: {
    state: PolicyExtractionState;
    planHash: string;
    result: StoredSectionResult;
  },
) {
  const resultHash = sectionResultHash(args.result);
  await storeJsonArtifact(ctx, jobId, "section_result", args.result, {
    sourceFingerprint: args.state.sourceFingerprint,
    extractorVersion: SECTION_EXTRACTOR_VERSION,
    sectionId: args.result.sectionId,
    metadata: {
      sectionId: args.result.sectionId,
      status: args.result.status,
      resultHash,
      planHash: args.planHash,
      kind: args.result.kind,
      pageStart: args.result.pageStart,
      pageEnd: args.result.pageEnd,
      attempt: args.result.attempt,
    },
  });
}

/** Loads and validates succeeded section results; undefined when any is missing. */
async function loadSectionOutputs(
  ctx: ActionCtx,
  sections: PolicySection[],
  artifacts: Map<string, SectionResultArtifact>,
): Promise<Array<{ result: SectionResult; resultHash: string }> | undefined> {
  const loaded: Array<{ result: SectionResult; resultHash: string }> = [];
  for (const section of sections) {
    const artifact = artifacts.get(section.sectionId);
    if (artifact?.status !== "succeeded") return undefined;
    const stored = await loadJsonArtifact<StoredSectionResult>(
      ctx,
      artifact.storageId,
    );
    const result =
      stored && sectionResultHash(stored) === artifact.resultHash
        ? parseSectionResult(section, stored.output)
        : undefined;
    if (!result) return undefined;
    loaded.push({ result, resultHash: artifact.resultHash });
  }
  return loaded;
}

async function persistEvidenceAndPromote(
  ctx: ActionCtx,
  args: {
    policyId: string;
    sourceSpans: SourceSpanLike[];
    sourceNodes: DocumentSourceNode[];
    fields: Record<string, unknown>;
    plan: PolicySectionPlan;
    sections: Array<{ section: PolicySection; resultHash: string }>;
  },
) {
  const extractorVersion = SECTION_EXTRACTOR_VERSION;
  const ledger = buildPromotionEvidenceLedger({
    sourceSpans: args.sourceSpans,
    sourceTree: args.sourceNodes,
  });
  const spanIdsOnPages = (pageStart: number, pageEnd: number) =>
    args.sourceSpans.flatMap((span) => {
      const id = span.id ?? span.spanId;
      return id &&
        typeof span.pageStart === "number" &&
        span.pageStart >= pageStart &&
        span.pageStart <= pageEnd
        ? [id]
        : [];
    });
  const manifest = buildExtractionCompletionManifest({
    extractorVersion,
    ledger,
    pageCount: args.plan.pageCount,
    sectionPlanHash: args.plan.planHash,
    sections: args.sections.map(({ section, resultHash }) => ({
      id: section.sectionId,
      kind: section.kind,
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
      sourceSpanIds: spanIdsOnPages(section.pageStart, section.pageEnd),
      resultHash,
    })),
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
      phase: "merge",
      level: "warn",
    });
  }
  if (!result.promoted) {
    throw new Error(
      `Extraction promotion blocked: ${result.decision.reasons.join("; ")}`,
    );
  }
  return result.decision;
}

function asOptionalId<T extends string>(value: unknown): T | undefined {
  return typeof value === "string" && value.length > 0
    ? (value as T)
    : undefined;
}

async function clearArtifacts(
  ctx: ActionCtx,
  jobId: string,
  kind?: PipelineArtifactKind,
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

function percent(confidence: number) {
  return `${Math.round(confidence * 100)}% confidence`;
}

function intakeSummary(
  decision: PolicyIntakeDecision,
  candidates: ExistingPolicyCandidate[],
) {
  const { relationship } = decision;
  const related = candidates.find(
    (candidate) => candidate.policyId === relationship.policyId,
  );
  const target = relationship.policyId
    ? ` of ${related?.policyNumber ?? relationship.policyId}`
    : "";
  return `Document gate: ${decision.classification} (${percent(decision.confidence)}) — ${decision.reason.replace(/\.$/, "")}; relationship (advisory): ${relationship.kind}${target} (${percent(relationship.confidence)})`;
}

async function rejectDocument(
  ctx: ActionCtx,
  policyId: string,
  state: PolicyExtractionState,
  reason: string,
): Promise<PhaseResult<PolicyExtractionState>> {
  const rejectionSummary = `${NON_INSURANCE_DOCUMENT_ERROR} ${reason}`.slice(
    0,
    1000,
  );
  // Rejection during re-extraction or renewal keeps the existing bound policy.
  if (!isReplacementRun(state)) {
    await ctx.runMutation((internal as any).policies.updateExtractionInternal, {
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
    });
    if (state.fileId) {
      await ctx.runMutation((internal as any).policies.updateFiles, {
        id: policyId,
        files: [
          {
            fileId: state.fileId as Id<"_storage">,
            fileName: state.fileName || "upload.pdf",
            fileType: "unknown",
            status: "not_insurance",
          },
        ],
      });
    }
    await ctx.runMutation(
      (internal as any).policies.archiveRejectedDocumentInternal,
      {
        id: policyId,
        userId: state.userId,
      },
    );
  }
  return { kind: "error", error: rejectionSummary };
}

async function writeDeclarationsPreview(
  ctx: ActionCtx,
  jobId: string,
  outputs: DeclarationsSectionOutput[],
  previewModel: string | undefined,
): Promise<{ updated: boolean; reason?: string }> {
  const lease = await currentRunLease(ctx, jobId);
  return (await ctx.runMutation(
    internal.policies.updatePreviewExtractionInternal,
    {
      id: jobId as Id<"policies">,
      runId: lease.runId,
      leaseId: lease.leaseId,
      fields: declarationsPreviewFields(outputs),
      previewVersion: SECTION_EXTRACTOR_VERSION,
      previewModel,
    },
  )) as { updated: boolean; reason?: string };
}

async function resolveCarrierDecision(params: {
  ctx: ActionCtx;
  orgId: Id<"organizations">;
  operationalProfile: PolicyOperationalProfile;
  sourceTree: DocumentSourceNode[];
  sourceSpans: SourceSpanLike[];
  traceId?: string;
  log: (message: string, level?: PipelineLogLevel) => Promise<void>;
}): Promise<CarrierIdentityDecision | null> {
  try {
    const decision = await resolveCarrierIdentityDecision(params);
    // reviewReason is optional on decisions that need operator review.
    const reviewReason = (decision as { reviewReason?: string } | null)
      ?.reviewReason;
    if (reviewReason) {
      await params.log(`Carrier identity needs review: ${reviewReason}`, "warn");
    }
    return decision;
  } catch (error) {
    await params.log(
      `Carrier identity decision unavailable; using source evidence only (${error instanceof Error ? error.message : String(error)})`,
      "warn",
    );
    return null;
  }
}

async function advanceLeasedPhase(
  ctx: ActionCtx,
  jobId: string,
  phases: Phase<PolicyExtractionState>[],
): Promise<void> {
  const leaseId = randomUUID();
  const leaseExpiresAt = nowMs() + ADVANCE_LEASE_MS;
  const checkpoint = (await ctx.runMutation(
    internal.policies.pipelineAcquireLease,
    { jobId, leaseId, leaseExpiresAt },
  )) as LeasedPolicyCheckpoint | null;

  if (!checkpoint) {
    const reconciled = (await ctx.runMutation(
      (internal as any).policies.pipelineReconcileTerminalState,
      { jobId },
    )) as { terminal?: boolean; error?: string } | null;
    if (reconciled?.terminal) {
      await ctx.runMutation(
        (internal as any).extractionTraces.reconcileTerminalPolicy,
        { policyId: jobId },
      );
      // Operator stops cancel the run without scheduling cancelSectionJobs.
      if (reconciled.error === CANCELLED_BY_USER) {
        await cancelSectionRouterJobs(ctx, jobId);
      }
    }
    return;
  }
  const traceId = checkpoint.state?.traceId;

  const watchdogs: Id<"_scheduled_functions">[] = [];
  const scheduleWatchdog = async (expiresAt: number) => {
    watchdogs.push(
      await ctx.scheduler.runAfter(
        Math.max(0, expiresAt - nowMs() + ADVANCE_LEASE_WATCHDOG_GRACE_MS),
        internal.actions.policyExtraction.advance,
        { jobId },
      ),
    );
  };
  // Once this advance completes its lease it schedules its own continuation;
  // its watchdogs would only start duplicate polling advances.
  const completeLease = async (args: {
    status?: "complete" | "error";
    error?: string | null;
    checkpoint: unknown;
  }) => {
    const completed = await ctx.runMutation(
      internal.policies.pipelineCompleteLease,
      { jobId, leaseId, ...args },
    );
    if (completed) {
      await Promise.all(watchdogs.map((id) => ctx.scheduler.cancel(id)));
    }
    return completed;
  };

  await scheduleWatchdog(leaseExpiresAt);

  const phaseName =
    LEGACY_PHASE_ALIASES[checkpoint.nextPhase] ?? checkpoint.nextPhase;
  const phase = phases.find((p) => p.name === phaseName);
  if (!phase || checkpoint.state?.externalWorker) {
    await ctx.runMutation(internal.policies.pipelineAppendLog, {
      jobId,
      timestamp: nowMs(),
      message: `Restarting extraction from load_pdf; the ${checkpoint.nextPhase} checkpoint is no longer supported`,
      phase: "load_pdf",
      level: "warn",
    });
    await clearArtifacts(ctx, jobId);
    const restarted = await completeLease({
      checkpoint: {
        nextPhase: "load_pdf",
        state: restartState(checkpoint.state),
        createdAt: nowMs(),
      },
    });
    if (restarted) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.policyExtraction.advance,
        { jobId },
      );
    }
    return;
  }

  let latestCheckpoint = stripLease(checkpoint);
  const saveState = async (state: PolicyExtractionState) => {
    const createdAt = nowMs();
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
    const timestamp = nowMs();
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
        const nextExpiresAt = nowMs() + ADVANCE_LEASE_MS;
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
      await completeLease({
        status: "complete",
        error: null,
        checkpoint: null,
      });
      await completeTraceSession(ctx, traceId, "complete");
      return;
    }

    if (result.kind === "error") {
      await completeLease({
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

    const checkpointUpdated = await completeLease({
      checkpoint: {
        nextPhase: result.nextPhase,
        state: result.state,
        createdAt: nowMs(),
      },
    });
    if (checkpointUpdated) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.policyExtraction.advance,
        { jobId },
      );
    }
  } catch (err) {
    if (err instanceof WaitingForRouterJobs) {
      // Release the lease while router jobs run; a later advance polls them.
      if (await completeLease({ checkpoint: latestCheckpoint })) {
        await ctx.scheduler.runAfter(
          ROUTER_JOB_POLL_DELAY_MS,
          internal.actions.policyExtraction.advance,
          { jobId },
        );
      }
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    await log(`Phase "${phase.name}" threw: ${msg}`, "error");
    await completeLease({
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
      // Section artifacts from an earlier attempt must not satisfy this one.
      for (const kind of ["parsed_source", "section_plan", "section_result"] as const) {
        await clearArtifacts(convexCtx, pCtx.jobId, kind);
      }
      await pCtx.log(`PDF ready for extraction (${pdfBytes.byteLength} bytes)`);
      return {
        kind: "next",
        nextPhase: "parse",
        state: { ...state, pdfByteLength: pdfBytes.byteLength },
      };
    },
  };

  // ── Phase 2: parse (pdf.js text + intake gate) ────────────────────────────────
  const parsePhase: Phase<PolicyExtractionState> = {
    name: "parse",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }
      if (!state.fileId) {
        return { kind: "error", error: "parse: missing fileId" };
      }
      const pdfBytes = await loadPdfBytes(convexCtx, state.fileId);
      if (!pdfBytes)
        return { kind: "error", error: "File not found in storage" };

      const pdf = await extractPdfText({
        pdfBytes,
        documentId: policyId,
        sourceKind: "policy_pdf",
      });
      if (pdf.pageCount < 1) {
        return { kind: "error", error: "The PDF has no pages" };
      }
      const sourceSpans = canonicalSourceSpans(pdf.sourceSpans);
      const orgId = state.orgId as Id<"organizations">;

      let decision: PolicyIntakeDecision | undefined;
      let existingPolicies: ExistingPolicyCandidate[] = [];
      try {
        existingPolicies = await convexCtx.runQuery(
          internal.policies.listIntakeCandidatesInternal,
          {
            orgId,
            excludePolicyId: policyId as Id<"policies">,
            limit: INTAKE_CANDIDATE_LIMIT,
          },
        );
        decision = await classifyPolicyIntake({
          ctx: convexCtx,
          orgId,
          pageCount: pdf.pageCount,
          pages: pdf.pages,
          existingPolicies,
          traceId: state.traceId,
          policyId,
        });
      } catch (error) {
        await pCtx.log(
          `Warning: document gate failed; continuing extraction (${error instanceof Error ? error.message : String(error)})`,
          "warn",
        );
      }
      await pCtx.log(
        [
          `Parsed ${pdf.pageCount} pages into ${sourceSpans.length} source spans.`,
          decision ? intakeSummary(decision, existingPolicies) : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      );
      if (decision && !decision.shouldExtract) {
        return await rejectDocument(convexCtx, policyId, state, decision.reason);
      }
      if (pdf.textLayerMissing) {
        await pCtx.log(
          "The PDF has no text layer; sections are read from the PDF and cite page-level evidence",
          "warn",
        );
      }

      const parsed: ParsedSourceArtifact = {
        version: "parsed-source-v1",
        pageCount: pdf.pageCount,
        pages: pdf.pages,
        sourceSpans,
        textLayerMissing: pdf.textLayerMissing,
      };
      await storeJsonArtifact(convexCtx, policyId, "parsed_source", parsed);
      return {
        kind: "next",
        nextPhase: "plan_sections",
        state: {
          ...state,
          pageCount: pdf.pageCount,
          sourceFingerprint: extractionSourceFingerprint(sourceSpans),
        },
      };
    },
  };

  // ── Phase 3: plan_sections ────────────────────────────────────────────────────
  const planSectionsPhase: Phase<PolicyExtractionState> = {
    name: "plan_sections",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }
      const parsed = await loadParsedSource(convexCtx, policyId);
      if (!parsed || state.pdfByteLength === undefined) {
        return {
          kind: "error",
          error: "plan_sections: parsed source is missing; restart the extraction",
        };
      }
      const plan = await planPolicySections({
        ctx: convexCtx,
        orgId: state.orgId as Id<"organizations">,
        pageCount: parsed.pageCount,
        pages: parsed.pages,
        pdfByteLength: state.pdfByteLength,
        traceId: state.traceId,
        policyId,
      });
      const planProblems = sectionPageCoverageReasons({
        pageCount: parsed.pageCount,
        sections: plan.sections.map((section) => ({
          id: section.sectionId,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
        })),
      });
      if (planProblems.length > 0) {
        return {
          kind: "error",
          error: `Section plan is invalid: ${planProblems.join("; ")}`,
        };
      }
      await storeJsonArtifact(convexCtx, policyId, "section_plan", plan, {
        metadata: { planHash: plan.planHash, sectionCount: plan.sections.length },
      });
      await pCtx.log(
        `Planned ${plan.sections.length} sections: ${plan.sections
          .map((section) => `${section.kind} ${section.pageStart}-${section.pageEnd}`)
          .join(", ")}`.slice(0, 2000),
      );
      return {
        kind: "next",
        nextPhase: "extract_sections",
        state: {
          ...state,
          sectionPlanHash: plan.planHash,
          sectionAttempts: {},
          sectionRetries: {},
          previewWritten: false,
        },
      };
    },
  };

  // ── Phase 4: extract_sections (one durable router job per section) ────────────
  const extractSectionsPhase: Phase<PolicyExtractionState> = {
    name: "extract_sections",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }
      const plan = await loadSectionPlan(convexCtx, policyId);
      if (
        !plan ||
        plan.planHash !== state.sectionPlanHash ||
        !state.sourceFingerprint ||
        !state.fileId
      ) {
        return {
          kind: "error",
          error: "extract_sections: section plan is missing; restart the extraction",
        };
      }
      const fileId = state.fileId;
      const orgId = state.orgId as Id<"organizations">;
      const { runId } = await currentRunLease(convexCtx, policyId);
      const stored = await listSectionResults(convexCtx, policyId, plan.planHash);
      const completed = new Set(
        [...stored]
          .filter(([, artifact]) => artifact.status === "succeeded")
          .map(([sectionId]) => sectionId),
      );
      const succeeded = (section: PolicySection) =>
        completed.has(section.sectionId);
      const declarations = plan.sections.filter(
        (section) => section.kind === "declarations",
      );
      const declarationsDone = declarations.every(succeeded);
      // Declarations complete first; the rest run with their summary as context.
      const pending = plan.sections.filter(
        (section) =>
          !succeeded(section) &&
          (declarationsDone || section.kind === "declarations"),
      );
      const declarationOutputs = declarationsDone
        ? ((await loadSectionOutputs(convexCtx, declarations, stored)) ?? [])
        : [];
      const declarationsSummary = buildDeclarationsSummary(
        declarationOutputs.flatMap(({ result }) =>
          result.kind === "declarations" ? [result.output] : [],
        ),
      );

      const attempts = { ...state.sectionAttempts };
      const retries = { ...state.sectionRetries };
      const route = await sectionExtractionRoute(convexCtx, orgId);
      let pdfBytes: Uint8Array | null = null;
      const loadPdf = async () => {
        pdfBytes ??= await loadPdfBytes(convexCtx, fileId);
        if (!pdfBytes) throw new Error("File not found in storage");
        return pdfBytes;
      };
      const runJob = (section: PolicySection, allowSubmission: boolean) =>
        runSectionJob(convexCtx, {
          invocationKey: sectionInvocationKey({
            runId,
            traceId: state.traceId,
            planHash: plan.planHash,
            section,
            attempt: attempts[section.sectionId] ?? 1,
            declarationsSummary:
              section.kind === "declarations" ? undefined : declarationsSummary,
          }),
          allowSubmission,
          orgId,
          policyId,
          traceId: state.traceId,
          section,
          pageCount: plan.pageCount,
          declarationsSummary:
            section.kind === "declarations" ? undefined : declarationsSummary,
          route,
          loadPdf,
        });

      // Poll submitted jobs concurrently, then submit a bounded number of new
      // ones one at a time so only one PDF slice is in memory.
      const outcomes = new Map<string, SectionJobOutcome>();
      await runBounded(pending, SECTION_POLL_CONCURRENCY, async (section) => {
        outcomes.set(section.sectionId, await runJob(section, false));
      });
      const unsubmitted = pending.filter(
        (section) => outcomes.get(section.sectionId)?.status === "not_submitted",
      );
      const toSubmit = unsubmitted.slice(0, SECTION_SUBMISSIONS_PER_ADVANCE);
      for (const section of toSubmit) {
        outcomes.set(section.sectionId, await runJob(section, true));
      }
      // A cancel that landed during these submissions could not see their jobs.
      if (toSubmit.length > 0 && (await isExtractionCancelled(convexCtx, policyId))) {
        await cancelSectionRouterJobs(convexCtx, policyId);
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      let waiting = 0;
      let deferred = 0;
      let declarationsModel: string | undefined;
      const exhausted: Array<{ section: PolicySection; error: string }> = [];
      const submitted: PolicySection[] = [];
      for (const section of pending) {
        const outcome = outcomes.get(section.sectionId)!;
        const attempt = attempts[section.sectionId] ?? 1;
        if (outcome.status === "not_submitted") {
          deferred += 1;
          continue;
        }
        if (outcome.status === "pending") {
          waiting += 1;
          if (unsubmitted.includes(section)) submitted.push(section);
          continue;
        }
        if (outcome.status === "succeeded") {
          const { response } = outcome;
          await storeSectionResult(convexCtx, policyId, {
            state,
            planHash: plan.planHash,
            result: {
              version: "section-result-v1",
              sectionId: section.sectionId,
              kind: section.kind,
              pageStart: section.pageStart,
              pageEnd: section.pageEnd,
              attempt,
              status: "succeeded",
              output: outcome.output,
              model: response.model,
              routerRequestId: response.requestId,
            },
          });
          completed.add(section.sectionId);
          if (section.kind === "declarations") {
            declarationsModel ??= response.model.model;
          }
          await traceEvent(convexCtx, state.traceId, {
            kind: "model_call",
            phase: "extract_sections",
            label: sectionLabel(section),
            task: "extraction",
            taskKind: SECTION_TASK_KIND,
            provider: response.model.provider,
            model: response.model.model,
            routeSource: response.routing.source ?? response.routing.decision,
            transport: "cl-router",
            attempt,
            status: "complete",
            durationMs: outcome.durationMs,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cachedInputTokens: response.usage.cachedInputTokens,
            routerRequestId: response.requestId,
            costUsd: response.costUsd,
            costStatus: response.costStatus,
            routingDecision: response.routing.decision,
            routing: response.routing,
            details: { sectionId: section.sectionId, kind: section.kind },
          });
          await pCtx.log(`Extracted ${section.kind} pages ${section.pageStart}-${section.pageEnd}`);
          continue;
        }
        await storeSectionResult(convexCtx, policyId, {
          state,
          planHash: plan.planHash,
          result: {
            version: "section-result-v1",
            sectionId: section.sectionId,
            kind: section.kind,
            pageStart: section.pageStart,
            pageEnd: section.pageEnd,
            attempt,
            status: "failed",
            error: outcome.error.slice(0, 1000),
          },
        });
        await traceEvent(convexCtx, state.traceId, {
          kind: "model_call",
          phase: "extract_sections",
          label: sectionLabel(section),
          task: "extraction",
          taskKind: SECTION_TASK_KIND,
          attempt,
          status: "error",
          error: outcome.error,
          details: { sectionId: section.sectionId, kind: section.kind },
        });
        // A failed attempt is final for its invocation key; the next attempt
        // submits a new router job.
        attempts[section.sectionId] = attempt + 1;
        if ((retries[section.sectionId] ?? 0) < SECTION_AUTO_RETRIES) {
          retries[section.sectionId] = (retries[section.sectionId] ?? 0) + 1;
          await pCtx.log(
            `Retrying ${section.kind} pages ${section.pageStart}-${section.pageEnd} after a failed extraction: ${outcome.error}`,
            "warn",
          );
        } else {
          // Resume starts with a fresh retry budget.
          retries[section.sectionId] = 0;
          exhausted.push({ section, error: outcome.error });
        }
      }
      if (submitted.length > 0) {
        await pCtx.log(
          `Submitted ${submitted.length} section extraction ${submitted.length === 1 ? "job" : "jobs"}: ${submitted
            .map((section) => `${section.kind} ${section.pageStart}-${section.pageEnd}`)
            .join(", ")}`,
        );
      }

      const nextState: PolicyExtractionState = {
        ...state,
        sectionAttempts: attempts,
        sectionRetries: retries,
      };
      if (exhausted.length > 0) {
        await pCtx.saveState({ ...nextState, routerWaitStartedAt: undefined });
        return {
          kind: "error",
          error: `Section extraction failed for ${exhausted
            .map(({ section }) => `${section.kind} pages ${section.pageStart}-${section.pageEnd}`)
            .join(", ")}: ${exhausted[0].error}. Retry to resume from the completed sections.`,
        };
      }

      if (
        !nextState.previewWritten &&
        !isReplacementRun(state) &&
        declarations.length > 0 &&
        declarations.every(succeeded)
      ) {
        const outputs = await loadSectionOutputs(
          convexCtx,
          declarations,
          await listSectionResults(convexCtx, policyId, plan.planHash),
        );
        if (outputs) {
          // The preview is provisional; it never fails the extraction.
          try {
            const preview = await writeDeclarationsPreview(
              convexCtx,
              policyId,
              outputs.flatMap(({ result }) =>
                result.kind === "declarations" ? [result.output] : [],
              ),
              declarationsModel,
            );
            await pCtx.log(
              preview.updated
                ? "Provisional policy details are ready from the declarations"
                : `Provisional policy details skipped (${preview.reason ?? "not updated"})`,
            );
          } catch (error) {
            await pCtx.log(
              `Provisional policy details failed: ${error instanceof Error ? error.message : String(error)}`,
              "warn",
            );
          }
          nextState.previewWritten = true;
        }
      }

      if (plan.sections.every(succeeded)) {
        return {
          kind: "next",
          nextPhase: "merge",
          state: { ...nextState, routerWaitStartedAt: undefined },
        };
      }
      if (waiting === 0) {
        // Declarations just finished, a retry is due, or submissions were
        // capped: start the next jobs right away.
        return { kind: "next", nextPhase: "extract_sections", state: nextState };
      }
      await pCtx.saveState({
        ...nextState,
        routerWaitStartedAt: state.routerWaitStartedAt ?? nowMs(),
      });
      throw new WaitingForRouterJobs(waiting + deferred);
    },
  };

  // ── Phase 5: merge (citations → evidence → promotion) ─────────────────────────
  const mergePhase: Phase<PolicyExtractionState> = {
    name: "merge",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }
      if (!state.fileId) {
        return { kind: "error", error: "merge: missing fileId" };
      }
      const [parsed, plan] = await Promise.all([
        loadParsedSource(convexCtx, policyId),
        loadSectionPlan(convexCtx, policyId),
      ]);
      if (!parsed || !plan || plan.planHash !== state.sectionPlanHash) {
        return {
          kind: "error",
          error: "merge: parsed source or section plan is missing; restart the extraction",
        };
      }
      const sections = await loadSectionOutputs(
        convexCtx,
        plan.sections,
        await listSectionResults(convexCtx, policyId, plan.planHash),
      );
      if (!sections) {
        return {
          kind: "error",
          error: "merge: section results are incomplete; retry to resume the extraction",
        };
      }
      const log = async (message: string, level?: PipelineLogLevel) => {
        await pCtx.log(message, level);
      };
      const orgId = state.orgId as Id<"organizations">;
      const results = sections.map(({ result }) => result);
      const transcriptions = modelTranscriptionSpans({
        documentId: policyId,
        results,
        sourceSpans: parsed.sourceSpans,
      });
      const sourceSpans = canonicalSourceSpans([
        ...parsed.sourceSpans,
        ...transcriptions,
      ]);
      const sourceNodes = normalizeSourceTree([], sourceSpans, policyId);
      const merged = mergeSectionResults({
        policyId,
        results,
        sourceSpans,
        sourceTree: sourceNodes,
      });
      const matches = merged.citationMatches;
      await pCtx.log(
        [
          transcriptions.length > 0
            ? `Transcribed cited quotes on ${transcriptions.length} ${transcriptions.length === 1 ? "page" : "pages"} without a text layer.`
            : undefined,
          `Merged ${sections.length} sections. Citations: ${matches.exact} exact, ${matches.normalized} normalized, ${matches.page_only} page-level, ${matches.unresolved} unresolved; ${merged.uncitedFactCount} uncited facts dropped`,
        ]
          .filter(Boolean)
          .join(" "),
      );

      const processed = await postProcessExtractionDocument({
        ctx: convexCtx,
        orgId,
        document: merged.document,
        sourceSpans,
        traceId: state.traceId,
        policyId,
        log,
      });
      const doc = processed.document;
      const operationalProfile = await extractAdditionalInsuredEligibility({
        ctx: convexCtx,
        orgId,
        traceId: state.traceId,
        policyId,
        sourceTree: sourceNodes,
        profile: normalizeOperationalProfile(
          merged.operationalProfile,
          sourceNodes,
          sourceSpans,
        ),
        log,
      });
      const carrierDecision = await resolveCarrierDecision({
        ctx: convexCtx,
        orgId,
        operationalProfile,
        sourceTree: sourceNodes,
        sourceSpans,
        traceId: state.traceId,
        log,
      });
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

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
      const promotionState: PolicyExtractionState = isReplacementRun(state)
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
          sourceSpans,
          existingDocumentMetadata: doc.documentMetadata,
          existingDeclarations: doc.declarations,
          existingLinesOfBusiness: existingPolicy?.linesOfBusiness,
          existingPolicyFields: fieldsWithPersistedCarrierIdentity(
            fields,
            existingPolicy,
          ),
          carrierDecision,
        }),
      };
      await persistEvidenceAndPromote(convexCtx, {
        policyId,
        sourceSpans,
        sourceNodes,
        fields: finalFields,
        plan,
        sections: sections.map(({ result, resultHash }) => ({
          section: result.section,
          resultHash,
        })),
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

      const payload: SourceStoragePayload = {
        sourceSpansForStorage:
          sourceSpans as SourceStoragePayload["sourceSpansForStorage"],
        sourceNodesForStorage: sourceNodes,
      };
      await storeJsonArtifact(convexCtx, policyId, "embedding_payload", payload);
      return {
        kind: "next",
        nextPhase: "store_sources",
        state: { ...promotionState, fileName: resolvedFileName },
      };
    },
  };

  // ── Phase 6: store_sources ────────────────────────────────────────────────────
  const storeSourcesPhase: Phase<PolicyExtractionState> = {
    name: "store_sources",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      const payload =
        (await loadJsonArtifact<SourceStoragePayload>(
          convexCtx,
          await getLatestArtifactStorageId(convexCtx, policyId, "embedding_payload"),
        )) ?? {};
      const sourceSpans = payload.sourceSpansForStorage;
      const sourceNodes = payload.sourceNodesForStorage;
      const isCancelled = () => isExtractionCancelled(convexCtx, policyId);

      if (sourceSpans?.length || sourceNodes?.length) {
        await pCtx.log(
          `Storing ${sourceSpans?.length ?? 0} source spans, ${sourceNodes?.length ?? 0} source nodes in batches of ${SOURCE_STORAGE_BATCH_SIZE}...`,
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
      }

      await clearArtifacts(convexCtx, policyId, "embedding_payload");
      await clearArtifacts(convexCtx, policyId, "cl_sdk_checkpoint");
      return { kind: "next", nextPhase: "post_process", state };
    },
  };

  // ── Phase 7: post_process (terminal — persists enrichment and downstream work)
  const postProcessPhase: Phase<PolicyExtractionState> = {
    name: "post_process",
    run: async (pCtx): Promise<PhaseResult<PolicyExtractionState>> => {
      const { state } = pCtx.checkpoint;
      const policyId = pCtx.jobId;
      if (await isExtractionCancelled(convexCtx, policyId)) {
        return { kind: "error", error: CANCELLED_BY_USER };
      }

      // Record the document-event policy version after the current policy row has
      // been materialized.
      try {
        if (
          state.policyVersionKind === "re_extraction" ||
          state.policyVersionKind === "renewal"
        ) {
          await convexCtx.runMutation(
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
          await convexCtx.runMutation(
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
          orgId?: string;
          uploadedBySide?: string;
          extractionReview?: unknown;
          policyNumber?: string;
          carrier?: string;
        } | null;
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
            const notified = await convexCtx.runMutation(
              internal.lib.notify.notifyPolicyExtractionReviewInternal,
              {
                policyId: policyId as Id<"policies">,
                questionCount: reviewQuestions.length,
                workspaceScanImportId: state.workspaceScanImportId,
              },
            );
            if (notified)
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
      const { traceId, routerWaitStartedAt } = pCtx.checkpoint.state;
      const startedAt = routerWaitStartedAt ?? nowMs();
      // Polling advances of extract_sections continue one traced phase.
      if (routerWaitStartedAt === undefined) {
        await traceEvent(convexCtx, traceId, {
          kind: "phase",
          phase: phase.name,
          label: phase.name,
          status: "started",
        });
      }
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
        if (error instanceof WaitingForRouterJobs) throw error;
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

  return [
    loadPdfPhase,
    parsePhase,
    planSectionsPhase,
    extractSectionsPhase,
    mergePhase,
    storeSourcesPhase,
    postProcessPhase,
  ].map(withTrace);
}

// ─── advance internal action ───────────────────────────────────────────────────

export const advance = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    const phases = makePhases(ctx);
    await advanceLeasedPhase(ctx, jobId, phases);
  },
});

/** Scheduled by cancelExtraction once the run is marked cancelled. */
export const cancelSectionJobs = internalAction({
  args: { jobId: v.string() },
  handler: async (ctx, { jobId }) => {
    await cancelSectionRouterJobs(ctx, jobId);
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

// ─── Entry point: start from upload ───────────────────────────────────────────

export const startPolicyExtractionFromUpload = internalAction({
  args: {
    policyId: v.id("policies"),
    fileId: v.id("_storage"),
    fileName: v.optional(v.string()),
    orgId: v.id("organizations"),
    userId: v.id("users"),
    policyFileId: v.optional(v.id("policyFiles")),
    workspaceScanImportId: v.optional(v.id("operatorWorkspaceScanImports")),
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
      workspaceScanImportId,
      policyVersionKind,
    },
  ) => {
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
        workspaceScanImportId,
        policyVersionKind,
        replacementPromotionStarted:
          policyVersionKind === "re_extraction" ||
          policyVersionKind === "renewal"
            ? false
            : undefined,
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
  | "workspaceScanImportId"
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
    workspaceScanImportId: retryState?.workspaceScanImportId,
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

    const phases = makePhases(ctx);
    await runPipeline<PolicyExtractionState>({
      jobId: String(policyId),
      phases,
      storage,
      scheduler,
      retryMode: mode === "restart" ? "full" : mode,
      initialState: {
        ...retrySource,
        traceId,
      },
    });
    return { success: true, traceId };
  },
});
