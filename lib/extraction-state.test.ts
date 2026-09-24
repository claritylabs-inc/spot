import { describe, expect, test } from "vitest";
import { NON_INSURANCE_DOCUMENT_ERROR } from "@/convex/lib/policyDocumentGate";
import { extractionState, hasFinalExtraction } from "./extraction-state";

describe("extractionState", () => {
  test("treats placeholder and preview data as extracting until final", () => {
    for (const policy of [
      {},
      { pipelineStatus: "idle", extractionDataStage: "placeholder" },
      { pipelineStatus: "running", extractionDataStage: "preview" },
      { pipelineStatus: "paused" },
      // Preview fields never unlock final-only workflows, even if the run row
      // already reports complete.
      { pipelineStatus: "complete", extractionDataStage: "preview" },
    ]) {
      const state = extractionState(policy);
      expect(state).toMatchObject({
        kind: "extracting",
        canCancel: true,
        canReextract: false,
      });
      expect(hasFinalExtraction(state)).toBe(false);
    }
  });

  test("final data is ready, or needs review while questions are open", () => {
    expect(
      extractionState({ pipelineStatus: "complete", extractionDataStage: "final" }),
    ).toEqual({ kind: "ready", canCancel: false, canReextract: true });
    expect(extractionState({ pipelineStatus: "complete" }).kind).toBe("ready");
    expect(extractionState({ extractionDataStage: "final" }).kind).toBe("ready");

    const review = {
      questions: [
        { id: "a", status: "confirmed" },
        { id: "b", status: "open" },
      ],
    };
    const state = extractionState({
      pipelineStatus: "complete",
      extractionDataStage: "final",
      extractionReview: review,
    });
    expect(state.kind).toBe("needs_review");
    expect(hasFinalExtraction(state)).toBe(true);
    expect(
      extractionState({
        pipelineStatus: "complete",
        extractionReview: { questions: [{ id: "a", status: "dismissed" }] },
      }).kind,
    ).toBe("ready");
  });

  test("separates rejected documents from failed runs", () => {
    expect(
      extractionState({
        pipelineStatus: "error",
        pipelineError: NON_INSURANCE_DOCUMENT_ERROR,
        extractionDataStage: "placeholder",
      }),
    ).toEqual({ kind: "not_a_policy", canCancel: false, canReextract: true });
    const failed = extractionState({
      pipelineStatus: "error",
      pipelineError: "Cancelled by user",
      extractionDataStage: "final",
    });
    expect(failed).toEqual({
      kind: "failed",
      canCancel: false,
      canReextract: true,
    });
    expect(hasFinalExtraction(failed)).toBe(false);
  });

  test("reports only usable section progress", () => {
    expect(
      extractionState({
        pipelineStatus: "running",
        extractionProgress: { done: 3, total: 8 },
      }).progress,
    ).toEqual({ done: 3, total: 8 });
    expect(
      extractionState({
        pipelineStatus: "running",
        extractionProgress: { done: 0, total: 0 },
      }).progress,
    ).toBeUndefined();
    expect(
      extractionState({
        pipelineStatus: "complete",
        extractionProgress: { done: 8, total: 8 },
      }).progress,
    ).toBeUndefined();
  });
});
