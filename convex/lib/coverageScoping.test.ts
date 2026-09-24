import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import {
  applyCoverageDeclarationScoping,
  scopeCoveragesWithClassifier,
} from "./coverageScoping";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

type Answers = Awaited<ReturnType<typeof clRouterDecide>>["answers"];

const ctx = {} as ActionCtx;
const orgId = "org" as Id<"organizations">;
const decide = vi.mocked(clRouterDecide);

function respond(answers: Answers) {
  decide.mockResolvedValueOnce({
    contractVersion: 1,
    requestId: "decision",
    model: "jev-1.14.0",
    answers,
    usage: { inputTokens: 1, outputTokens: 1 },
    cost: { status: "unpriced", costNanoUsd: null },
    durationMs: 1,
  });
}

function choice(value: string, confidence: number) {
  return {
    type: "choice" as const,
    choice: value,
    probabilities: { [value]: confidence, other: 1 - confidence },
    confidence,
  };
}

const fields = {
  linesOfBusiness: ["CGL", "AUTOB"],
  coverages: [
    { name: "Hired and Non-Owned Auto Liability", limit: "$1,000,000", sourceSpanIds: ["span-hnoa"] },
    { name: "Blanket Additional Insured", limit: "Included", sourceSpanIds: ["span-ai"] },
    { name: "Medical Payments", limit: "$5,000", sourceSpanIds: ["span-med"] },
    { name: "Commercial General Liability", lineOfBusiness: "CGL", limit: "$2,000,000" },
  ],
};

function scope(input: Record<string, unknown> = fields) {
  return scopeCoveragesWithClassifier({
    ctx,
    orgId,
    fields: input,
    sourceSpans: [],
    nowMs: 1_000,
    traceId: "trace-1",
  });
}

function lines(result: Awaited<ReturnType<typeof scope>>) {
  return (result.fields.coverages as Array<Record<string, unknown>>).map((coverage) => coverage.lineOfBusiness);
}

beforeEach(() => {
  decide.mockReset();
});

describe("scopeCoveragesWithClassifier", () => {
  it("scopes a row at 0.70 and leaves it for review at 0.69", async () => {
    for (const [confidence, accepted] of [[0.69, false], [0.7, true]] as const) {
      respond({
        coverage_1: choice("CGL", confidence),
        coverage_2: choice("none", 0.9),
      });
      const result = await scope();
      expect(lines(result)[1]).toBe(accepted ? "CGL" : undefined);
      expect(result.review.questions).toHaveLength(accepted ? 0 : 1);
    }
  });

  it("asks one batched question per ambiguous coverage row", async () => {
    respond({
      coverage_1: choice("CGL", 0.9),
      coverage_2: choice("CGL", 0.85),
    });

    const result = await scope();

    expect(decide).toHaveBeenCalledTimes(1);
    const [request, options] = decide.mock.calls[0]!;
    expect(options).toEqual({ telemetry: ctx });
    expect(request.trace).toEqual({ traceId: "trace-1" });
    expect(Object.keys(request.questions)).toEqual(["coverage_1", "coverage_2"]);
    const question = request.questions.coverage_1;
    expect(question?.type === "choice" && Object.keys(question.criteria)).toEqual(["CGL", "AUTOB", "none"]);
    expect(lines(result)).toEqual(["AUTOB", "CGL", "CGL", "CGL"]);
    expect(result.classifiedCount).toBe(2);
    expect(result.review.questions).toEqual([]);
    expect(result.fields.extractionReview).toBeUndefined();
  });

  it("leaves low-confidence rows unscoped with a review question", async () => {
    respond({
      coverage_1: choice("AUTOB", 0.5),
      coverage_2: choice("none", 0.9),
    });

    const result = await scope();

    expect(lines(result)).toEqual(["AUTOB", undefined, undefined, "CGL"]);
    expect(result.classifiedCount).toBe(0);
    expect(result.review.questions).toHaveLength(1);
    expect(result.review.questions[0]).toMatchObject({
      kind: "coverage_line_of_business",
      status: "open",
      coverageName: "Blanket Additional Insured",
      recommendedOptionId: "line:AUTOB",
      options: [
        { id: "line:CGL", value: "CGL", coverage: { name: "Blanket Additional Insured", lineOfBusiness: "CGL" } },
        { id: "line:AUTOB", value: "AUTOB", coverage: { lineOfBusiness: "AUTOB" } },
      ],
      createdAt: 1_000,
    });
    expect(result.fields.extractionReview).toMatchObject({
      strategyVersion: "coverage-declaration-scope-v1",
      questions: [{ coverageName: "Blanket Additional Insured" }],
    });
  });

  it("falls back to rule-based scoping when the router fails", async () => {
    decide.mockRejectedValueOnce(new Error("router down"));

    const result = await scope();

    expect(result.classifiedCount).toBe(0);
    expect(result.fields).toEqual(
      applyCoverageDeclarationScoping({ fields, sourceSpans: [], nowMs: 1_000 }).fields,
    );
  });

  it("assigns single-line policies without a decide call", async () => {
    const result = await scope({
      linesOfBusiness: ["CGL"],
      coverages: [{ name: "Medical Payments", limit: "$5,000" }],
    });

    expect(decide).not.toHaveBeenCalled();
    expect(lines(result)).toEqual(["CGL"]);
  });
});
