import { CARRIER_IDENTITY_GUIDANCE } from "../extractionPromptGuidance";
import { ACORD_LOB_CODES } from "../linesOfBusiness";
import type { PolicySection, PolicySectionKind } from "../policySectioning";
import type { DeclarationsSectionOutput } from "./schemas";

const DECLARATIONS_SUMMARY_MAX_CHARS = 2_500;

const SECTION_SYSTEM_PROMPT = `You extract source-cited facts from one section of an already-bound insurance policy PDF.

Rules:
- Use only what is printed on the attached pages. Never infer, calculate, or use outside knowledge. Use null or an empty list when a fact is not printed.
- Every extracted fact carries citations: the original page number and a short quote (at most 200 characters) copied exactly from that page that contains the cited value.
- Keep dates, money amounts, limits, and deductibles as display strings exactly as printed.
- Return only JSON that matches the schema.`;

const LINE_OF_BUSINESS_RULE = `For linesOfBusiness and coverages[].lineOfBusiness, use only a current ACORD LOBCd from this list: ${ACORD_LOB_CODES.join(", ")}. Travel insurance is TRVL and commercial cyber/privacy liability is CYBER. Use null for a coverage that cannot be assigned to exactly one line. For coverages[].coverageCode, use an ACORD CoverageCd only when the page prints it; otherwise null.`;

const COVERAGE_RULE = `Put each printed limit, sublimit, aggregate, retention, or deductible in coverages[].limits with its printed label and value, and also set limit and deductible to the primary printed values.`;

const KIND_INSTRUCTIONS: Record<PolicySectionKind, string> = {
  declarations: `This section is a declarations page. Extract:
- Policy metadata: policyNumber, namedInsured, the policy-facing carrier in insurer, the producing broker or agency in broker, the policy period (effectiveDate, expirationDate), retroactiveDate, the product or program name in programName, and the description of operations.
- parties, with addresses when printed: the named insured, additional named insureds, carrier and insurer legal entities (with NAIC number when printed), the producer (with license number when printed), any general agent, managing general agent, or program administrator, and any loss payees, mortgage holders, or additional insureds listed on the declarations. A source-labeled broker or agent is the producer.
- insuredDetails: DBA, legal entity type, and FEIN or tax ID when printed.
- premium: the total policy premium; premiumBreakdown: premium by line or coverage part; taxesAndFees: each tax, fee, surcharge, or assessment; totalCost: the total payable including taxes and fees.
- coverages: every coverage line with its limits and deductibles as listed on the declarations.
- forms: the forms and endorsements schedule printed on the declarations, if any.

${COVERAGE_RULE}

${LINE_OF_BUSINESS_RULE}

${CARRIER_IDENTITY_GUIDANCE}`,
  schedule: `This section is a schedule, such as vehicles, locations, property, classifications, or scheduled coverages. Extract each schedule with one item per printed row: the row label (for example the vehicle or location number), a description when printed, and every printed column as label/value pairs. Use kind vehicle, location, property, or other. Also extract coverage rows printed in the schedule.

${COVERAGE_RULE}

${LINE_OF_BUSINESS_RULE}`,
  forms_list: `This section is a forms and endorsements schedule. Extract every listed form with its form number, edition date, title, and form type.`,
  coverage_form: `This section is a policy coverage form. Extract the forms printed here (form number, edition date, title) and the coverage lines the form grants. Include limits, sublimits, aggregates, retentions, and deductibles only when their amounts are printed on these pages. Extract definitions and exclusions only when they change what a limit or deductible applies to, each as a one-sentence summary.

${COVERAGE_RULE}

${LINE_OF_BUSINESS_RULE}`,
  endorsement: `This section contains one or more endorsements. Return one entry per endorsement with its form number, edition date, title, endorsement number, endorsement type, and a one-sentence summary of what it changes. Set supportStatus to supported when it grants or broadens coverage (for example additional insured, waiver of subrogation, or primary and noncontributory), excluded when it removes or excludes coverage, and requires_review otherwise. Extract its effective date and structured changes:
- coverageChanges: coverages it adds, removes, or modifies, with the new limits and deductibles as printed.
- partyChanges: additional insureds, additional named insureds, loss payees, mortgage holders, or certificate holders it adds or removes, with the scope of their status when printed.
- dateChanges: policy dates it changes.
- premiumChange: any additional or return premium.

${COVERAGE_RULE}

${LINE_OF_BUSINESS_RULE}`,
  application: `This section is an insurance application. Give its title when printed and summarize what it is and its key points in at most three sentences.`,
  invoice: `This section is a premium invoice or billing notice. Summarize it in one sentence. Extract the policy premium only when the invoice states the full policy premium rather than an installment, each tax or fee, the total cost, the amount due, and the due date.`,
  notice: `This section is a notice (for example a policyholder, privacy, terrorism, or cancellation notice). Give its title when printed and summarize its key points in at most three sentences.`,
  other: `Give the title of this section when printed and summarize what it is and its key points in at most three sentences.`,
};

function pageLabel(section: Pick<PolicySection, "pageStart" | "pageEnd">) {
  return section.pageStart === section.pageEnd
    ? `page ${section.pageStart}`
    : `pages ${section.pageStart}-${section.pageEnd}`;
}

export function sectionPageInstructions(
  section: Pick<PolicySection, "pageStart" | "pageEnd">,
  pageCount: number,
): string {
  return `The attached PDF contains only original ${pageLabel(section)} of a ${pageCount}-page document. Page 1 of the attached PDF is original page ${section.pageStart}; add ${section.pageStart - 1} to a page number within the attached PDF to get its original page number. Every citation page must be an original page number from ${section.pageStart} to ${section.pageEnd}.`;
}

export function buildSectionPrompt(args: {
  section: PolicySection;
  pageCount: number;
  declarationsSummary?: string;
}): { system: string; prompt: string } {
  const { section } = args;
  const heading = [
    `Section: ${section.kind.replace(/_/g, " ")}`,
    section.formNumber ? `form ${section.formNumber}` : undefined,
    section.title ? `"${section.title}"` : undefined,
    section.part ? `part ${section.part.index} of ${section.part.count}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    system: SECTION_SYSTEM_PROMPT,
    prompt: [
      `${heading}.`,
      sectionPageInstructions(section, args.pageCount),
      KIND_INSTRUCTIONS[section.kind],
      args.declarationsSummary
        ? `Policy context from the declarations, for orientation only. Extract and cite only what is printed on the attached pages:\n${args.declarationsSummary}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * Original pages a model citation can refer to, in preference order. Models are
 * told to cite original pages; a page that is only valid as a slice-relative
 * number is converted by the slice offset.
 */
export function citationPageCandidates(
  page: number,
  section: Pick<PolicySection, "pageStart" | "pageEnd">,
): number[] {
  if (!Number.isInteger(page)) return [];
  return [...new Set([page, page + section.pageStart - 1])].filter(
    (candidate) => candidate >= section.pageStart && candidate <= section.pageEnd,
  );
}

export function buildDeclarationsSummary(
  outputs: DeclarationsSectionOutput[],
): string | undefined {
  const first = (
    pick: (output: DeclarationsSectionOutput) => string | undefined,
  ) => outputs.map(pick).find((value) => value?.trim());
  const period = [
    first((output) => output.effectiveDate?.value),
    first((output) => output.expirationDate?.value),
  ];
  const coverages = outputs
    .flatMap((output) => output.coverages)
    .map((coverage) =>
      [coverage.name, coverage.limit].filter(Boolean).join(": "),
    );
  const forms = outputs
    .flatMap((output) => output.forms)
    .map((form) => form.formNumber);
  const lines = [
    ["Policy number", first((output) => output.policyNumber?.value)],
    ["Named insured", first((output) => output.namedInsured?.value)],
    ["Carrier", first((output) => output.insurer?.value)],
    ["Policy period", period.every(Boolean) ? period.join(" to ") : undefined],
    [
      "Lines of business",
      [...new Set(outputs.flatMap((output) => output.linesOfBusiness))].join(", "),
    ],
    ["Coverages", coverages.slice(0, 25).join("; ")],
    ["Forms", forms.slice(0, 40).join(", ")],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  return lines.length > 0
    ? lines.join("\n").slice(0, DECLARATIONS_SUMMARY_MAX_CHARS)
    : undefined;
}
