import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecideResponse } from "../contracts/cl-router/policy";
import type { Id } from "./_generated/dataModel";
import { evaluateCertificateRequestGateWithJev } from "./certificates";
import { clRouterDecide } from "./lib/clRouterClient";

vi.mock("./lib/clRouterClient", () => ({ clRouterDecide: vi.fn() }));

const ctx = { runMutation: vi.fn(async () => null) };
const request = {
  ctx,
  orgId: "org" as Id<"organizations">,
  policyId: "policy" as Id<"policies">,
  certificateHolder: "Acme LLC",
  requestedEndorsements: ["additional_insured"],
  traceId: "certificate-batch",
};
const scheduled = {
  name: "Acme LLC",
  scope: "Additional insured for the scheduled premises",
  endorsementTitle: "CG 20 10",
  sourceSpanIds: ["scheduled-acme"],
};
const policy = {
  operationalProfile: {
    additionalInsuredEligibility: {
      scheduledAdditionalInsureds: [scheduled],
      withoutEndorsement: [],
      requiresEndorsement: [
        {
          category: "Other parties",
          condition: "Other additional insureds must be added by endorsement",
          sourceSpanIds: ["endorsement-required"],
        },
      ],
    },
  },
};

function respond(
  selection: string,
  probability = 0.95,
  otherAnswers: DecideResponse["answers"] = {},
): void {
  vi.mocked(clRouterDecide).mockImplementationOnce(async (input) => {
    const question = input.questions.additional_insured;
    const choice =
      question?.type === "choice"
        ? (Object.keys(question.criteria).find((key) =>
            JSON.stringify(question.criteria[key]).includes(selection),
          ) ?? selection)
        : selection;
    return {
      contractVersion: 1,
      requestId: "gate-review",
      model: "jev-test",
      answers: {
        additional_insured: {
          type: "choice",
          choice,
          probabilities: { [choice]: probability },
          confidence: probability,
        },
        ...otherAnswers,
      },
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: { status: "unpriced", costNanoUsd: null },
      durationMs: 1,
    };
  });
}

beforeEach(() => {
  vi.mocked(clRouterDecide).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("certificate endorsement Jev gate", () => {
  it("allows a selected scheduled insured and cites only that candidate", async () => {
    respond("Acme LLC");
    const verdict = await evaluateCertificateRequestGateWithJev({
      ...request,
      policy,
    });
    expect(verdict).toMatchObject({
      status: "allowed",
      requiredChanges: ["additional_insured"],
      evidence: [{ sourceSpanIds: ["scheduled-acme"] }],
    });
    expect(verdict.evidence).toHaveLength(1);
    expect(clRouterDecide).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "certificate_endorsement_gate",
        trace: { traceId: "certificate-batch" },
      }),
      { telemetry: ctx },
    );
  });

  it("allows an existing automatic class with its own source spans", async () => {
    respond("Lessors");
    expect(
      await evaluateCertificateRequestGateWithJev({
        ...request,
        policy: {
          operationalProfile: {
            additionalInsuredEligibility: {
              withoutEndorsement: [
                {
                  category: "Lessors",
                  condition:
                    "Additional insured where required by written contract",
                  sourceSpanIds: ["automatic-lessors"],
                },
              ],
            },
          },
        },
      }),
    ).toMatchObject({
      status: "allowed",
      evidence: [{ sourceSpanIds: ["automatic-lessors"] }],
    });
  });

  it("holds when a new endorsement is required", async () => {
    respond("requires_endorsement");
    expect(
      await evaluateCertificateRequestGateWithJev({ ...request, policy }),
    ).toMatchObject({
      status: "held",
      reasonCode: "policy_change_required",
      evidence: [{ sourceSpanIds: ["endorsement-required"] }],
    });
  });

  it.each([
    ["ambiguous", 0.95],
    ["Acme LLC", 0.69],
    ["invented_candidate", 0.95],
  ])(
    "holds ambiguous or untrusted candidate %s at %s",
    async (selection, probability) => {
      respond(selection, probability);
      expect(
        await evaluateCertificateRequestGateWithJev({ ...request, policy }),
      ).toMatchObject({
        status: "held",
        reasonCode: "ambiguous_policy_evidence",
      });
    },
  );

  it("uses the configured shared threshold", async () => {
    vi.stubEnv("JEV_PROCEED_THRESHOLD", "0.9");
    respond("Acme LLC", 0.85);
    expect(
      await evaluateCertificateRequestGateWithJev({ ...request, policy }),
    ).toMatchObject({ status: "held" });
  });

  it.each([0.69, 0.95])(
    "requires every other endorsement to proceed (%s)",
    async (probability) => {
      respond("Acme LLC", 0.95, {
        waiver_of_subrogation: { type: "noul", noul: probability },
      });
      const verdict = await evaluateCertificateRequestGateWithJev({
        ...request,
        policy,
        requestedEndorsements: ["additional_insured", "waiver_of_subrogation"],
        sourceSpans: [
          {
            spanId: "waiver",
            text: "Waiver of subrogation applies in favor of Acme LLC.",
            pageStart: 6,
          },
        ],
      });
      expect(verdict.status).toBe(probability >= 0.7 ? "allowed" : "held");
      const questions = vi.mocked(clRouterDecide).mock.calls[0][0].questions;
      expect(questions.waiver_of_subrogation.type).toBe("noul");
      if (verdict.status === "allowed") {
        expect(verdict.evidence.flatMap((item) => item.sourceSpanIds)).toEqual([
          "scheduled-acme",
          "waiver",
        ]);
      }
    },
  );

  it("does not grant an endorsement without cited evidence even if Jev says yes", async () => {
    respond("Acme LLC", 0.95, {
      waiver_of_subrogation: { type: "noul", noul: 0.99 },
    });
    expect(
      await evaluateCertificateRequestGateWithJev({
        ...request,
        policy,
        requestedEndorsements: ["waiver_of_subrogation"],
      }),
    ).toMatchObject({ status: "held", reasonCode: "missing_policy_evidence" });
  });

  it("holds uncited policy projections without invoking Jev", async () => {
    expect(
      await evaluateCertificateRequestGateWithJev({
        ...request,
        policy: {
          operationalProfile: {
            additionalInsuredEligibility: {
              scheduledAdditionalInsureds: [
                { ...scheduled, sourceSpanIds: [] },
              ],
            },
          },
        },
      }),
    ).toMatchObject({ status: "held", reasonCode: "missing_policy_evidence" });
    expect(clRouterDecide).not.toHaveBeenCalled();
  });

  it("never offers a named insured requiring review as an allowing candidate", async () => {
    respond("ambiguous");
    expect(
      await evaluateCertificateRequestGateWithJev({
        ...request,
        policy: {
          operationalProfile: {
            additionalInsureds: [{ ...scheduled, status: "review_required" }],
          },
        },
      }),
    ).toMatchObject({ status: "held" });
    const question =
      vi.mocked(clRouterDecide).mock.calls[0][0].questions.additional_insured;
    expect(
      question.type === "choice" && Object.keys(question.criteria),
    ).toEqual(["requires_endorsement", "ambiguous"]);
  });

  it("holds router failures with a fixed message and trace in the error log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(clRouterDecide).mockRejectedValueOnce(
      new Error("private router failure"),
    );
    const verdict = await evaluateCertificateRequestGateWithJev({
      ...request,
      policy,
    });
    expect(verdict).toMatchObject({
      status: "held",
      reasonCode: "ambiguous_policy_evidence",
    });
    expect(JSON.stringify(verdict)).not.toContain("private router failure");
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ traceId: "certificate-batch" }),
    );
  });

  it("allows plain certificates without an endorsement decision", async () => {
    expect(
      await evaluateCertificateRequestGateWithJev({
        ...request,
        requestedEndorsements: [],
      }),
    ).toEqual({
      status: "allowed",
      requiredChanges: [],
      evidence: [],
    });
    expect(clRouterDecide).not.toHaveBeenCalled();
  });
});
