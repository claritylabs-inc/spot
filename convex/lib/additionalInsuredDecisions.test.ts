// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { extractAdditionalInsuredEligibility } from "../actions/policyExtraction";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type {
  DocumentSourceNode,
  PolicyOperationalProfile,
  SourceSpanLike,
} from "./sourceTree";
import type { AdditionalInsuredEligibility } from "./additionalInsuredDecisions";
import type { DecisionAnswer, DecisionQuestion } from "./decisions";

const automatic =
  "Lessors are additional insureds when required by written contract.";
const condition = "when required by written contract";
const node: DocumentSourceNode = {
  id: "node-1",
  documentId: "policy-1",
  kind: "clause",
  title: "Additional insured",
  description: "Additional insured wording",
  textExcerpt: automatic,
  sourceSpanIds: ["span-1"],
  order: 1,
  path: "1",
};
const literal = {
  subject: "Lessors",
  clause: automatic,
  conditions: [condition],
  name: null as string | null,
  endorsementTitle: null as string | null,
  sourceNodeIds: ["node-1"],
  sourceSpanIds: ["span-1"],
};
const legacy: AdditionalInsuredEligibility = {
  withoutEndorsement: [],
  requiresEndorsement: [],
  scheduledAdditionalInsureds: [],
  additionalInsureds: [],
  reviewRequired: [
    {
      category: "Original reasoning",
      condition: "Review",
      summary: "Original reasoning result",
      sourceNodeIds: ["node-1"],
      sourceSpanIds: ["span-1"],
    },
  ],
  overallSummary: "Original reasoning result",
};
type Request = {
  schema?: { properties: Record<string, unknown> };
  questions?: Record<string, DecisionQuestion>;
  state?: { sourceSpans: SourceSpanLike[]; candidates: (typeof literal)[] };
  tenantId: string;
};
let requests: Request[];
let extracted: { items: (typeof literal)[] };
let choices: string[];
let alterAnswers: (answers: Record<string, DecisionAnswer>) => void;
let duringFetch: (request: Request) => void;
let failDecide: boolean;
const ctx = { runQuery: vi.fn(async () => null) } as unknown as ActionCtx;
function args() {
  return {
    ctx,
    orgId: "org-1" as Id<"organizations">,
    policyId: "policy-1",
    sourceTree: [structuredClone(node)],
    sourceSpans: [
      {
        id: "span-1",
        documentId: "policy-1",
        text: automatic,
        kind: "pdf_text" as string | undefined,
      },
    ],
    profile: { coverageLines: [] } as unknown as PolicyOperationalProfile,
  };
}
function configure(mode: string, family = "extraction.additional_insured") {
  vi.stubEnv(
    "SPOT_DECISION_POLICY",
    JSON.stringify({
      mode,
      families: { [family]: { threshold: 0.95, evaluationId: "fixture-only" } },
    }),
  );
}
function generation(output: unknown) {
  return {
    requestId: "generation-1",
    model: { provider: "openai", model: "gpt-5.4-mini" },
    routing: {
      decision: "static",
      candidatesConsidered: [],
      policyVersion: "test",
      cacheStickinessApplied: false,
      routeSource: "static",
      attemptCount: 1,
    },
    usage: {
      inputTokens: 5,
      outputTokens: 2,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
    },
    costUsd: null,
    costStatus: "unpriced",
    output,
  };
}
const generations = () => requests.filter((request) => request.schema);
const decisions = () => requests.filter((request) => request.questions);
const resultEligibility = (result: PolicyOperationalProfile) =>
  (
    result as PolicyOperationalProfile & {
      additionalInsuredEligibility: AdditionalInsuredEligibility;
    }
  ).additionalInsuredEligibility;

beforeEach(() => {
  configure("active");
  vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
  vi.stubEnv("CL_ROUTER_SECRET", "test-router-secret");
  requests = [];
  extracted = { items: [structuredClone(literal)] };
  choices = ["automatic"];
  alterAnswers = () => {};
  duringFetch = () => {};
  failDecide = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toMatch(
        /^https:\/\/router.example.test\/v1\/(generate|decide)$/,
      );
      expect(init.headers).toMatchObject({
        Authorization: "Bearer test-router-secret",
      });
      const request = JSON.parse(String(init.body)) as Request;
      expect(request.tenantId).toBe("glass");
      expect(
        new TextEncoder().encode(String(init.body)).byteLength,
      ).toBeLessThan(4 * 1024 * 1024);
      requests.push(request);
      duringFetch(request);
      if (request.schema)
        return Response.json(
          generation(request.schema.properties.items ? extracted : legacy),
        );
      if (failDecide) throw new Error("router unavailable");
      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, question] of Object.entries(request.questions!)) {
        const selected = choices[Number(id.split("_").at(-1))] ?? "automatic";
        answers[id] =
          question.type === "choice"
            ? {
                type: "choice",
                choice: selected,
                confidence: 0.99,
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map((key) => [
                    key,
                    key === selected ? 1 : 0,
                  ]),
                ),
              }
            : { type: "noul", noul: 0.99 };
      }
      alterAnswers(answers);
      return Response.json({
        contractVersion: 1,
        requestId: "decision-1",
        model: "jev-1.13.0",
        answers,
        usage: { inputTokens: 10, outputTokens: 3 },
        cost: { status: "unpriced", costNanoUsd: null },
        durationMs: 1,
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test.each([
  ["legacy", "extraction.additional_insured"],
  ["active", "extraction.audit"],
  ["active", "extraction.field_review"],
])(
  "%s without family qualification preserves the original call and result (%s)",
  async (mode, family) => {
    configure(mode, family);
    expect(
      resultEligibility(await extractAdditionalInsuredEligibility(args())),
    ).toEqual(legacy);
    expect(generations()).toHaveLength(1);
    expect(decisions()).toHaveLength(0);
  },
);

test("missing and invalid configuration add no calls", async () => {
  for (const policy of [
    "",
    "{invalid",
    '{"mode":"active","families":{"extraction.additional_insured":{"threshold":0.95}}}',
  ]) {
    vi.stubEnv("SPOT_DECISION_POLICY", policy);
    requests = [];
    expect(
      resultEligibility(await extractAdditionalInsuredEligibility(args())),
    ).toEqual(legacy);
    expect(generations()).toHaveLength(1);
    expect(decisions()).toHaveLength(0);
  }
});

test("literal discovery precedes batched classification with full unfiltered source text", async () => {
  const input = args();
  const tail =
    " All rights above remain subject to the following exclusion: no coverage for unrelated operations.";
  input.sourceSpans[0].text = automatic + " context".repeat(300) + tail;
  input.sourceSpans.push({
    id: "span-2",
    documentId: "policy-1",
    text: "Definitions apply throughout the policy.",
    kind: "pdf_text",
  });
  const result = resultEligibility(
    await extractAdditionalInsuredEligibility(input),
  );
  expect(result.withoutEndorsement).toEqual([
    {
      category: "Lessors",
      condition,
      summary: automatic,
      sourceNodeIds: ["node-1"],
      sourceSpanIds: ["span-1"],
    },
  ]);
  expect(generations()).toHaveLength(1);
  expect(generations()[0].schema!.properties).toEqual({
    items: expect.any(Object),
  });
  expect(decisions()).toHaveLength(1);
  expect(decisions()[0].state!.sourceSpans).toEqual(input.sourceSpans);
  expect(decisions()[0].state!.candidates).toEqual(extracted.items);
  expect(Object.keys(decisions()[0].questions!)).toHaveLength(3);
});

test("shadow executes the original reasoning output despite certain classifications", async () => {
  configure("shadow");
  expect(
    resultEligibility(await extractAdditionalInsuredEligibility(args())),
  ).toEqual(legacy);
  expect(decisions()).toHaveLength(1);
  expect(generations()).toHaveLength(2);
});

test.each(["automatic", "scheduled", "endorsement_required", "review"])(
  "named party %s keeps output status, scope and provenance",
  async (classification) => {
    const input = args();
    const clause = "Harbor LLC is an additional insured.";
    input.sourceSpans[0].text = `${clause} ${condition}. AI Endorsement`;
    extracted.items = [
      {
        ...literal,
        name: "Harbor LLC",
        subject: "Harbor LLC",
        clause,
        endorsementTitle: "AI Endorsement",
      },
    ];
    choices = [classification];
    const result = resultEligibility(
      await extractAdditionalInsuredEligibility(input),
    );
    const status =
      classification === "automatic"
        ? "automatic_class"
        : classification === "scheduled"
          ? "scheduled_by_endorsement"
          : "review_required";
    expect(result.additionalInsureds).toEqual([
      {
        name: "Harbor LLC",
        status,
        scope: `${clause}\n${condition}`,
        endorsementTitle: "AI Endorsement",
        sourceNodeIds: ["node-1"],
        sourceSpanIds: ["span-1"],
      },
    ]);
    expect(result.scheduledAdditionalInsureds).toHaveLength(
      classification === "scheduled" ? 1 : 0,
    );
    expect(result.requiresEndorsement).toHaveLength(
      classification === "endorsement_required" ? 1 : 0,
    );
    expect(result.reviewRequired).toHaveLength(
      classification === "review" ? 1 : 0,
    );
  },
);

test.each([
  "uncertain",
  "unsupported",
  "omission",
  "missing_answer",
  "invalid_choice",
  "malformed_probability",
  "generic_scheduled",
])("%s falls back with no partial classification", async (failure) => {
  alterAnswers = (answers) => {
    if (failure === "uncertain")
      answers.support_0 = { type: "noul", noul: 0.5 };
    if (failure === "unsupported")
      answers.support_0 = { type: "noul", noul: 0.01 };
    if (failure === "omission") answers.coverage = { type: "noul", noul: 0.01 };
    if (failure === "missing_answer") delete answers.support_0;
    if (failure === "malformed_probability")
      answers.support_0 = { type: "noul", noul: 2 };
    if (failure === "invalid_choice")
      answers.classification_0 = {
        type: "choice",
        choice: "invented",
        confidence: 1,
        probabilities: { invented: 1 },
      };
  };
  if (failure === "generic_scheduled") choices = ["scheduled"];
  expect(
    resultEligibility(await extractAdditionalInsuredEligibility(args())),
  ).toEqual(legacy);
  expect(generations()).toHaveLength(2);
});

test("a transient router failure uses the original reasoning", async () => {
  failDecide = true;
  expect(
    resultEligibility(await extractAdditionalInsuredEligibility(args())),
  ).toEqual(legacy);
  expect(generations()).toHaveLength(2);
});

test.each(["node", "span", "association", "literal", "name", "preclassified"])(
  "invalid %s evidence cannot reach Jev or become eligibility",
  async (failure) => {
    const input = args();
    if (failure === "node") extracted.items[0].sourceNodeIds = ["forged"];
    if (failure === "span") extracted.items[0].sourceSpanIds = ["forged"];
    if (failure === "association") {
      input.sourceSpans.push({
        id: "other-span",
        documentId: "policy-1",
        text: automatic,
        kind: "pdf_text",
      });
      extracted.items[0].sourceSpanIds = ["other-span"];
    }
    if (failure === "literal")
      extracted.items[0].clause = "Invented unconditional coverage";
    if (failure === "name") extracted.items[0].name = "Invented LLC";
    if (failure === "preclassified")
      Object.assign(extracted.items[0], { status: "automatic" });
    expect(
      resultEligibility(await extractAdditionalInsuredEligibility(input)),
    ).toEqual(legacy);
    expect(decisions()).toHaveLength(0);
    expect(generations()).toHaveLength(2);
  },
);

test.each([
  "missing",
  "empty",
  "foreign",
  "duplicate",
  "oversized",
  "dangling",
  "image",
  "unknown_kind",
  "missing_kind",
  "missing_span_parent",
])("%s source context bypasses literal discovery", async (failure) => {
  const input = args();
  if (failure === "missing") input.sourceSpans = [];
  if (failure === "empty") input.sourceSpans[0].text = "";
  if (failure === "foreign") input.sourceSpans[0].documentId = "another-policy";
  if (failure === "duplicate") input.sourceSpans.push(input.sourceSpans[0]);
  if (failure === "oversized")
    input.sourceSpans[0].text += "語".repeat(180_000);
  if (failure === "dangling")
    input.sourceTree[0].sourceSpanIds.push("missing-span");
  if (failure === "image") input.sourceSpans[0].kind = "pdf_image";
  if (failure === "unknown_kind") input.sourceSpans[0].kind = "unknown";
  if (failure === "missing_kind") input.sourceSpans[0].kind = undefined;
  if (failure === "missing_span_parent")
    Object.assign(input.sourceSpans[0], { parentSpanId: "missing-span" });
  const result = resultEligibility(
    await extractAdditionalInsuredEligibility(input),
  );
  expect(result.overallSummary).toBe(legacy.overallSummary);
  expect(generations()).toHaveLength(1);
  expect(decisions()).toHaveLength(0);
});

test("question overflow falls back instead of dropping candidates", async () => {
  extracted.items = Array.from({ length: 64 }, () => structuredClone(literal));
  expect(
    resultEligibility(await extractAdditionalInsuredEligibility(args())),
  ).toEqual(legacy);
  expect(decisions()).toHaveLength(0);
});

test("output capacity overflow falls back instead of trimming successful classifications", async () => {
  extracted.items = Array.from({ length: 13 }, () => structuredClone(literal));
  expect(
    resultEligibility(await extractAdditionalInsuredEligibility(args())),
  ).toEqual(legacy);
  expect(Object.keys(decisions()[0].questions!)).toHaveLength(27);
});

test.each(["before", "discovery", "decision", "fallback"])(
  "cancellation at %s stops without another reasoning call",
  async (stage) => {
    const controller = new AbortController();
    if (stage === "before") controller.abort();
    if (stage === "fallback") configure("legacy");
    duringFetch = (request) => {
      if (
        (stage === "discovery" && request.schema?.properties.items) ||
        (stage === "decision" && request.questions) ||
        (stage === "fallback" && request.schema)
      )
        controller.abort();
    };
    await expect(
      extractAdditionalInsuredEligibility({
        ...args(),
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(generations()).toHaveLength(stage === "before" ? 0 : 1);
    expect(decisions()).toHaveLength(stage === "decision" ? 1 : 0);
  },
);

test("all 63 candidates receive independent support and classification in one bounded request", async () => {
  const input = args();
  const named =
    "Harbor LLC is an additional insured when required by written contract.";
  input.sourceSpans[0].text = `${automatic} ${named}`;
  extracted.items = [
    ...Array.from({ length: 60 }, () => ({
      ...literal,
      name: "Harbor LLC",
      subject: "Harbor LLC",
      clause: named,
    })),
    ...Array.from({ length: 3 }, () => structuredClone(literal)),
  ];
  const result = resultEligibility(
    await extractAdditionalInsuredEligibility(input),
  );
  expect(result.additionalInsureds).toHaveLength(60);
  expect(result.withoutEndorsement).toHaveLength(3);
  expect(decisions()).toHaveLength(1);
  expect(Object.keys(decisions()[0].questions!)).toHaveLength(127);
});

test("a classification request over budget falls back with all context intact", async () => {
  const input = args();
  input.sourceSpans[0].text += " context".repeat(52_000);
  extracted.items = Array.from({ length: 63 }, () => structuredClone(literal));
  expect(
    resultEligibility(await extractAdditionalInsuredEligibility(input)),
  ).toEqual(legacy);
  expect(generations()).toHaveLength(2);
  expect(decisions()).toHaveLength(0);
});

test("uncertain Choice classification cannot bypass the independently evaluated threshold", async () => {
  alterAnswers = (answers) => {
    answers.classification_0 = {
      type: "choice",
      choice: "automatic",
      confidence: 0.5,
      probabilities: {
        automatic: 0.5,
        scheduled: 0,
        endorsement_required: 0.5,
        review: 0,
      },
    };
  };
  expect(
    resultEligibility(await extractAdditionalInsuredEligibility(args())),
  ).toEqual(legacy);
  expect(generations()).toHaveLength(2);
});

test("scheduled wording still passes through the existing deterministic certificate safeguard", async () => {
  const input = args();
  const text = "Scheduled Additional Insured must be added by endorsement.";
  input.sourceSpans[0].text = text;
  input.sourceTree[0].textExcerpt = text;
  extracted.items = [
    {
      ...literal,
      subject: "Scheduled Additional Insured",
      clause: text,
      conditions: ["must be added by endorsement"],
    },
  ];
  choices = ["automatic"];
  const result = resultEligibility(
    await extractAdditionalInsuredEligibility(input),
  );
  expect(result.withoutEndorsement).toEqual([]);
  expect(result.requiresEndorsement).toHaveLength(1);
  expect(result.requiresEndorsement[0].sourceNodeIds).toEqual(["node-1"]);
});
