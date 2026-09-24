import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { clRouterDecide } from "./clRouterClient";
import {
  postProcessExtractionDocument,
  sourceNameSpellings,
  stripUngroundedSourceSensitiveValues,
} from "./extractionPostProcess";

vi.mock("./clRouterClient", () => ({
  clRouterDecide: vi.fn(),
}));

type DecideRequest = Parameters<typeof clRouterDecide>[0];
type Answers = Awaited<ReturnType<typeof clRouterDecide>>["answers"];

const ctx = {} as ActionCtx;
const orgId = "org" as Id<"organizations">;
const decide = vi.mocked(clRouterDecide);

function answerTasks(handlers: Record<string, (request: DecideRequest) => Answers>) {
  decide.mockImplementation(async (request) => {
    const handler = handlers[request.task ?? ""];
    if (!handler) throw new Error(`unexpected task ${request.task}`);
    return {
      contractVersion: 1,
      requestId: "decision",
      model: "jev-1.14.0",
      answers: handler(request),
      usage: { inputTokens: 1, outputTokens: 1 },
      cost: { status: "unpriced", costNanoUsd: null },
      durationMs: 1,
    };
  });
}

function claimAnswers(request: DecideRequest, supportByField: Record<string, number>): Answers {
  const claims = (request.state as { claims: Record<string, { field: string }> }).claims;
  return Object.fromEntries(Object.entries(claims).map(([key, claim]) => [
    key,
    { type: "noul" as const, noul: supportByField[claim.field] ?? 0 },
  ]));
}

function choice(value: string, confidence: number) {
  return {
    type: "choice" as const,
    choice: value,
    probabilities: { [value]: confidence, other: 1 - confidence },
    confidence,
  };
}

const sourceSpans = [
  { id: "span-1", text: "Policy No. GL 100O\nNamed Insured: Widget, LLC", pageStart: 1 },
  { id: "span-2", text: "Insurer: ACME INSURANCE COMPANY (A STOCK COMPANY)", pageStart: 1 },
  { id: "span-3", text: "Acme Insurance Company, Hartford, CT", pageStart: 2 },
];
const document = {
  carrier: "ACME INSURANCE COMPANY (A STOCK COMPANY)",
  policyNumber: "GL-1000",
  insuredName: "Widget Holdings LLC",
  linesOfBusiness: ["CGL"],
  coverages: [],
};

async function run(logs: string[] = []) {
  return postProcessExtractionDocument({
    ctx,
    orgId,
    document,
    sourceSpans,
    traceId: "trace-1",
    log: (message) => {
      logs.push(message);
    },
  });
}

function calls(task: string) {
  return decide.mock.calls.filter(([request]) => request.task === task);
}

beforeEach(() => {
  decide.mockReset();
});

describe("grounding fallback", () => {
  it("keeps only classifier-verified values that fail exact matching, in one batched call", async () => {
    answerTasks({
      policy_extraction_grounding: (request) =>
        claimAnswers(request, { insuredName: 0.93, policyNumber: 0.4 }),
      policy_extraction_org_name: () => ({}),
    });
    const logs: string[] = [];

    const result = await run(logs);

    const grounding = calls("policy_extraction_grounding");
    expect(grounding).toHaveLength(1);
    expect(grounding[0]![0].trace).toEqual({ traceId: "trace-1" });
    expect(grounding[0]![1]).toEqual({ telemetry: ctx });
    expect(Object.values((grounding[0]![0].state as { claims: Record<string, unknown> }).claims)).toEqual([
      { field: "policyNumber", value: "GL-1000", citedText: expect.stringContaining("GL 100O") },
      { field: "insuredName", value: "Widget Holdings LLC", citedText: expect.stringContaining("Widget, LLC") },
    ]);
    expect(result.document.insuredName).toBe("Widget Holdings LLC");
    expect(result.fields.insuredName).toBe("Widget Holdings LLC");
    expect(result.document.policyNumber).toBeUndefined();
    expect(result.fields.policyNumber).toBe("Unknown");
    expect(logs).toContain(
      'Kept insuredName "Widget Holdings LLC": classifier verified it against cited source text',
    );
    expect(logs).toContain("Dropped ungrounded extracted policyNumber: GL-1000");
  });

  it("removes unmatched values when the router fails", async () => {
    decide.mockRejectedValue(new Error("router down"));
    const logs: string[] = [];

    const result = await run(logs);

    expect(result.document.insuredName).toBeUndefined();
    expect(result.document.policyNumber).toBeUndefined();
    expect(result.fields.carrier).toBe("ACME INSURANCE COMPANY (A STOCK COMPANY)");
    expect(logs.some((message) => message.startsWith("Grounding classifier unavailable"))).toBe(true);
  });

  it("does not return claims without nearby source text", () => {
    const grounded = stripUngroundedSourceSensitiveValues(
      { insuredName: "Completely Different Name" },
      sourceSpans,
    );
    expect(grounded.removed).toEqual([{ field: "insuredName", value: "Completely Different Name" }]);
    expect(grounded.claims).toEqual([]);
  });
});

describe("organization name normalization", () => {
  it("chooses among spellings found verbatim in the source", async () => {
    answerTasks({
      policy_extraction_grounding: (request) => claimAnswers(request, {}),
      policy_extraction_org_name: (request) => {
        const question = request.questions.organization_0;
        expect(question?.type === "choice" && question.criteria).toEqual({
          keep_extracted: "ACME INSURANCE COMPANY (A STOCK COMPANY)",
          spelling_0: "ACME INSURANCE COMPANY",
          spelling_1: "Acme Insurance Company",
        });
        return { organization_0: choice("spelling_1", 0.88) };
      },
    });

    const result = await run();

    expect(calls("policy_extraction_org_name")).toHaveLength(1);
    expect(result.fields.carrier).toBe("Acme Insurance Company");
  });

  it("keeps the extracted name when Jev is not confident", async () => {
    answerTasks({
      policy_extraction_grounding: (request) => claimAnswers(request, {}),
      policy_extraction_org_name: () => ({ organization_0: choice("spelling_1", 0.5) }),
    });

    const result = await run();

    expect(result.fields.carrier).toBe("ACME INSURANCE COMPANY (A STOCK COMPANY)");
  });

  it("keeps extracted names when the router fails", async () => {
    answerTasks({
      policy_extraction_grounding: (request) => claimAnswers(request, {}),
      policy_extraction_org_name: () => {
        throw new Error("router down");
      },
    });

    const result = await run();

    expect(result.fields.carrier).toBe("ACME INSURANCE COMPANY (A STOCK COMPANY)");
    expect(result.fieldReview).toMatchObject({ applied: [], skipped: [], reviewedFieldCount: 0 });
  });

  it("offers mixed-case spellings only for all-caps names", () => {
    expect(sourceNameSpellings("Acme Insurance Company", sourceSpans)).toEqual([]);
    expect(sourceNameSpellings("ACME INSURANCE COMPANY", sourceSpans)).toEqual(["Acme Insurance Company"]);
  });
});
