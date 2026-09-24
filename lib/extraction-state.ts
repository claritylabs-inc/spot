import { isNonInsuranceDocument } from "@/convex/lib/policyDocumentGate";

export type ExtractionStateKind =
  | "extracting"
  | "ready"
  | "needs_review"
  | "failed"
  | "not_a_policy";

export type ExtractionProgress = { done: number; total: number };

export type ExtractionState = {
  kind: ExtractionStateKind;
  progress?: ExtractionProgress;
  canCancel: boolean;
  canReextract: boolean;
};

export type ExtractionStatePolicy = {
  pipelineStatus?: string | null;
  pipelineError?: string | null;
  extractionDataStage?: string | null;
  extractionReview?: unknown;
  /** Section progress for the running extraction, when the query exposes it. */
  extractionProgress?: ExtractionProgress | null;
};

type ReviewQuestion = { id?: string; status?: string };

export function pendingExtractionReviewQuestions<T extends ReviewQuestion>(
  policy: { extractionReview?: unknown },
): T[] {
  const questions = (policy.extractionReview as { questions?: unknown } | null)
    ?.questions;
  if (!Array.isArray(questions)) return [];
  return (questions as T[]).filter(
    (question) =>
      question.id &&
      question.status !== "confirmed" &&
      question.status !== "dismissed",
  );
}

function validProgress(progress: ExtractionStatePolicy["extractionProgress"]) {
  if (!progress) return undefined;
  const { done, total } = progress;
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  return { done: Math.min(Math.max(0, done), total), total };
}

/**
 * The one extraction status model for every policy surface. Preview and
 * placeholder data count as extracting: partial fields render as they arrive.
 */
export function extractionState(policy: ExtractionStatePolicy): ExtractionState {
  const status = policy.pipelineStatus ?? undefined;
  const stage = policy.extractionDataStage ?? undefined;

  if (status === "error") {
    return {
      kind: isNonInsuranceDocument(policy.pipelineError)
        ? "not_a_policy"
        : "failed",
      canCancel: false,
      canReextract: true,
    };
  }

  const complete =
    status === "complete"
      ? !stage || stage === "final"
      : !status && stage === "final";
  if (!complete) {
    return {
      kind: "extracting",
      progress: validProgress(policy.extractionProgress),
      canCancel: true,
      canReextract: false,
    };
  }

  return {
    kind:
      pendingExtractionReviewQuestions(policy).length > 0
        ? "needs_review"
        : "ready",
    canCancel: false,
    canReextract: true,
  };
}

/** Final source-backed data exists, so COIs and policy changes are allowed. */
export function hasFinalExtraction(state: ExtractionState) {
  return state.kind === "ready" || state.kind === "needs_review";
}

export function extractingLabel(
  progress?: ExtractionProgress,
  noun = "policy",
) {
  const reading = `Reading ${noun}…`;
  return progress
    ? `${reading} ${progress.done} of ${progress.total} sections`
    : reading;
}

export const EXTRACTION_FAILED_MESSAGE =
  "We couldn't finish reading this policy.";

export const NOT_A_POLICY_MESSAGE =
  "This file doesn't look like an insurance policy, so Spot stopped reading it.";
