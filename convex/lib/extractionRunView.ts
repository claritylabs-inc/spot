// Owner: P8 (docs/architecture/convex-section-extraction.md).
// View model for the operator Sections tab. Runs come from extraction trace
// sessions (one per upload or re-extraction); section rows come from the
// pipeline's section_plan / section_result artifacts.

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import {
  buildCitationIndex,
  resolveCitationWithIndex,
  type SectionCitation,
} from "./citationResolver";
import { isNonInsuranceDocument } from "./policyDocumentGate";
import type { SourceSpanLike } from "./sourceTree";

export type ExtractionRunSectionView = {
  sectionId: string;
  kind: string;
  pageStart: number;
  pageEnd: number;
  status: "pending" | "running" | "succeeded" | "failed";
  durationMs?: number;
  costUsd?: number;
  factCount?: number;
};

export type ExtractionSectionFactView = {
  label: string;
  value: string;
  citations: Array<{
    page: number;
    bbox: Array<{
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    sourceSpanIds: string[];
  }>;
};

export type ExtractionRunView = {
  /** One extraction attempt: the `policyExtractionTraceSessions` document ID. */
  runId: string;
  traceId?: string;
  startedAt: number;
  finishedAt?: number;
  trigger: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "rejected";
  durationMs?: number;
  costUsd?: number;
  /** `null` when the run has no section data (legacy and worker runs). */
  sections: ExtractionRunSectionView[] | null;
  /** Planned section count while the plan is still stored (running runs). */
  sectionTotal?: number;
};

const SECTION_ARTIFACT_LIMIT = 500;
const SECTION_SPAN_SCAN_LIMIT = 5_000;
const SECTION_FACT_LIMIT = 300;

type SectionResultMetadata = {
  status?: "succeeded" | "failed";
  planHash?: string;
  kind?: string;
  pageStart?: number;
  pageEnd?: number;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The run's stored plan (if still present) and its section results for that plan. */
async function currentSectionArtifacts(
  ctx: QueryCtx,
  run: Doc<"policyExtractionRuns">,
) {
  const [plans, results] = await Promise.all(
    (["section_plan", "section_result"] as const).map((kind) =>
      ctx.db
        .query("policyExtractionArtifacts")
        .withIndex("policy_kind", (q) =>
          q.eq("policyId", run.policyId).eq("kind", kind),
        )
        .take(SECTION_ARTIFACT_LIMIT),
    ),
  );
  const plan = plans
    .filter((artifact) => artifact.runId === run._id)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const runResults = results
    .filter((artifact) => artifact.runId === run._id && artifact.sectionId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const planHash =
    (recordOf(plan?.metadata).planHash as string | undefined) ??
    (recordOf(runResults[0]?.metadata).planHash as string | undefined);
  const sectionCount = recordOf(plan?.metadata).sectionCount;
  return {
    plan,
    sectionTotal: typeof sectionCount === "number" ? sectionCount : undefined,
    results: runResults.filter(
      (artifact) => recordOf(artifact.metadata).planHash === planHash,
    ),
  };
}

function sectionView(
  artifact: Doc<"policyExtractionArtifacts">,
): ExtractionRunSectionView | null {
  const metadata = recordOf(artifact.metadata) as SectionResultMetadata;
  if (
    !artifact.sectionId ||
    !metadata.status ||
    typeof metadata.pageStart !== "number" ||
    typeof metadata.pageEnd !== "number"
  ) {
    return null;
  }
  return {
    sectionId: artifact.sectionId,
    kind: metadata.kind ?? "other",
    pageStart: metadata.pageStart,
    pageEnd: metadata.pageEnd,
    status: metadata.status,
  };
}

export async function readRunSections(
  ctx: QueryCtx,
  runId: Id<"policyExtractionRuns">,
): Promise<ExtractionRunSectionView[] | null> {
  const run = await ctx.db.get(runId);
  if (!run) return null;
  const { plan, results } = await currentSectionArtifacts(ctx, run);
  if (!plan && results.length === 0) return null;
  return results
    .map(sectionView)
    .filter((section): section is ExtractionRunSectionView => !!section)
    .sort((a, b) => a.pageStart - b.pageStart);
}

/** Finished sections of the running plan; null once the plan is gone. */
export async function readRunProgress(
  ctx: QueryCtx,
  runId: Id<"policyExtractionRuns">,
): Promise<{ done: number; total: number } | null> {
  const run = await ctx.db.get(runId);
  if (!run) return null;
  const { sectionTotal, results } = await currentSectionArtifacts(ctx, run);
  if (!sectionTotal) return null;
  const done = results.filter(
    (artifact) => recordOf(artifact.metadata).status === "succeeded",
  ).length;
  return { done: Math.min(done, sectionTotal), total: sectionTotal };
}

/**
 * The pipeline keeps one run document per policy, so only the latest attempt
 * can still have section artifacts.
 */
export async function sectionRunForAttempt(
  ctx: QueryCtx,
  session: Doc<"policyExtractionTraceSessions">,
) {
  const latest = await ctx.db
    .query("policyExtractionTraceSessions")
    .withIndex("policy_started", (q) => q.eq("policyId", session.policyId))
    .order("desc")
    .first();
  if (latest?._id !== session._id) return null;
  return await ctx.db
    .query("policyExtractionRuns")
    .withIndex("policy", (q) => q.eq("policyId", session.policyId))
    .first();
}

/** The stored result for one section of an attempt, plus the spans on its pages. */
export async function readSectionSource(
  ctx: QueryCtx,
  attemptId: string,
  sectionId: string,
) {
  const sessionId = ctx.db.normalizeId(
    "policyExtractionTraceSessions",
    attemptId,
  );
  const session = sessionId ? await ctx.db.get(sessionId) : null;
  const run = session ? await sectionRunForAttempt(ctx, session) : null;
  if (!run) return null;
  const artifact = (await currentSectionArtifacts(ctx, run)).results.find(
    (row) => row.sectionId === sectionId,
  );
  const section = artifact ? sectionView(artifact) : null;
  if (!artifact || !section) return null;

  const spans: SourceSpanLike[] = [];
  let scanned = 0;
  for await (const span of ctx.db
    .query("sourceSpans")
    .withIndex("policy", (q) => q.eq("policyId", run.policyId))) {
    if (++scanned > SECTION_SPAN_SCAN_LIMIT) break;
    const pageStart = span.pageStart;
    const pageEnd = span.pageEnd ?? pageStart;
    if (
      pageStart === undefined ||
      pageEnd === undefined ||
      pageStart > section.pageEnd ||
      pageEnd < section.pageStart
    ) {
      continue;
    }
    spans.push({
      spanId: span.spanId,
      pageStart,
      pageEnd,
      sourceUnit: span.sourceUnit,
      text: span.text,
      bbox: span.bbox,
      metadata: span.metadata,
    });
  }
  return { section, storageId: artifact.storageId, spans };
}

type RawFact = { label: string; value: string; citations: SectionCitation[] };

function humanize(value: string) {
  const text = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim()
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function text(node: Record<string, unknown>, key: string) {
  const value = node[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function citationsOf(node: Record<string, unknown>): SectionCitation[] {
  return Array.isArray(node.citations)
    ? node.citations.filter(
        (citation): citation is SectionCitation =>
          typeof citation?.page === "number" &&
          typeof citation?.quote === "string",
      )
    : [];
}

function factFor(key: string, node: Record<string, unknown>) {
  const role = text(node, "role") ?? text(node, "field");
  if (role && (text(node, "name") || text(node, "value"))) {
    return {
      label: humanize(role),
      value: (text(node, "name") ?? text(node, "value"))!,
    };
  }
  const values = Array.isArray(node.values)
    ? node.values
        .map((item) => {
          const entry = recordOf(item);
          return text(entry, "label") && text(entry, "value")
            ? `${text(entry, "label")}: ${text(entry, "value")}`
            : undefined;
        })
        .filter(Boolean)
        .join(", ")
    : undefined;
  const label =
    text(node, "label") ??
    text(node, "name") ??
    text(node, "title") ??
    text(node, "term") ??
    text(node, "line") ??
    humanize(key);
  const value =
    text(node, "value") ??
    text(node, "amount") ??
    text(node, "limit") ??
    text(node, "summary") ??
    (values || undefined) ??
    text(node, "formNumber") ??
    text(node, "description");
  return value ? { label, value } : null;
}

/** Flattens a stored section output into cited label/value facts. */
export function sectionFacts(output: unknown): RawFact[] {
  const facts: RawFact[] = [];
  const visit = (value: unknown, key: string, prefix?: string) => {
    if (facts.length >= SECTION_FACT_LIMIT) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, prefix);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    let childPrefix = prefix;
    if (Array.isArray(node.citations)) {
      const fact = factFor(key, node);
      if (fact) {
        const label = prefix ? `${prefix} · ${fact.label}` : fact.label;
        facts.push({ label, value: fact.value, citations: citationsOf(node) });
        childPrefix = fact.label;
      }
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (childKey !== "citations") visit(child, childKey, childPrefix);
    }
  };
  visit(output, "summary");
  return facts;
}

export function resolveSectionFacts(
  facts: RawFact[],
  spans: SourceSpanLike[],
): ExtractionSectionFactView[] {
  const index = buildCitationIndex(spans);
  return facts.map((fact) => ({
    label: fact.label,
    value: fact.value,
    citations: fact.citations.map((citation) => {
      const resolved = resolveCitationWithIndex(citation, index);
      return {
        page: citation.page,
        bbox: resolved.bbox,
        sourceSpanIds: resolved.sourceSpanIds,
      };
    }),
  }));
}

/** Facts from one section's stored result, cited to stored source spans. */
export async function readSectionFacts(
  ctx: ActionCtx,
  attemptId: string,
  sectionId: string,
): Promise<{
  section: ExtractionRunSectionView;
  facts: ExtractionSectionFactView[];
} | null> {
  const source = await ctx.runQuery(
    internal.extractionProgress.sectionSourceInternal,
    { runId: attemptId, sectionId },
  );
  if (!source) return null;
  const blob = await ctx.storage.get(source.storageId);
  if (!blob) return null;
  const result = recordOf(JSON.parse(await blob.text()));
  const facts =
    result.status === "succeeded"
      ? resolveSectionFacts(sectionFacts(result.output), source.spans)
      : [];
  return {
    section: { ...source.section, factCount: facts.length },
    facts,
  };
}

export function extractionRunStatus(
  session: Pick<Doc<"policyExtractionTraceSessions">, "status" | "error">,
): ExtractionRunView["status"] {
  if (session.status === "complete") return "succeeded";
  if (session.status === "error") {
    return isNonInsuranceDocument(session.error) ? "rejected" : "failed";
  }
  return session.status;
}
