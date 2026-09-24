// Owner: P8 (docs/architecture/convex-section-extraction.md).
// View model for the operator Sections tab. Runs come from extraction trace
// sessions (one per upload or re-extraction); section rows come from the
// pipeline's section artifacts once the core pipeline is integrated.

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isNonInsuranceDocument } from "./policyDocumentGate";

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
};

export async function readRunSections(
  _ctx: QueryCtx,
  _runId: Id<"policyExtractionRuns">,
): Promise<ExtractionRunSectionView[] | null> {
  return null; // wired to P3 section artifacts in a follow-up
}

export async function readSectionFacts(
  _ctx: QueryCtx,
  _runId: Id<"policyExtractionRuns">,
  _sectionId: string,
): Promise<ExtractionSectionFactView[] | null> {
  return null; // wired to P3 section artifacts in a follow-up
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

export function extractionRunStatus(
  session: Pick<Doc<"policyExtractionTraceSessions">, "status" | "error">,
): ExtractionRunView["status"] {
  if (session.status === "complete") return "succeeded";
  if (session.status === "error") {
    return isNonInsuranceDocument(session.error) ? "rejected" : "failed";
  }
  return session.status;
}
