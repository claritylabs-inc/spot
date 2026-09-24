"use node";

// Owner: P5 (docs/architecture/convex-section-extraction.md). Procurement
// proposal (quote) documents extract through the same Convex section
// pipeline as policies: pdf.js text -> section plan -> one durable router
// job per section (stable key `proposal:<jobId>:<documentId>:<sectionId>`)
// -> citation-resolved merge -> a quote-terms supplemental job -> document-
// qualified spans/nodes -> `aggregateProposalDocuments`. Unlike policies,
// there is no promotion gate, no preview stage, no chunking, no carrier-
// identity/coverage-scoping post-process, and no compliance/certificate
// writes: completion is a single patch of the proposal's `extractedOffer`.
//
// Sections for every document in a job run concurrently (no declarations-
// first staging); a quote-terms failure is logged and skipped rather than
// failing the whole document, since it only supplements optional fields.

import dayjs from "dayjs";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { extractPdfText } from "../lib/pdfText";
import { planPolicySections, type PolicySection } from "../lib/policySectioning";
import { normalizeSourceTree, type SourceSpanLike } from "../lib/sourceTree";
import { mergeSectionResults, parseSectionResult, type SectionResult } from "../lib/sectionExtraction/merge";
import {
  proposalSectionInvocationKey,
  proposalQuoteTermsInvocationKey,
  runSectionJob,
  runProposalQuoteTermsJob,
  sectionExtractionRoute,
  sectionLabel,
} from "../lib/sectionExtraction/sectionJobs";
import { extractionContractHash } from "../lib/extractionPromotion";
import { aggregateProposalDocuments, type ProposalDocumentExtraction } from "../lib/proposalAggregation";
import type { ProposalEvidenceItem, ProposalQuoteTerms } from "../lib/sectionExtraction/schemas";

const internalApi = internal as any;

const ADVANCE_LEASE_MS = 2 * 60 * 1000;
const ADVANCE_LEASE_WATCHDOG_GRACE_MS = 15 * 1000;
const ROUTER_JOB_POLL_DELAY_MS = 3_000;
const SECTION_AUTO_RETRIES = 1;
const QUOTE_TERMS_AUTO_RETRIES = 1;
const STORAGE_BATCH_SIZE = 100;
const STALE_SWEEP_MS = 10 * 60 * 1000;
const STALE_SWEEP_BATCH_LIMIT = 25;

function nowMs(): number {
  return dayjs().valueOf();
}

function randomId(): string {
  return `${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type DocState = {
  proposalDocumentId: string;
  fileId: string;
  fileName: string;
  phase: "pending" | "sections" | "quote_terms" | "merged" | "failed";
  pageCount?: number;
  planHash?: string;
  sections?: PolicySection[];
  sectionAttempts?: Record<string, number>;
  quoteTermsAttempt?: number;
  error?: string;
};

type PipelineState = {
  traceId: string;
  documents: DocState[];
};

type StoredSourceSpan = SourceSpanLike & {
  id: string;
  documentId: string;
  text: string;
  textHash: string;
  bbox?: unknown;
  metadata?: Record<string, unknown>;
};

type ParsedSourceArtifact = {
  pageCount: number;
  sourceSpans: StoredSourceSpan[];
  textLayerMissing: boolean;
};

type SectionResultArtifactValue = {
  sectionId: string;
  kind: PolicySection["kind"];
  output: unknown;
  planHash: string;
};

async function log(
  ctx: ActionCtx,
  jobId: Id<"procurementProposalExtractionJobs">,
  message: string,
  level?: "info" | "warn" | "error",
): Promise<void> {
  await ctx
    .runMutation(internalApi.proposalExtraction.recordLogInternal, {
      jobId,
      message,
      level,
    })
    .catch(() => {});
}

async function loadDocumentBytes(
  ctx: ActionCtx,
  fileId: string,
): Promise<Uint8Array> {
  const blob = await ctx.storage.get(fileId as Id<"_storage">);
  if (!blob) throw new Error("Proposal document file not found in storage");
  return new Uint8Array(await blob.arrayBuffer());
}

async function saveArtifact(
  ctx: ActionCtx,
  args: {
    jobId: Id<"procurementProposalExtractionJobs">;
    proposalId: Id<"procurementProposals">;
    proposalDocumentId: Id<"procurementProposalDocuments">;
    kind: string;
    value?: unknown;
    blob?: unknown;
  },
): Promise<void> {
  const storageId = args.blob
    ? await ctx.storage.store(
        new Blob([JSON.stringify(args.blob)], { type: "application/json" }),
      )
    : undefined;
  await ctx.runMutation(internalApi.proposalExtraction.saveArtifactInternal, {
    jobId: args.jobId,
    proposalId: args.proposalId,
    proposalDocumentId: args.proposalDocumentId,
    kind: args.kind,
    ...(args.value !== undefined ? { value: args.value } : {}),
    ...(storageId ? { storageId } : {}),
  });
}

async function loadLatestArtifact<T>(
  ctx: ActionCtx,
  args: {
    jobId: Id<"procurementProposalExtractionJobs">;
    proposalDocumentId: Id<"procurementProposalDocuments">;
    kind: string;
  },
): Promise<T | undefined> {
  const rows: Array<{ value?: unknown; storageId?: Id<"_storage"> }> =
    await ctx.runQuery(internalApi.proposalExtraction.listArtifactsInternal, args);
  const latest = rows.at(-1);
  if (!latest) return undefined;
  if (latest.storageId) {
    const blob = await ctx.storage.get(latest.storageId);
    if (!blob) return undefined;
    return JSON.parse(await blob.text()) as T;
  }
  return latest.value as T;
}

async function loadSectionResultArtifacts(
  ctx: ActionCtx,
  args: {
    jobId: Id<"procurementProposalExtractionJobs">;
    proposalDocumentId: Id<"procurementProposalDocuments">;
  },
): Promise<Map<string, SectionResultArtifactValue>> {
  const rows: Array<{ value?: unknown }> = await ctx.runQuery(
    internalApi.proposalExtraction.listArtifactsInternal,
    { ...args, kind: "section_result" },
  );
  const bySection = new Map<string, SectionResultArtifactValue>();
  for (const row of rows) {
    const value = row.value as SectionResultArtifactValue | undefined;
    if (value?.sectionId) bySection.set(value.sectionId, value);
  }
  return bySection;
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function evidenceItemsFromProfile(
  profile: ReturnType<typeof mergeSectionResults>["operationalProfile"],
): ProposalEvidenceItem[] {
  const items: ProposalEvidenceItem[] = [];
  const push = (
    description: string | undefined,
    category: string,
    sourceNodeIds: string[] | undefined,
    sourceSpanIds: string[] | undefined,
  ) => {
    if (!description) return;
    const nodeIds = (sourceNodeIds ?? []).slice(0, 20);
    const spanIds = (sourceSpanIds ?? []).slice(0, 50);
    if (nodeIds.length === 0 && spanIds.length === 0) return;
    items.push({
      description: description.slice(0, 2000),
      category,
      sourceNodeIds: nodeIds,
      sourceSpanIds: spanIds,
      pageStart: null,
      pageEnd: null,
    });
  };
  push(
    profile.policyNumber ? `Quote/policy number: ${profile.policyNumber.value}` : undefined,
    "identity",
    profile.policyNumber?.sourceNodeIds,
    profile.policyNumber?.sourceSpanIds,
  );
  push(
    profile.namedInsured ? `Named insured: ${profile.namedInsured.value}` : undefined,
    "identity",
    profile.namedInsured?.sourceNodeIds,
    profile.namedInsured?.sourceSpanIds,
  );
  push(
    profile.insurer ? `Carrier: ${profile.insurer.value}` : undefined,
    "identity",
    profile.insurer?.sourceNodeIds,
    profile.insurer?.sourceSpanIds,
  );
  push(
    profile.effectiveDate ? `Proposed effective date: ${profile.effectiveDate.value}` : undefined,
    "dates",
    profile.effectiveDate?.sourceNodeIds,
    profile.effectiveDate?.sourceSpanIds,
  );
  push(
    profile.expirationDate ? `Proposed expiration date: ${profile.expirationDate.value}` : undefined,
    "dates",
    profile.expirationDate?.sourceNodeIds,
    profile.expirationDate?.sourceSpanIds,
  );
  push(
    profile.premium ? `Premium: ${profile.premium.value}` : undefined,
    "premium",
    profile.premium?.sourceNodeIds,
    profile.premium?.sourceSpanIds,
  );
  for (const fact of profile.declarationFacts) {
    push(`${fact.field}: ${fact.value}`, "declarations", fact.sourceNodeIds, fact.sourceSpanIds);
  }
  for (const coverage of profile.coverages) {
    const detail = [coverage.limit, coverage.deductible, coverage.premium]
      .filter(Boolean)
      .join(", ");
    push(
      `Coverage ${coverage.name}${detail ? `: ${detail}` : ""}`,
      "coverage",
      toStringArray(coverage.sourceNodeIds),
      toStringArray(coverage.sourceSpanIds),
    );
  }
  for (const party of profile.parties) {
    push(`${party.role}: ${party.name}`, "party", party.sourceNodeIds, party.sourceSpanIds);
  }
  for (const support of profile.endorsementSupport) {
    push(support.summary, "endorsement", support.sourceNodeIds, support.sourceSpanIds);
  }
  return items.slice(0, 300);
}

function validateQuoteTerms(
  output: ProposalQuoteTerms,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): ProposalQuoteTerms {
  const normalizeItem = (
    item: ProposalEvidenceItem | null,
  ): ProposalEvidenceItem | null => {
    if (!item) return null;
    const sourceNodeIds = item.sourceNodeIds.filter((id) => validNodeIds.has(id));
    const sourceSpanIds = item.sourceSpanIds.filter((id) => validSpanIds.has(id));
    if (sourceNodeIds.length === 0 && sourceSpanIds.length === 0) return null;
    return { ...item, sourceNodeIds, sourceSpanIds };
  };
  const quoteExpirationEvidence = normalizeItem(output.quoteExpirationEvidence);
  return {
    quoteExpirationDate: quoteExpirationEvidence ? output.quoteExpirationDate : null,
    quoteExpirationEvidence,
    subjectivities: output.subjectivities
      .map(normalizeItem)
      .filter((item): item is ProposalEvidenceItem => item !== null),
    conditions: output.conditions
      .map(normalizeItem)
      .filter((item): item is ProposalEvidenceItem => item !== null),
  };
}

async function mergeDocument(
  ctx: ActionCtx,
  jobId: Id<"procurementProposalExtractionJobs">,
  doc: DocState,
): Promise<ReturnType<typeof mergeSectionResults> | undefined> {
  const parsed = await loadLatestArtifact<ParsedSourceArtifact>(ctx, {
    jobId,
    proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
    kind: "parsed_source",
  });
  if (!parsed || !doc.sections || !doc.planHash) return undefined;
  const sectionResults = await loadSectionResultArtifacts(ctx, {
    jobId,
    proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
  });
  const results: SectionResult[] = [];
  for (const section of doc.sections) {
    const stored = sectionResults.get(section.sectionId);
    if (!stored || stored.planHash !== doc.planHash) continue;
    const parsedResult = parseSectionResult(section, stored.output);
    if (parsedResult) results.push(parsedResult);
  }
  const sourceTree = normalizeSourceTree([], parsed.sourceSpans, doc.proposalDocumentId);
  return mergeSectionResults({
    policyId: doc.proposalDocumentId,
    results,
    sourceSpans: parsed.sourceSpans,
    sourceTree,
  });
}

type TickResult =
  | { kind: "continue"; state: PipelineState }
  | { kind: "pending"; state: PipelineState }
  | {
      kind: "done";
      extractedOffer: unknown;
      spanRows: Record<string, unknown>[];
      nodeRows: Record<string, unknown>[];
    }
  | { kind: "error"; error: string };

async function runTick(
  ctx: ActionCtx,
  jobId: Id<"procurementProposalExtractionJobs">,
  proposalId: Id<"procurementProposals">,
  clientOrgId: Id<"organizations">,
  extractionFingerprint: string,
  state: PipelineState,
): Promise<TickResult> {
  let waiting = false;

  // 1. Parse + plan every pending document.
  for (const doc of state.documents) {
    if (doc.phase !== "pending") continue;
    try {
      const bytes = await loadDocumentBytes(ctx, doc.fileId);
      const parsed = await extractPdfText({
        pdfBytes: bytes,
        documentId: doc.proposalDocumentId,
        sourceKind: "attachment",
      });
      await saveArtifact(ctx, {
        jobId,
        proposalId,
        proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
        kind: "parsed_source",
        blob: {
          pageCount: parsed.pageCount,
          sourceSpans: parsed.sourceSpans,
          textLayerMissing: parsed.textLayerMissing,
        } satisfies ParsedSourceArtifact,
      });
      const plan = await planPolicySections({
        ctx,
        orgId: clientOrgId,
        pageCount: parsed.pageCount,
        pages: parsed.pages,
        pdfByteLength: bytes.byteLength,
        traceId: state.traceId,
        policyId: doc.proposalDocumentId,
      });
      doc.pageCount = parsed.pageCount;
      doc.planHash = plan.planHash;
      doc.sections = plan.sections;
      doc.sectionAttempts = {};
      doc.phase = "sections";
      await log(ctx, jobId, `Planned ${plan.sections.length} section(s) for ${doc.fileName}`);
    } catch (error) {
      return {
        kind: "error",
        error: `Parsing ${doc.fileName} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // 2. Advance section extraction for every document still in that phase.
  const route = await sectionExtractionRoute(ctx, clientOrgId);
  for (const doc of state.documents) {
    if (doc.phase !== "sections" || !doc.sections || !doc.planHash) continue;
    const existing = await loadSectionResultArtifacts(ctx, {
      jobId,
      proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
    });
    let docFailed: string | undefined;
    for (const section of doc.sections) {
      const stored = existing.get(section.sectionId);
      if (stored && stored.planHash === doc.planHash) continue;
      const attempt = doc.sectionAttempts?.[section.sectionId] ?? 0;
      const invocationKey = proposalSectionInvocationKey({
        jobId,
        documentId: doc.proposalDocumentId,
        planHash: doc.planHash,
        section,
        attempt,
      });
      const outcome = await runSectionJob(ctx, {
        invocationKey,
        allowSubmission: true,
        orgId: clientOrgId,
        policyId: `${jobId}:${doc.proposalDocumentId}`,
        traceId: state.traceId,
        section,
        pageCount: doc.pageCount ?? section.pageEnd,
        route,
        loadPdf: () => loadDocumentBytes(ctx, doc.fileId),
      });
      if (outcome.status === "succeeded") {
        await saveArtifact(ctx, {
          jobId,
          proposalId,
          proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
          kind: "section_result",
          value: {
            sectionId: section.sectionId,
            kind: section.kind,
            output: outcome.output,
            planHash: doc.planHash,
          } satisfies SectionResultArtifactValue,
        });
        await log(ctx, jobId, `${sectionLabel(section)} succeeded for ${doc.fileName}`);
        continue;
      }
      if (outcome.status === "pending") {
        waiting = true;
        continue;
      }
      // failed or not_submitted
      const nextAttempt = attempt + 1;
      doc.sectionAttempts = { ...doc.sectionAttempts, [section.sectionId]: nextAttempt };
      if (nextAttempt > SECTION_AUTO_RETRIES) {
        docFailed = `${sectionLabel(section)} failed for ${doc.fileName}: ${
          outcome.status === "failed" ? outcome.error : "not submitted"
        }`;
        break;
      }
      waiting = true;
    }
    if (docFailed) {
      return { kind: "error", error: docFailed };
    }
    const refreshed = await loadSectionResultArtifacts(ctx, {
      jobId,
      proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
    });
    const allDone = doc.sections.every((section) => {
      const stored = refreshed.get(section.sectionId);
      return stored && stored.planHash === doc.planHash;
    });
    if (allDone) {
      doc.phase = "quote_terms";
    }
  }

  // 3. Advance the quote-terms supplemental call for every merged-ready document.
  for (const doc of state.documents) {
    if (doc.phase !== "quote_terms") continue;
    const merged = await mergeDocument(ctx, jobId, doc);
    if (!merged) {
      return {
        kind: "error",
        error: `Could not merge section results for ${doc.fileName}; retry to resume the extraction`,
      };
    }
    const evidence = evidenceItemsFromProfile(merged.operationalProfile);
    const attempt = doc.quoteTermsAttempt ?? 0;
    const evidenceHash = extractionContractHash(evidence);
    const invocationKey = proposalQuoteTermsInvocationKey({
      jobId,
      documentId: doc.proposalDocumentId,
      evidenceHash,
      attempt,
    });
    const outcome = await runProposalQuoteTermsJob(ctx, {
      invocationKey,
      allowSubmission: true,
      orgId: clientOrgId,
      documentId: doc.proposalDocumentId,
      traceId: state.traceId,
      evidence,
      route,
    });
    if (outcome.status === "succeeded") {
      const validNodeIds = new Set(merged.operationalProfile.sourceNodeIds);
      const validSpanIds = new Set(merged.operationalProfile.sourceSpanIds);
      const validated = validateQuoteTerms(outcome.output, validNodeIds, validSpanIds);
      await saveArtifact(ctx, {
        jobId,
        proposalId,
        proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
        kind: "quote_terms",
        value: validated,
      });
      doc.phase = "merged";
      continue;
    }
    if (outcome.status === "pending") {
      waiting = true;
      continue;
    }
    const nextAttempt = attempt + 1;
    if (nextAttempt > QUOTE_TERMS_AUTO_RETRIES) {
      await log(
        ctx,
        jobId,
        `Quote-terms extraction failed for ${doc.fileName}; continuing without the quote-terms supplement: ${
          outcome.status === "failed" ? outcome.error : "not submitted"
        }`,
        "warn",
      );
      doc.phase = "merged";
      continue;
    }
    doc.quoteTermsAttempt = nextAttempt;
    waiting = true;
  }

  if (state.documents.some((doc) => doc.phase !== "merged")) {
    return waiting ? { kind: "pending", state } : { kind: "continue", state };
  }

  // 4. Every document merged: aggregate, persist document-qualified evidence, complete.
  const extracted: ProposalDocumentExtraction[] = [];
  const spanRows: Record<string, unknown>[] = [];
  const nodeRows: Record<string, unknown>[] = [];
  const now = nowMs();
  for (const doc of state.documents) {
    const merged = await mergeDocument(ctx, jobId, doc);
    if (!merged) {
      return {
        kind: "error",
        error: `Could not merge section results for ${doc.fileName}; retry to resume the extraction`,
      };
    }
    const parsed = await loadLatestArtifact<ParsedSourceArtifact>(ctx, {
      jobId,
      proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
      kind: "parsed_source",
    });
    const quoteTerms = await loadLatestArtifact<ProposalQuoteTerms>(ctx, {
      jobId,
      proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
      kind: "quote_terms",
    });
    extracted.push({
      proposalDocumentId: doc.proposalDocumentId,
      fileName: doc.fileName,
      document: merged.document,
      parties: merged.operationalProfile.parties,
      supplemental: quoteTerms,
    });
    const sourceTree = normalizeSourceTree([], parsed?.sourceSpans ?? [], doc.proposalDocumentId);
    for (const span of parsed?.sourceSpans ?? []) {
      spanRows.push({
        orgId: clientOrgId,
        proposalId,
        proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
        extractionFingerprint,
        documentId: span.documentId ?? doc.proposalDocumentId,
        spanId: span.id,
        pageStart: span.pageStart,
        pageEnd: span.pageEnd,
        text: span.text,
        textHash: span.textHash ?? span.id,
        bbox: span.bbox,
        metadata: span.metadata,
        createdAt: now,
      });
    }
    for (const node of sourceTree) {
      nodeRows.push({
        orgId: clientOrgId,
        proposalId,
        proposalDocumentId: doc.proposalDocumentId as Id<"procurementProposalDocuments">,
        extractionFingerprint,
        documentId: node.documentId || doc.proposalDocumentId,
        nodeId: node.id,
        parentNodeId: node.parentId,
        kind: node.kind,
        title: node.title,
        textExcerpt: node.textExcerpt,
        sourceSpanIds: node.sourceSpanIds,
        pageStart: node.pageStart,
        pageEnd: node.pageEnd,
        order: node.order,
        path: node.path,
        metadata: {
          ...(node.metadata ?? {}),
          ...(node.description ? { description: node.description } : {}),
          ...(node.bbox === undefined ? {} : { bbox: node.bbox }),
        },
        createdAt: now,
      });
    }
  }
  const extractedOffer = aggregateProposalDocuments(extracted);
  return { kind: "done", extractedOffer, spanRows, nodeRows };
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function deleteOtherProposalSources(
  ctx: ActionCtx,
  proposalId: Id<"procurementProposals">,
  keepFingerprint: string,
): Promise<void> {
  for (const owner of [internalApi.proposalSourceSpans, internalApi.proposalSourceNodes]) {
    let done = false;
    while (!done) {
      const result = (await ctx.runMutation(owner.deleteOtherFingerprintsBatch, {
        proposalId,
        keepFingerprint,
        limit: STORAGE_BATCH_SIZE,
      })) as { done: boolean };
      done = result.done;
    }
  }
}

/**
 * Durable per-job advance tick: acquires the run lease (like the policy
 * pipeline's `pipelineAcquireLease`), does one bounded unit of work, then
 * either reschedules itself or resolves the job terminally. A watchdog
 * reschedules a stuck advance after the lease expires; it is cancelled on a
 * clean tick completion, mirroring `advanceLeasedPhase` in
 * `convex/actions/policyExtraction.ts`.
 */
export const advance = internalAction({
  args: { jobId: v.id("procurementProposalExtractionJobs") },
  handler: async (ctx, args) => {
    const leaseId = randomId();
    const leaseExpiresAt = nowMs() + ADVANCE_LEASE_MS;
    const acquired = await ctx.runMutation(
      internalApi.proposalExtraction.acquireLeaseInternal,
      { jobId: args.jobId, leaseId, leaseExpiresAt },
    );
    if (!acquired) return null;

    const watchdogId = await ctx.scheduler.runAfter(
      Math.max(0, leaseExpiresAt - nowMs() + ADVANCE_LEASE_WATCHDOG_GRACE_MS),
      internal.actions.proposalExtraction.advance,
      { jobId: args.jobId },
    );

    let state: PipelineState;
    const existingCheckpoint = acquired.checkpoint as
      | { state: PipelineState; createdAt: number }
      | undefined
      | null;
    if (existingCheckpoint?.state) {
      state = existingCheckpoint.state;
    } else {
      const documents: Array<{
        _id: Id<"procurementProposalDocuments">;
        fileId: Id<"_storage">;
        fileName: string;
      }> = await ctx.runQuery(internalApi.proposalExtraction.listDocumentsInternal, {
        proposalId: acquired.proposalId,
      });
      state = {
        traceId: randomId(),
        documents: documents.map((document) => ({
          proposalDocumentId: document._id,
          fileId: document.fileId,
          fileName: document.fileName,
          phase: "pending",
        })),
      };
    }

    try {
      const result = await runTick(
        ctx,
        args.jobId,
        acquired.proposalId,
        acquired.clientOrgId,
        acquired.extractionFingerprint,
        state,
      );

      if (result.kind === "error") {
        await ctx.runMutation(internalApi.proposalExtraction.failJobInternal, {
          jobId: args.jobId,
          leaseId,
          error: result.error,
        });
        await ctx.scheduler.cancel(watchdogId);
        return null;
      }

      if (result.kind === "done") {
        for (const batch of chunks(result.spanRows, STORAGE_BATCH_SIZE)) {
          await ctx.runMutation(internalApi.proposalSourceSpans.insertBatch, { spans: batch });
        }
        for (const batch of chunks(result.nodeRows, STORAGE_BATCH_SIZE)) {
          await ctx.runMutation(internalApi.proposalSourceNodes.insertBatch, { nodes: batch });
        }
        const completed = await ctx.runMutation(
          internalApi.proposalExtraction.completeJobInternal,
          { jobId: args.jobId, leaseId, extractedOffer: result.extractedOffer },
        );
        await ctx.scheduler.cancel(watchdogId);
        if (completed) {
          await deleteOtherProposalSources(
            ctx,
            acquired.proposalId,
            acquired.extractionFingerprint,
          ).catch((error) => {
            console.warn("Could not remove superseded proposal source evidence", error);
          });
        }
        return null;
      }

      const saved = await ctx.runMutation(
        internalApi.proposalExtraction.saveCheckpointForLeaseInternal,
        { jobId: args.jobId, leaseId, state: result.state },
      );
      await ctx.scheduler.cancel(watchdogId);
      if (saved) {
        await ctx.scheduler.runAfter(
          result.kind === "pending" ? ROUTER_JOB_POLL_DELAY_MS : 0,
          internal.actions.proposalExtraction.advance,
          { jobId: args.jobId },
        );
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await log(ctx, args.jobId, `Proposal extraction advance threw: ${message}`, "error");
      await ctx.runMutation(internalApi.proposalExtraction.failJobInternal, {
        jobId: args.jobId,
        leaseId,
        error: message,
      });
      await ctx.scheduler.cancel(watchdogId);
      return null;
    }
  },
});

/**
 * Requeues jobs whose advance chain appears to have died (a "pending" job
 * never picked up, or a "running" job whose lease has been expired well
 * past the watchdog's own reclaim window). Safety net only; normal recovery
 * goes through the per-lease watchdog scheduled by `advance` itself.
 */
export const sweepStale = internalAction({
  args: {},
  handler: async (ctx) => {
    const stale: Array<{ _id: Id<"procurementProposalExtractionJobs"> }> =
      await ctx.runQuery(internalApi.proposalExtraction.listStaleJobsInternal, {
        olderThanMs: STALE_SWEEP_MS,
        limit: STALE_SWEEP_BATCH_LIMIT,
      });
    for (const job of stale) {
      await ctx.scheduler.runAfter(0, internal.actions.proposalExtraction.advance, {
        jobId: job._id,
      });
    }
    return { requeued: stale.length };
  },
});
