import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("./clRouterClient", () => ({ clRouterDecide: vi.fn() }));

import { PDFDocument } from "pdf-lib";
import { clRouterDecide } from "./clRouterClient";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { PdfPageText } from "./pdfText";
import type {
  DecideRequest,
  DecideResponse,
  DecisionAnswer,
} from "../../contracts/cl-router/policy";
import {
  buildPolicySections,
  planPolicySections,
  POLICY_SECTION_KINDS,
  slicePdfPages,
  type PolicyPageLabel,
  type PolicySectionKind,
} from "./policySectioning";

const ctx = {} as ActionCtx;
const orgId = "org1" as Id<"organizations">;

function pdfPage(page: number, text: string): PdfPageText {
  return { page, text };
}

function decideResponse(answers: DecideResponse["answers"]): DecideResponse {
  return {
    contractVersion: 1,
    requestId: `req-${Object.keys(answers).length}-${Math.random()}`,
    model: "jev-1.0.0",
    answers,
    usage: { inputTokens: 10, outputTokens: 1 },
    cost: { status: "priced", costNanoUsd: 1 },
    durationMs: 1,
  };
}

function choiceAnswer(
  choice: PolicySectionKind,
  confidence: number,
): DecisionAnswer {
  return { type: "choice", choice, probabilities: { [choice]: confidence }, confidence };
}

function noulAnswer(noul: number): DecisionAnswer {
  return { type: "noul", noul };
}

function makeAutoDecide(config: {
  kindFor?: (page: number) => PolicySectionKind;
  confidenceFor?: (page: number) => number;
  boundaryFor?: (page: number) => number;
} = {}) {
  const kindFor = config.kindFor ?? (() => "coverage_form" as PolicySectionKind);
  const confidenceFor = config.confidenceFor ?? (() => 0.9);
  const boundaryFor = config.boundaryFor ?? (() => 0.05);
  return async (request: Omit<DecideRequest, "tenantId">) => {
    const answers: DecideResponse["answers"] = {};
    for (const key of Object.keys(request.questions)) {
      const match = /^(kind|boundary)_(\d+)$/.exec(key);
      if (!match) continue;
      const page = Number(match[2]);
      answers[key] =
        match[1] === "kind"
          ? choiceAnswer(kindFor(page), confidenceFor(page))
          : noulAnswer(boundaryFor(page));
    }
    return decideResponse(answers);
  };
}

afterEach(() => vi.resetAllMocks());

describe("form-number grouping", () => {
  test("consecutive pages sharing a form number become one deterministic section without calling Jev", async () => {
    const pages: PdfPageText[] = [
      pdfPage(
        1,
        "SOME ENDORSEMENT TITLE\nTHIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.\nBody text goes here\nCG 20 10 12 19",
      ),
      pdfPage(2, "Additional endorsement wording continues here\nCG 20 10 12 19"),
      pdfPage(3, "Final endorsement paragraph\nCG 20 10 12 19"),
    ];
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 3,
      pages,
      pdfByteLength: 3000,
    });
    expect(clRouterDecide).not.toHaveBeenCalled();
    expect(plan.sections).toEqual([
      expect.objectContaining({
        kind: "endorsement",
        pageStart: 1,
        pageEnd: 3,
        formNumber: "CG 20 10 12 19",
      }),
    ]);
    expect(plan.pageLabels.every((label) => label.source === "form_number")).toBe(
      true,
    );
  });

  test("detects a coverage form via the 'COVERAGE FORM' signal", async () => {
    const pages: PdfPageText[] = [
      pdfPage(
        1,
        "COMMERCIAL GENERAL LIABILITY COVERAGE FORM\nInsuring agreement text\nCG 00 01 04 13",
      ),
    ];
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 1,
      pages,
      pdfByteLength: 1000,
    });
    expect(clRouterDecide).not.toHaveBeenCalled();
    expect(plan.sections).toEqual([
      expect.objectContaining({
        kind: "coverage_form",
        pageStart: 1,
        pageEnd: 1,
        formNumber: "CG 00 01 04 13",
        confidence: 0.9,
      }),
    ]);
  });

  test("sends a declarations page with a printed form number to Jev instead of guessing", async () => {
    vi.mocked(clRouterDecide).mockImplementationOnce(async () =>
      decideResponse({
        kind_1: choiceAnswer("declarations", 0.95),
        boundary_1: noulAnswer(0),
      }),
    );
    const pages: PdfPageText[] = [
      pdfPage(
        1,
        "DECLARATIONS\nNamed Insured: Acme Corp\nPolicy Period: 01/01/2026 to 01/01/2027\nABC-123 (01/20)",
      ),
    ];
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 1,
      pages,
      pdfByteLength: 1000,
    });
    expect(clRouterDecide).toHaveBeenCalledTimes(1);
    expect(plan.pageLabels).toEqual([
      expect.objectContaining({
        page: 1,
        kind: "declarations",
        source: "classifier",
        formNumber: "ABC-123 (01/20)",
      }),
    ]);
  });

  test("sends a forms-and-endorsements schedule with a printed form number to Jev", async () => {
    vi.mocked(clRouterDecide).mockImplementationOnce(async () =>
      decideResponse({
        kind_1: choiceAnswer("forms_list", 0.9),
        boundary_1: noulAnswer(0),
      }),
    );
    const pages: PdfPageText[] = [
      pdfPage(
        1,
        "FORMS AND ENDORSEMENTS SCHEDULE\nForm Number - Description\nCG 20 10 12 19 - Additional Insured\nIL 00 17 11 98 - Common Policy Conditions",
      ),
    ];
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 1,
      pages,
      pdfByteLength: 1000,
    });
    expect(clRouterDecide).toHaveBeenCalledTimes(1);
    expect(plan.pageLabels).toEqual([
      expect.objectContaining({
        page: 1,
        kind: "forms_list",
        source: "classifier",
        formNumber: "CG 20 10 12 19",
      }),
    ]);
  });

  test("does not deterministically classify a declarations page whose forms list mentions 'COVERAGE FORM'", async () => {
    vi.mocked(clRouterDecide).mockImplementationOnce(async () =>
      decideResponse({
        kind_1: choiceAnswer("declarations", 0.9),
        boundary_1: noulAnswer(0),
      }),
    );
    const pages: PdfPageText[] = [
      pdfPage(
        1,
        "DECLARATIONS\nForms and Endorsements Applicable to This Policy:\nCOMMERCIAL GENERAL LIABILITY COVERAGE FORM\nCG 00 01 04 13",
      ),
    ];
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 1,
      pages,
      pdfByteLength: 1000,
    });
    expect(clRouterDecide).toHaveBeenCalledTimes(1);
    expect(plan.pageLabels[0]).toEqual(
      expect.objectContaining({ kind: "declarations", source: "classifier" }),
    );
    expect(plan.pageLabels[0].kind).not.toBe("coverage_form");
  });

  test("deterministically classifies a page titled 'ENDORSEMENT NO. 3'", async () => {
    const pages: PdfPageText[] = [
      pdfPage(
        1,
        "ENDORSEMENT NO. 3\nThis endorsement modifies certain provisions of the policy.\nCG 20 10 12 19",
      ),
    ];
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 1,
      pages,
      pdfByteLength: 1000,
    });
    expect(clRouterDecide).not.toHaveBeenCalled();
    expect(plan.pageLabels).toEqual([
      expect.objectContaining({
        page: 1,
        kind: "endorsement",
        source: "form_number",
        confidence: 0.8,
      }),
    ]);
  });
});

describe("Jev per-page classification", () => {
  test("combines choice kinds and boundary noul answers into contiguous sections", async () => {
    vi.mocked(clRouterDecide).mockImplementationOnce(async () =>
      decideResponse({
        kind_1: choiceAnswer("declarations", 0.9),
        boundary_1: noulAnswer(0),
        kind_2: choiceAnswer("declarations", 0.9),
        boundary_2: noulAnswer(0.1),
        kind_3: choiceAnswer("coverage_form", 0.9),
        boundary_3: noulAnswer(0.9),
        kind_4: choiceAnswer("coverage_form", 0.9),
        boundary_4: noulAnswer(0.1),
        // Same kind as the previous page, but Jev flags a new document boundary.
        kind_5: choiceAnswer("coverage_form", 0.9),
        boundary_5: noulAnswer(0.9),
      }),
    );

    const pages: PdfPageText[] = Array.from({ length: 5 }, (_, i) =>
      pdfPage(i + 1, `Plain prose content for page ${i + 1}, no printed form number.`),
    );
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 5,
      pages,
      pdfByteLength: 5000,
    });

    expect(clRouterDecide).toHaveBeenCalledTimes(1);
    expect(plan.sections).toEqual([
      expect.objectContaining({ kind: "declarations", pageStart: 1, pageEnd: 2 }),
      expect.objectContaining({ kind: "coverage_form", pageStart: 3, pageEnd: 4 }),
      expect.objectContaining({ kind: "coverage_form", pageStart: 5, pageEnd: 5 }),
    ]);
  });

  test("merges a low-confidence page into the preceding section", async () => {
    vi.mocked(clRouterDecide).mockImplementationOnce(async () =>
      decideResponse({
        kind_1: choiceAnswer("declarations", 0.9),
        boundary_1: noulAnswer(0),
        kind_2: choiceAnswer("declarations", 0.9),
        boundary_2: noulAnswer(0.1),
        kind_3: choiceAnswer("invoice", 0.3),
        boundary_3: noulAnswer(0.9),
        kind_4: choiceAnswer("declarations", 0.9),
        boundary_4: noulAnswer(0.1),
        kind_5: choiceAnswer("declarations", 0.9),
        boundary_5: noulAnswer(0.1),
      }),
    );
    const pages: PdfPageText[] = Array.from({ length: 5 }, (_, i) =>
      pdfPage(i + 1, `Plain prose content for page ${i + 1}.`),
    );
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 5,
      pages,
      pdfByteLength: 5000,
    });

    expect(plan.sections).toEqual([
      expect.objectContaining({
        kind: "declarations",
        pageStart: 1,
        pageEnd: 5,
        confidence: 0.3,
      }),
    ]);
  });

  test("merges a low-confidence page 1 into the following section", async () => {
    vi.mocked(clRouterDecide).mockImplementationOnce(async () =>
      decideResponse({
        kind_1: choiceAnswer("invoice", 0.2),
        boundary_1: noulAnswer(0),
        kind_2: choiceAnswer("declarations", 0.9),
        boundary_2: noulAnswer(0.1),
        kind_3: choiceAnswer("declarations", 0.9),
        boundary_3: noulAnswer(0.1),
      }),
    );
    const pages: PdfPageText[] = Array.from({ length: 3 }, (_, i) =>
      pdfPage(i + 1, `Plain prose content for page ${i + 1}.`),
    );
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 3,
      pages,
      pdfByteLength: 3000,
    });

    expect(plan.sections).toEqual([
      expect.objectContaining({
        kind: "declarations",
        pageStart: 1,
        pageEnd: 3,
        confidence: 0.2,
      }),
    ]);
  });

  test("batches a 60-page document into 3 requests", async () => {
    vi.mocked(clRouterDecide).mockImplementation(makeAutoDecide());
    const pages: PdfPageText[] = Array.from({ length: 60 }, (_, i) =>
      pdfPage(i + 1, `Plain prose content for page ${i + 1}.`),
    );
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 60,
      pages,
      pdfByteLength: 60000,
    });

    expect(clRouterDecide).toHaveBeenCalledTimes(3);
    expect(plan.pageLabels).toHaveLength(60);
    expect(plan.pageLabels.every((label) => label.source === "classifier")).toBe(
      true,
    );
    expect(plan.sections[0].pageStart).toBe(1);
    expect(plan.sections[plan.sections.length - 1].pageEnd).toBe(60);
  });
});

describe("fallbacks", () => {
  test("labels pages 'other' with source fallback when a Jev request fails", async () => {
    vi.mocked(clRouterDecide).mockRejectedValueOnce(new Error("router unavailable"));
    const pages: PdfPageText[] = Array.from({ length: 5 }, (_, i) =>
      pdfPage(i + 1, `Plain prose content for page ${i + 1}.`),
    );
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 5,
      pages,
      pdfByteLength: 5000,
    });

    expect(plan.pageLabels).toEqual(
      Array.from({ length: 5 }, (_, i) => ({
        page: i + 1,
        kind: "other",
        startsNewDocument: false,
        confidence: 0,
        source: "fallback",
      })),
    );
    expect(plan.sections).toEqual([
      expect.objectContaining({ kind: "other", pageStart: 1, pageEnd: 5 }),
    ]);
  });

  test("returns fixed-size 'other' sections when the whole document has no text layer", async () => {
    const pages: PdfPageText[] = Array.from({ length: 65 }, (_, i) =>
      pdfPage(i + 1, "   \n   "),
    );
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 65,
      pages,
      pdfByteLength: 65000,
    });

    expect(clRouterDecide).not.toHaveBeenCalled();
    expect(plan.pageLabels).toHaveLength(65);
    expect(plan.pageLabels.every((label) => label.source === "fallback")).toBe(
      true,
    );
    expect(plan.sections).toEqual([
      expect.objectContaining({
        pageStart: 1,
        pageEnd: 30,
        part: { index: 0, count: 3 },
      }),
      expect.objectContaining({
        pageStart: 31,
        pageEnd: 60,
        part: { index: 1, count: 3 },
      }),
      expect.objectContaining({
        pageStart: 61,
        pageEnd: 65,
        part: { index: 2, count: 3 },
      }),
    ]);
  });
});

describe("oversize sections split into parts", () => {
  test("splits a section exceeding MAX_SECTION_PAGES", async () => {
    vi.mocked(clRouterDecide).mockImplementation(
      makeAutoDecide({ boundaryFor: () => 0 }),
    );
    const pages: PdfPageText[] = Array.from({ length: 31 }, (_, i) =>
      pdfPage(i + 1, `Plain prose content for page ${i + 1}.`),
    );
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 31,
      pages,
      pdfByteLength: 31000,
    });

    expect(plan.sections).toEqual([
      expect.objectContaining({
        kind: "coverage_form",
        pageStart: 1,
        pageEnd: 30,
        part: { index: 0, count: 2 },
      }),
      expect.objectContaining({
        kind: "coverage_form",
        pageStart: 31,
        pageEnd: 31,
        part: { index: 1, count: 2 },
      }),
    ]);
  });

  test("splits a section exceeding the estimated byte budget", async () => {
    vi.mocked(clRouterDecide).mockImplementation(
      makeAutoDecide({ boundaryFor: () => 0 }),
    );
    const pages: PdfPageText[] = Array.from({ length: 10 }, (_, i) =>
      pdfPage(i + 1, `Plain prose content for page ${i + 1}.`),
    );
    // 3,000,000 bytes/page * 10 pages exceeds MAX_SECTION_BYTES well before
    // MAX_SECTION_PAGES would, forcing a 3-page-per-part budget.
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 10,
      pages,
      pdfByteLength: 30_000_000,
    });

    expect(plan.sections.map((s) => [s.pageStart, s.pageEnd])).toEqual([
      [1, 3],
      [4, 6],
      [7, 9],
      [10, 10],
    ]);
    expect(plan.sections.every((s) => s.part?.count === 4)).toBe(true);
  });
});

describe("buildPolicySections coverage invariant", () => {
  test("a 0.70 page starts a section while a 0.69 page joins its neighbor", () => {
    for (const confidence of [0.69, 0.7]) {
      const labels: PolicyPageLabel[] = [
        { page: 1, kind: "declarations", confidence: 0.9, source: "classifier", startsNewDocument: false },
        { page: 2, kind: "endorsement", confidence, source: "classifier", startsNewDocument: false },
      ];
      const sections = buildPolicySections(labels, 1000);
      expect(sections.map((section) => section.kind)).toEqual(
        confidence < 0.7 ? ["declarations"] : ["declarations", "endorsement"],
      );
    }
  });

  test("always produces ordered, contiguous, non-overlapping sections covering every page", () => {
    const kinds = POLICY_SECTION_KINDS;
    for (let iteration = 0; iteration < 300; iteration++) {
      const pageCount = 1 + Math.floor(Math.random() * 40);
      const labels: PolicyPageLabel[] = Array.from({ length: pageCount }, (_, i) => {
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        const formRoll = Math.random();
        return {
          page: i + 1,
          kind,
          startsNewDocument: Math.random() < 0.3,
          confidence: Math.random(),
          source: "classifier",
          ...(formRoll < 0.3
            ? { formNumber: "FORM-A" }
            : formRoll < 0.5
              ? { formNumber: "FORM-B" }
              : {}),
        };
      });
      const pdfByteLength = Math.floor(Math.random() * 20_000_000);

      const sections = buildPolicySections(labels, pdfByteLength);

      let expectedNextPage = 1;
      for (const section of sections) {
        expect(section.pageStart).toBe(expectedNextPage);
        expect(section.pageEnd).toBeGreaterThanOrEqual(section.pageStart);
        expectedNextPage = section.pageEnd + 1;
      }
      expect(expectedNextPage).toBe(pageCount + 1);
    }
  });
});

test("Jev marks a page boundary at 0.70 but not 0.69", async () => {
  for (const probability of [0.69, 0.7]) {
    vi.mocked(clRouterDecide).mockImplementation(
      makeAutoDecide({ kindFor: () => "coverage_form", boundaryFor: (page) => page === 2 ? probability : 0 }),
    );
    const plan = await planPolicySections({
      ctx,
      orgId,
      pageCount: 2,
      pages: [pdfPage(1, "Coverage text page one"), pdfPage(2, "Coverage text page two")],
      pdfByteLength: 1000,
    });
    expect(plan.sections).toHaveLength(probability < 0.7 ? 1 : 2);
    vi.mocked(clRouterDecide).mockReset();
  }
});

describe("slicePdfPages", () => {
  test("copies the requested page range into a new document", async () => {
    const source = await PDFDocument.create();
    for (let i = 0; i < 6; i++) source.addPage();
    const bytes = await source.save();

    const sliced = await slicePdfPages(bytes, 2, 4);
    const result = await PDFDocument.load(sliced);
    expect(result.getPageCount()).toBe(3);
  });
});
