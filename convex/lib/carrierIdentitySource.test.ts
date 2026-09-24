import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  buildCarrierIdentityFromSourceEvidence,
  resolveCarrierIdentityDecision,
  type CarrierIdentityDecision,
  type CarrierSourceNode,
} from "./carrierIdentitySource";
import { clRouterDecide } from "./clRouterClient";

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

const canonicalText =
  "Lloyd's Underwriters led by Canonical Managing Agency Limited Syndicate 1234";
const underlyingText =
  "Underlying policy: Lloyd's Underwriters led by Unrelated Managing Agency Limited Syndicate 1111 and Syndicate 2222";
const sourceSpans = [
  { id: "canonical-span", text: canonicalText, pageStart: 1 },
  { id: "underlying-span", text: underlyingText, pageStart: 4 },
];
const sourceTree: CarrierSourceNode[] = [
  {
    id: "canonical-node",
    kind: "section",
    title: "Insurer",
    description: canonicalText,
    textExcerpt: canonicalText,
    sourceSpanIds: ["canonical-span"],
    order: 0,
  },
  {
    id: "underlying-node",
    kind: "section",
    title: "Underlying policy",
    description: underlyingText,
    textExcerpt: underlyingText,
    sourceSpanIds: ["underlying-span"],
    order: 1,
  },
];
const operationalProfile = {
  parties: [{
    role: "carrier",
    name: "Lloyd's Underwriters",
    sourceNodeIds: ["canonical-node"],
    sourceSpanIds: ["canonical-span"],
  }],
};

beforeEach(() => {
  decide.mockReset();
});

describe("resolveCarrierIdentityDecision", () => {
  it("lets Jev choose among deterministic candidates in one call", async () => {
    // Lloyd's clauses come first, most specific evidence first.
    respond({ insurer: choice("candidate_0", 0.92) });

    const decision = await resolveCarrierIdentityDecision({
      ctx,
      orgId,
      operationalProfile,
      sourceTree,
      sourceSpans,
      traceId: "trace-1",
    });

    expect(decide).toHaveBeenCalledTimes(1);
    const [request, options] = decide.mock.calls[0]!;
    expect(options).toEqual({ telemetry: ctx });
    expect(request.trace).toEqual({ traceId: "trace-1" });
    const question = request.questions.insurer;
    expect(question?.type === "choice" && Object.keys(question.criteria)).toEqual([
      "candidate_0",
      "candidate_1",
      "candidate_2",
      "none",
    ]);
    expect(decision).toEqual({
      version: "carrier-identity-decision-v1",
      insurerLegalName: "Canonical Managing Agency Limited, Syndicate No. 1234",
      relationship: "lloyds_syndicate",
      confidence: 0.92,
      sourceSpanIds: ["canonical-span"],
    });
  });

  it("returns no name and a review reason when Jev is not confident", async () => {
    respond({ insurer: choice("candidate_1", 0.45) });

    const decision = await resolveCarrierIdentityDecision({
      ctx,
      orgId,
      operationalProfile,
      sourceTree,
      sourceSpans,
    });

    expect(decision).toMatchObject({
      insurerLegalName: null,
      relationship: "unknown",
      confidence: 0.45,
    });
    expect(decision?.reviewReason).toContain("confirm the issuing insurer");
    // Without a chosen name the deterministic path still applies.
    expect(buildCarrierIdentityFromSourceEvidence({
      operationalProfile,
      sourceTree,
      sourceSpans,
      carrierDecision: decision,
    })?.displayName).toBe("Canonical Managing Agency Limited");
  });

  it("treats a confident none as no decision without review", async () => {
    respond({ insurer: choice("none", 0.9) });

    const decision = await resolveCarrierIdentityDecision({
      ctx,
      orgId,
      operationalProfile,
      sourceTree,
      sourceSpans,
    });

    expect(decision).toMatchObject({ insurerLegalName: null, relationship: "unknown" });
    expect(decision?.reviewReason).toBeUndefined();
  });

  it("keeps the deterministic identity when the router fails", async () => {
    decide.mockRejectedValueOnce(new Error("router down"));

    await expect(resolveCarrierIdentityDecision({
      ctx,
      orgId,
      operationalProfile,
      sourceTree,
      sourceSpans,
    })).resolves.toBeNull();
  });

  it("skips the call when a single extracted party is the only candidate", async () => {
    const decision = await resolveCarrierIdentityDecision({
      ctx,
      orgId,
      operationalProfile: {
        parties: [{
          role: "insurer",
          name: "HDI Global Specialty SE",
          sourceNodeIds: [],
          sourceSpanIds: ["hdi-span"],
        }],
      },
      sourceTree: [],
      sourceSpans: [{ id: "hdi-span", text: "Insurer: HDI Global Specialty SE" }],
    });

    expect(decision).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("buildCarrierIdentityFromSourceEvidence with a carrier decision", () => {
  const decision = (
    insurerLegalName: string,
    relationship: CarrierIdentityDecision["relationship"],
  ): CarrierIdentityDecision => ({
    version: "carrier-identity-decision-v1",
    insurerLegalName,
    relationship,
    confidence: 0.9,
    sourceSpanIds: [],
  });

  it("uses the decided candidate over the provenance-linked clause", () => {
    const identity = buildCarrierIdentityFromSourceEvidence({
      operationalProfile,
      sourceTree,
      sourceSpans,
      carrierDecision: decision(
        "Unrelated Managing Agency Limited, Syndicate No. 1111",
        "lloyds_syndicate",
      ),
    });

    expect(identity).toMatchObject({
      displayName: "Unrelated Managing Agency Limited",
      legalEntities: [
        { name: "Unrelated Managing Agency Limited, Syndicate No. 1111" },
        { name: "Unrelated Managing Agency Limited, Syndicate No. 2222" },
      ],
      legalEntityRelationship: "and",
      sourceSpanIds: ["underlying-span"],
    });
  });

  it("can choose the extracted party instead of a parsed clause", () => {
    const identity = buildCarrierIdentityFromSourceEvidence({
      operationalProfile,
      sourceTree,
      sourceSpans,
      carrierDecision: decision("Lloyd's Underwriters", "issuing_insurer"),
    });

    expect(identity).toMatchObject({
      displayName: "Lloyd's Underwriters",
      legalEntities: [{ name: "Lloyd's Underwriters", sourceSpanIds: ["canonical-span"] }],
      legalEntityRelationship: "single",
    });
  });

  it("ignores a decision whose name is not a source candidate", () => {
    const identity = buildCarrierIdentityFromSourceEvidence({
      operationalProfile,
      sourceTree,
      sourceSpans,
      carrierDecision: decision("Hallucinated Insurance Company", "issuing_insurer"),
    });

    expect(identity?.displayName).toBe("Canonical Managing Agency Limited");
  });

  it("builds operating-name identities from the decided clause", () => {
    const text =
      "Alpha Insurance Company and/or Beta Assurance Company operating as Gamma Specialty";
    const identity = buildCarrierIdentityFromSourceEvidence({
      operationalProfile: {
        parties: [{
          role: "insurer",
          name: "Alpha Insurance Company",
          sourceNodeIds: [],
          sourceSpanIds: ["alpha-span"],
        }],
      },
      sourceTree: [],
      sourceSpans: [{ id: "alpha-span", text }],
      carrierDecision: decision("Alpha Insurance Company", "operating_name"),
    });

    expect(identity).toMatchObject({
      displayName: "Gamma Specialty",
      operatingName: "Gamma Specialty",
      legalEntities: [
        { name: "Alpha Insurance Company" },
        { name: "Beta Assurance Company" },
      ],
      legalEntityRelationship: "and_or",
    });
  });
});
