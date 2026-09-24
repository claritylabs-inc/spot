import { describe, expect, test } from "vitest";
import { z } from "zod";
import type { PolicySection } from "../policySectioning";
import {
  buildDeclarationsSummary,
  buildSectionPrompt,
  citationPageCandidates,
  sectionPageInstructions,
} from "./prompts";
import { SECTION_OUTPUT_SCHEMAS, type DeclarationsSectionOutput } from "./schemas";

function section(overrides: Partial<PolicySection>): PolicySection {
  return {
    sectionId: "endorsement-5-8",
    kind: "endorsement",
    pageStart: 5,
    pageEnd: 8,
    confidence: 1,
    ...overrides,
  };
}

const declarations: DeclarationsSectionOutput = {
  policyNumber: { value: "GL-100", citations: [{ page: 1, quote: "GL-100" }] },
  namedInsured: { value: "Acme Corp", citations: [{ page: 1, quote: "Acme Corp" }] },
  insurer: { value: "Example Insurance Company", citations: [] },
  broker: null,
  effectiveDate: { value: "01/01/2026", citations: [] },
  expirationDate: { value: "01/01/2027", citations: [] },
  retroactiveDate: null,
  programName: null,
  operationsDescription: null,
  premium: { value: "$1,200", citations: [] },
  totalCost: null,
  premiumBreakdown: [],
  taxesAndFees: [],
  linesOfBusiness: ["CGL"],
  parties: [],
  insuredDetails: [],
  coverages: [
    {
      name: "General Liability",
      lineOfBusiness: "CGL",
      coverageCode: null,
      limit: "$1,000,000",
      deductible: null,
      premium: null,
      retroactiveDate: null,
      formNumber: null,
      limits: [],
      citations: [],
    },
  ],
  forms: [
    {
      formNumber: "CG 00 01",
      editionDate: "04 13",
      title: null,
      formType: "coverage",
      citations: [],
    },
  ],
};

describe("section prompts", () => {
  test("state the slice's original pages and page offset", () => {
    const instructions = sectionPageInstructions(section({}), 20);

    expect(instructions).toContain("original pages 5-8 of a 20-page document");
    expect(instructions).toContain("Page 1 of the attached PDF is original page 5");
    expect(instructions).toContain("add 4 to a page number");
    expect(instructions).toContain("original page number from 5 to 8");
    expect(sectionPageInstructions(section({ pageStart: 3, pageEnd: 3 }), 9))
      .toContain("original page 3 of a 9-page document");
  });

  test("give declarations the carrier guidance and other sections the declarations context", () => {
    const summary = buildDeclarationsSummary([declarations]);
    const declarationsPrompt = buildSectionPrompt({
      section: section({ sectionId: "declarations-1-2", kind: "declarations", pageStart: 1, pageEnd: 2 }),
      pageCount: 20,
    });
    const endorsementPrompt = buildSectionPrompt({
      section: section({ formNumber: "CG 20 10", title: "Additional Insured" }),
      pageCount: 20,
      declarationsSummary: summary,
    });

    expect(declarationsPrompt.prompt).toContain("Carrier identity rules");
    expect(declarationsPrompt.prompt).toContain("ACORD LOBCd");
    expect(declarationsPrompt.prompt).not.toContain("Policy context from the declarations");
    expect(endorsementPrompt.prompt).toContain('form CG 20 10, "Additional Insured"');
    expect(endorsementPrompt.prompt).toContain("- Policy number: GL-100");
    expect(endorsementPrompt.system).toContain("citations");
  });

  test("summarize declarations compactly", () => {
    expect(buildDeclarationsSummary([declarations])).toBe([
      "- Policy number: GL-100",
      "- Named insured: Acme Corp",
      "- Carrier: Example Insurance Company",
      "- Policy period: 01/01/2026 to 01/01/2027",
      "- Lines of business: CGL",
      "- Coverages: General Liability: $1,000,000",
      "- Forms: CG 00 01",
    ].join("\n"));
    expect(buildDeclarationsSummary([])).toBeUndefined();
  });
});

describe("citation page conversion", () => {
  test("keeps original pages and converts slice-relative pages", () => {
    const slice = section({ pageStart: 5, pageEnd: 8 });

    expect(citationPageCandidates(6, slice)).toEqual([6]);
    expect(citationPageCandidates(2, slice)).toEqual([6]);
    expect(citationPageCandidates(30, slice)).toEqual([]);
    expect(citationPageCandidates(1.5, slice)).toEqual([]);
  });

  test("offers both readings when a page is valid either way", () => {
    expect(citationPageCandidates(5, section({ pageStart: 3, pageEnd: 10 })))
      .toEqual([5, 7]);
    expect(citationPageCandidates(2, section({ pageStart: 1, pageEnd: 4 })))
      .toEqual([2]);
  });
});

describe("section output schemas", () => {
  test("every section kind has a JSON schema for structured output", () => {
    for (const schema of Object.values(SECTION_OUTPUT_SCHEMAS)) {
      const jsonSchema = z.toJSONSchema(schema) as { type?: string };
      expect(jsonSchema.type).toBe("object");
    }
  });

  test("facts carry page and quote citations", () => {
    expect(SECTION_OUTPUT_SCHEMAS.declarations.parse(declarations)).toEqual(declarations);
    expect(
      SECTION_OUTPUT_SCHEMAS.notice.safeParse({
        title: null,
        summary: "Terrorism notice",
        citations: [{ page: "2", quote: "TERRORISM" }],
      }).success,
    ).toBe(false);
  });
});
