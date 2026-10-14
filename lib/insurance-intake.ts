export const INTAKE_VERSION = 2;
export const INTAKE_REASONS = [
  "Purchasing or leasing equipment/vehicles",
  "Purchasing or leasing real estate",
  "Meeting a customer/lender/investor requirement",
  "Starting a new business",
  "Shopping for renewal",
  "Other",
];
export function hasIntakeRequirements(a: IntakeAnswers) {
  if (INTAKE_REASONS.includes(a.trigger ?? ""))
    return INTAKE_REASONS.slice(0, 3).includes(a.trigger ?? "");
  return !!a.requirements && !["No", "None"].includes(a.requirements);
}
export const INTAKE_STEPS = [
  "What are your contact details?",
  "Why are you buying insurance?",
  "When do you need coverage?",
  "Are you buying insurance to meet a customer, lender, or landlord requirement?",
  "Can you share the insurance requirements?",
  "Is there anything else we should know about this request?",
  "What coverages do you need?",
  "What limits and deductibles do you need?",
  "Are there any additional coverages you might need?",
  "What are you looking to get insured?",
  "What is your business’s legal name?",
  "What name and website does your business use?",
  "How did you set up your business?",
  "What is your business’s tax ID?",
  "Is your registered business address also your mailing address?",
  "Are there related companies we should know about?",
  "What does your business do?",
  "How many people work at your business?",
  "What is your business’s revenue?",
  "Where does your business operate?",
  "Do you have insurance today?",
  "Can you upload your current policies?",
  "What insurance do you have today?",
  "Has your business had any claims?",
  "Can you upload your loss runs?",
  "Has coverage been cancelled or declined for renewal?",
  "Is your business planning any changes?",
  "Are these company details current?",
  "Is your request ready to submit?",
] as const;
export const INTAKE_FIELDS = {
  name: "Full name",
  email: "Work email",
  phone: "Phone number",
  trigger: "What prompted this request?",
  effectiveDate: "Desired effective date",
  deadline: "Hard deadline",
  timingUnknown: "Timing is not yet known",
  requestDetails: "Anything else about the request",
  requirements: "Insurance requirements",
  coverage: "Requested coverages",
  limits: "Desired limits and deductibles",
  separateQuotes: "Additional coverages requested",
  coverageScope: "What you are looking to get insured",
  legalName: "Company legal name",
  website: "Website",
  dba: "DBA / trading name",
  entityType: "Entity type",
  formation: "State / country of formation",
  fein: "FEIN / tax ID",
  businessNumber: "Canadian business number",
  industry: "Industry",
  industryVertical: "Business category",
  registeredAddress: "Registered business address",
  mailingAddress: "Mailing address",
  relatedEntities: "Related legal entities and relationships",
  description: "What does your business do?",
  yearStarted: "Year started",
  fullTime: "Full-time employees",
  partTime: "Part-time employees",
  contractors: "Contract workers",
  trailingRevenue: "Trailing revenue and reporting period",
  projectedRevenue: "Projected revenue and reporting period",
  locations: "Locations, activities, owned / leased status, and staff",
  companyConfirmed: "Company details confirmed current",
  currentInsurance: "Do you currently have insurance?",
  currentInsuranceDetails:
    "Carriers, coverage, limits, premiums, and expiration dates",
  claims: "Claims and loss history, including open claims",
  cancellations: "Cancellations, nonrenewals, declines, or uninsured periods",
  changes: "Changes since your current policies were issued",
} as const;
export type IntakeField = keyof typeof INTAKE_FIELDS;
export type IntakeAnswers = Partial<Record<IntakeField, string>>;
export function missingIntakeAnswers(a: IntakeAnswers) {
  const missing: string[] = [];
  for (const key of [
    "name",
    "email",
    "phone",
    "trigger",
    "coverage",
    "legalName",
    "description",
    "locations",
    "currentInsurance",
  ] as const)
    if (!a[key]?.trim()) missing.push(INTAKE_FIELDS[key]);
  if (!a.effectiveDate?.trim()) missing.push("Desired effective date");
  if (a.companyConfirmed !== "yes")
    missing.push("Confirm company details are current");
  return missing;
}
export const COMPANY_INTAKE_FIELDS: IntakeField[] = [
  "legalName",
  "website",
  "dba",
  "entityType",
  "formation",
  "fein",
  "businessNumber",
  "industry",
  "industryVertical",
  "registeredAddress",
  "mailingAddress",
  "relatedEntities",
  "description",
  "yearStarted",
  "fullTime",
  "partTime",
  "contractors",
  "trailingRevenue",
  "projectedRevenue",
  "locations",
];
export function intakeMarkdown(
  a: IntakeAnswers,
  fields: IntakeField[] = Object.keys(INTAKE_FIELDS) as IntakeField[],
) {
  return fields
    .flatMap((key) =>
      a[key]?.trim() ? [`### ${INTAKE_FIELDS[key]}\n\n${a[key]!.trim()}`] : [],
    )
    .join("\n\n");
}

export function intakeFollowUps(a: IntakeAnswers, categories: string[]) {
  const items: string[] = [];
  if (!a.effectiveDate) items.push("Confirm effective date");
  if (
    a.coverage?.startsWith("Not sure") ||
    a.coverage === "I'm not sure" ||
    a.limits?.includes("I'm not sure") ||
    !a.limits
  )
    items.push("Advise on coverage lines, limits, and deductibles");
  if (hasIntakeRequirements(a)) {
    if (!categories.includes("requirements") && !a.requirements?.trim())
      items.push("Obtain third-party insurance requirements");
    items.push("Review contract limits and endorsement requirements");
  }
  if (a.currentInsurance === "Yes" && !categories.includes("policy"))
    items.push("Obtain current policies");
  if (!a.claims || a.claims.toLowerCase().includes("not sure"))
    items.push("Confirm claims and loss history");
  if (!a.mailingAddress) items.push("Confirm mailing address");
  if (!a.trailingRevenue || !a.projectedRevenue)
    items.push("Confirm revenue and reporting periods");
  return items;
}

export function completedIntakeSteps(a: IntakeAnswers) {
  const steps: number[] = [];
  if (a.name && a.email && a.phone && a.trigger && a.effectiveDate)
    steps.push(0);
  if (a.coverage && a.coverageScope) steps.push(1);
  if (
    a.legalName &&
    a.description &&
    a.locations &&
    a.companyConfirmed === "yes"
  )
    steps.push(2);
  if (a.currentInsurance) steps.push(3);
  return steps;
}
