import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import {
  classifyPolicyIntake,
  parseRelationshipChoice,
  rankExistingPolicyCandidates,
} from "./policyIntakeClassification";

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

const pages = [
  { page: 1, text: "DECLARATIONS\nPolicy Number: GL-2026-001\nNamed Insured: Acme LLC" },
  { page: 2, text: "Commercial General Liability Coverage Form" },
];
const existingPolicies = [
  { policyId: "policy_old", policyNumber: "GL-2025-001", namedInsured: "Acme LLC", carrier: "Hartford" },
];

beforeEach(() => {
  decide.mockReset();
});

describe("classifyPolicyIntake", () => {
  it("asks classification and relationship in one decide call", async () => {
    respond({
      classification: choice("bound_policy_document", 0.93),
      relationship: choice("renewal__policy_old", 0.81),
    });

    const decision = await classifyPolicyIntake({
      ctx,
      orgId,
      pageCount: 2,
      pages,
      existingPolicies,
      traceId: "trace-1",
    });

    expect(decide).toHaveBeenCalledTimes(1);
    const [request, options] = decide.mock.calls[0]!;
    expect(Object.keys(request.questions)).toEqual(["classification", "relationship"]);
    expect(request.trace).toEqual({ traceId: "trace-1" });
    expect(options).toEqual({ telemetry: ctx });
    const relationship = request.questions.relationship;
    expect(relationship?.type === "choice" && Object.keys(relationship.criteria)).toEqual([
      "new_policy",
      "renewal__policy_old",
      "endorsement__policy_old",
      "duplicate__policy_old",
      "unknown",
    ]);
    expect(decision).toMatchObject({
      classification: "bound_policy_document",
      shouldExtract: true,
      confidence: 0.93,
      relationship: { kind: "renewal", policyId: "policy_old", confidence: 0.81 },
    });
  });

  it("keeps extracting and leaves relationship unknown when Jev is not confident", async () => {
    respond({
      classification: choice("non_insurance", 0.4),
      relationship: choice("duplicate__policy_old", 0.55),
    });

    const decision = await classifyPolicyIntake({ ctx, orgId, pageCount: 2, pages, existingPolicies });

    expect(decision).toMatchObject({
      classification: "non_insurance",
      shouldExtract: true,
      relationship: { kind: "unknown", confidence: 0 },
    });
  });

  it("rejects confident non-policy documents with the original thresholds", async () => {
    respond({ classification: choice("insurance_related_but_not_bound_policy", 0.7) });

    const decision = await classifyPolicyIntake({ ctx, orgId, pageCount: 2, pages, existingPolicies: [] });

    expect(decide.mock.calls[0]![0].questions.relationship).toBeUndefined();
    expect(decision.shouldExtract).toBe(false);
    expect(decision.relationship.kind).toBe("unknown");
  });

  it("continues extraction when the router fails", async () => {
    decide.mockRejectedValueOnce(new Error("router down"));

    const decision = await classifyPolicyIntake({ ctx, orgId, pageCount: 2, pages, existingPolicies });

    expect(decision).toMatchObject({
      classification: "unknown",
      shouldExtract: true,
      confidence: 0,
      relationship: { kind: "unknown" },
    });
    expect(decision.reason).toContain("router down");
  });

  it("short-circuits specimen policies without a decide call", async () => {
    const decision = await classifyPolicyIntake({
      ctx,
      orgId,
      pageCount: 1,
      pages: [{ page: 1, text: "SPECIMEN POLICY\nSaint Lawrence Specialty Insurance Company" }],
      existingPolicies,
    });

    expect(decide).not.toHaveBeenCalled();
    expect(decision).toMatchObject({
      classification: "specimen_policy_document",
      shouldExtract: true,
      relationship: { kind: "unknown" },
    });
  });

  it("asks only the relationship question when page evidence is incomplete", async () => {
    respond({ relationship: choice("endorsement__policy_old", 0.9) });

    const decision = await classifyPolicyIntake({
      ctx,
      orgId,
      pageCount: 3,
      pages,
      existingPolicies,
    });

    expect(Object.keys(decide.mock.calls[0]![0].questions)).toEqual(["relationship"]);
    expect(decision).toMatchObject({
      classification: "unknown",
      shouldExtract: true,
      relationship: { kind: "endorsement", policyId: "policy_old" },
    });
  });

  it("skips the call when evidence is incomplete and there is nothing to relate", async () => {
    const decision = await classifyPolicyIntake({ ctx, orgId, pageCount: 3, pages, existingPolicies: [] });

    expect(decide).not.toHaveBeenCalled();
    expect(decision.classification).toBe("unknown");
    expect(decision.shouldExtract).toBe(true);
  });
});

describe("relationship candidates", () => {
  it("parses option keys back to kind and policy id", () => {
    const ids = new Set(["policy_a"]);
    expect(parseRelationshipChoice("new_policy", ids)).toEqual({ kind: "new_policy" });
    expect(parseRelationshipChoice("duplicate__policy_a", ids)).toEqual({ kind: "duplicate", policyId: "policy_a" });
    expect(parseRelationshipChoice("renewal__policy_b", ids)).toEqual({ kind: "unknown" });
    expect(parseRelationshipChoice("merge__policy_a", ids)).toEqual({ kind: "unknown" });
    expect(parseRelationshipChoice("unknown", ids)).toEqual({ kind: "unknown" });
  });

  it("caps candidates at 20 and ranks policies mentioned in the document first", () => {
    const candidates = Array.from({ length: 25 }, (_, index) => ({
      policyId: `policy_${index}`,
      policyNumber: `POL-${index}`,
    }));
    const ranked = rankExistingPolicyCandidates(candidates, "Renewal of policy POL-24");
    expect(ranked).toHaveLength(20);
    expect(ranked[0]?.policyId).toBe("policy_24");
  });
});
