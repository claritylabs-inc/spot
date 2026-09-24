"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { searchPolicyDocument } from "./aiUtils";
import type { SpotSourceSpan } from "./pdfSourceSpans";
import { extractPdfText } from "./pdfText";
import { formatSourceSpanLabel } from "./policyDocumentStructure";
import {
  normalizedSearchText,
  uniqueSearchTerms,
} from "./searchTokenizer";

type LookupResult = Record<string, unknown>;
type SourceSpanDoc = {
  spanId?: string;
  documentId?: string;
  sourceKind?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  sourceUnit?: string;
  parentSpanId?: string;
  table?: Record<string, unknown>;
  location?: Record<string, unknown>;
  text: string;
  textHash?: string;
  semanticScore?: number;
  bbox?: Array<{ page: number; x: number; y: number; width: number; height: number }>;
  metadata?: Record<string, unknown>;
};

type SourceNodeDoc = {
  nodeId: string;
  documentId?: string;
  parentNodeId?: string;
  kind: string;
  title: string;
  description: string;
  textExcerpt?: string;
  sourceSpanIds: string[];
  pageStart?: number;
  pageEnd?: number;
  path: string;
  metadata?: Record<string, unknown>;
  semanticScore?: number;
};

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function queryTerms(query: string): string[] {
  return uniqueSearchTerms(query, { minimumLength: 3 });
}

function scoreSpan(query: string, terms: string[], span: SourceSpanDoc): number {
  const text = normalizedSearchText(span.text);
  const normalizedQuery = normalizedSearchText(query);
  let score = normalizedQuery && text.includes(normalizedQuery) ? 6 : 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
  }
  if (typeof span.semanticScore === "number") score += Math.max(0, span.semanticScore * 4);
  return score;
}

function scoreNode(query: string, terms: string[], node: SourceNodeDoc): number {
  const text = normalizedSearchText(
    `${node.title} ${node.description} ${node.textExcerpt ?? ""}`,
  );
  const normalizedQuery = normalizedSearchText(query);
  let score = normalizedQuery && text.includes(normalizedQuery) ? 8 : 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
  }
  if (node.kind === "table_row" || node.kind === "schedule") score += 1.5;
  if (typeof node.semanticScore === "number") score += Math.max(0, node.semanticScore * 5);
  return score;
}

function sourceSpanIdsFromResult(result: LookupResult): string[] {
  const ids = result.sourceSpanIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
}

function attachSourceSpans(result: LookupResult, spans: Array<SourceSpanDoc & { score: number }>): LookupResult {
  const resultText = normalizedSearchText(
    `${textValue(result.title)} ${textValue(result.content)}`,
  );
  const citedIds = new Set(sourceSpanIdsFromResult(result));
  const matched = spans
    .filter((span) => {
      if (span.spanId && citedIds.has(span.spanId)) return true;
      if (span.score <= 0) return false;
      if (!resultText) return true;
      const title = normalizedSearchText(textValue(result.title));
      return (
        resultText.includes(normalizedSearchText(span.text.slice(0, 80))) ||
        (span.sectionId && title.includes(normalizedSearchText(span.sectionId))) ||
        span.score >= 2
      );
    })
    .slice(0, 3);

  if (matched.length === 0) return result;
  const sourceSpanIds = [
    ...citedIds,
    ...matched.map((span) => span.spanId).filter((id): id is string => Boolean(id)),
  ];
  return {
    ...result,
    evidenceSource: "extracted_data_and_original_pdf",
    originalPdfChecked: true,
    sourceSpanIds: [...new Set(sourceSpanIds)],
    sourceSpans: matched.map((span) => ({
      id: span.spanId,
      sourceKind: span.sourceKind,
      pageStart: span.pageStart,
      pageEnd: span.pageEnd,
      sectionId: span.sectionId,
      formNumber: span.formNumber,
      sourceUnit: span.sourceUnit,
      parentSpanId: span.parentSpanId,
      table: span.table,
      location: span.location,
      bbox: span.bbox,
      metadata: span.metadata,
      confidence: span.score >= 6 ? "high" : span.score >= 2 ? "medium" : "low",
      text: span.text.slice(0, 1200),
    })),
  };
}

function sourceOnlyResults(spans: Array<SourceSpanDoc & { score: number }>, maxResults: number): LookupResult[] {
  return spans
    .filter((span) => span.score > 0)
    .slice(0, maxResults)
    .map((span) => ({
      title: formatSourceSpanLabel(span),
      type: "original_pdf_source_span",
      evidenceSource: "original_pdf",
      originalPdfChecked: true,
      confidence: span.score >= 6 ? "high" : span.score >= 2 ? "medium" : "low",
      pages: span.pageStart ? `${span.pageStart}${span.pageEnd ? `-${span.pageEnd}` : ""}` : undefined,
      content: span.text.slice(0, 6000),
      sourceSpanIds: span.spanId ? [span.spanId] : [],
      sourceSpans: [{
        id: span.spanId,
        sourceKind: span.sourceKind,
        pageStart: span.pageStart,
        pageEnd: span.pageEnd,
        sectionId: span.sectionId,
        formNumber: span.formNumber,
        sourceUnit: span.sourceUnit,
        parentSpanId: span.parentSpanId,
        table: span.table,
        location: span.location,
        bbox: span.bbox,
        metadata: span.metadata,
        text: span.text.slice(0, 1200),
      }],
    }));
}

function sourceNodeOnlyResults(nodes: Array<SourceNodeDoc & { score: number }>, maxResults: number): LookupResult[] {
  return nodes
    .filter((node) => node.score > 0)
    .slice(0, maxResults)
    .map((node) => ({
      title: node.title,
      type: "policy_source_node",
      evidenceSource: "source_tree",
      originalPdfChecked: true,
      confidence: node.score >= 8 ? "high" : node.score >= 3 ? "medium" : "low",
      pages: node.pageStart ? `${node.pageStart}${node.pageEnd && node.pageEnd !== node.pageStart ? `-${node.pageEnd}` : ""}` : undefined,
      content: [node.description, node.textExcerpt].filter(Boolean).join("\n").slice(0, 6000),
      sourceNodeIds: [node.nodeId],
      sourceSpanIds: node.sourceSpanIds,
      sourceNodes: [{
        id: node.nodeId,
        kind: node.kind,
        path: node.path,
        title: node.title,
        description: node.description,
        textExcerpt: node.textExcerpt,
        sourceSpanIds: node.sourceSpanIds,
        pageStart: node.pageStart,
        pageEnd: node.pageEnd,
        metadata: node.metadata,
      }],
    }));
}

function toSourceSpanDoc(span: SpotSourceSpan): SourceSpanDoc {
  const metadataSourceUnit = typeof span.metadata?.sourceUnit === "string"
    ? span.metadata.sourceUnit
    : undefined;
  return {
    spanId: span.id,
    documentId: span.documentId,
    sourceKind: span.sourceKind,
    pageStart: span.pageStart,
    pageEnd: span.pageEnd,
    sectionId: span.sectionId,
    formNumber: span.formNumber,
    sourceUnit: span.sourceUnit ?? metadataSourceUnit,
    parentSpanId: span.parentSpanId,
    table: span.table,
    location: span.location,
    text: span.text,
    textHash: span.textHash ?? span.hash,
    bbox: span.bbox,
    metadata: span.metadata,
  };
}

async function loadStoredSourceSpans(
  ctx: ActionCtx,
  policyId: Id<"policies">,
): Promise<SourceSpanDoc[]> {
  return ctx.runQuery(internal.sourceSpans.listSpansByPolicyInternal, { policyId })
    .then((docs: SourceSpanDoc[]) => docs.map((doc) => ({
      spanId: doc.spanId,
      documentId: doc.documentId,
      sourceKind: doc.sourceKind,
      pageStart: doc.pageStart,
      pageEnd: doc.pageEnd,
      sectionId: doc.sectionId,
      formNumber: doc.formNumber,
      sourceUnit: doc.sourceUnit,
      parentSpanId: doc.parentSpanId,
      table: doc.table,
      location: doc.location,
      text: doc.text,
      textHash: doc.textHash,
      bbox: doc.bbox,
      metadata: doc.metadata,
    })))
    .catch(() => []);
}

async function loadStoredSourceNodes(
  ctx: ActionCtx,
  policyId: Id<"policies">,
): Promise<SourceNodeDoc[]> {
  return ctx.runQuery((internal as any).sourceNodes.listByPolicyInternal, { policyId })
    .then((docs: Array<Record<string, any>>) => docs.map((doc) => ({
      nodeId: doc.nodeId,
      documentId: doc.documentId,
      parentNodeId: doc.parentNodeId,
      kind: doc.kind,
      title: doc.title,
      description: doc.description,
      textExcerpt: doc.textExcerpt,
      sourceSpanIds: Array.isArray(doc.sourceSpanIds) ? doc.sourceSpanIds : [],
      pageStart: doc.pageStart,
      pageEnd: doc.pageEnd,
      path: doc.path,
      metadata: doc.metadata,
    })))
    .catch(() => []);
}

async function loadOriginalPdfSpans(
  ctx: ActionCtx,
  policy: Record<string, unknown>,
): Promise<SourceSpanDoc[]> {
  const fileId = policy.fileId as Id<"_storage"> | undefined;
  const policyId = policy._id as string | undefined;
  if (!fileId || !policyId) return [];

  const blob = await ctx.storage.get(fileId).catch(() => null);
  if (!blob) return [];

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { sourceSpans } = await extractPdfText({
    pdfBytes: bytes,
    documentId: policyId,
    sourceKind: "policy_pdf",
  });
  return sourceSpans.map(toSourceSpanDoc);
}

function dedupeSpans(spans: SourceSpanDoc[]): SourceSpanDoc[] {
  const byKey = new Map<string, SourceSpanDoc>();
  for (const span of spans) {
    const key = span.spanId ?? span.textHash ?? span.text.slice(0, 160);
    const existing = byKey.get(key);
    if (!existing || (span.semanticScore ?? 0) > (existing.semanticScore ?? 0)) {
      byKey.set(key, span);
    }
  }
  return [...byKey.values()];
}

function dedupeNodes(nodes: SourceNodeDoc[]): SourceNodeDoc[] {
  const byKey = new Map<string, SourceNodeDoc>();
  for (const node of nodes) {
    const key = node.nodeId;
    const existing = byKey.get(key);
    if (!existing || (node.semanticScore ?? 0) > (existing.semanticScore ?? 0)) {
      byKey.set(key, node);
    }
  }
  return [...byKey.values()];
}

export async function searchPolicyDocumentWithSourceSpans(
  ctx: ActionCtx,
  policy: Record<string, unknown>,
  query: string,
  maxResults = 8,
): Promise<Array<Record<string, unknown>> | string> {
  const base = searchPolicyDocument(policy, query, maxResults);
  const policyId = policy._id as Id<"policies"> | undefined;
  if (!policyId) return base;

  const terms = queryTerms(query);
  const storedNodes = await loadStoredSourceNodes(ctx, policyId);
  const rankedNodes = dedupeNodes(storedNodes)
    .map((node) => ({ ...node, score: scoreNode(query, terms, node) }))
    .filter((node) => node.score > 0)
    .sort((left, right) => right.score - left.score);

  let spans = await loadStoredSourceSpans(ctx, policyId);
  if (spans.length === 0) {
    spans = await loadOriginalPdfSpans(ctx, policy);
  }
  const rankedSpans = dedupeSpans(spans)
    .map((span) => ({ ...span, score: scoreSpan(query, terms, span) }))
    .filter((span) => span.score > 0)
    .sort((left, right) => right.score - left.score);

  if (Array.isArray(base)) {
    const augmented = base.map((result) => attachSourceSpans(result, rankedSpans));
    const sourceNodeEvidence = sourceNodeOnlyResults(rankedNodes, 4);
    const hasSourceBackedResult = augmented.some((result) =>
      Array.isArray(result.sourceSpanIds) && result.sourceSpanIds.length > 0,
    ) || sourceNodeEvidence.length > 0;
    const sourceEvidence = sourceOnlyResults(rankedSpans, hasSourceBackedResult ? 2 : 3);
    const seen = new Set(
      [...augmented, ...sourceNodeEvidence].flatMap((result) =>
        Array.isArray(result.sourceSpanIds) ? result.sourceSpanIds.map(String) : [],
      ),
    );
    const additionalEvidence = sourceEvidence.filter((result) => {
      const ids = Array.isArray(result.sourceSpanIds) ? result.sourceSpanIds.map(String) : [];
      return ids.length === 0 || ids.some((id) => !seen.has(id));
    });
    return [...augmented, ...sourceNodeEvidence, ...additionalEvidence].slice(0, maxResults);
  }

  const nodeResults = sourceNodeOnlyResults(rankedNodes, maxResults);
  if (nodeResults.length > 0) return nodeResults;
  const sourceResults = sourceOnlyResults(rankedSpans, maxResults);
  return sourceResults.length > 0 ? sourceResults : base;
}
