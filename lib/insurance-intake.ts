import {
  isFixedVehicleFollowup,
  vehicleUnderwritingRows,
} from "./intake-vehicle-underwriting";
import { AUTO_QUOTE_QUESTIONS } from "./intake-auto-quote";
import { DRIVER_QUESTIONS } from "./intake-drivers";
import {
  followupQuestionVisible,
  formatIntakeFollowupAnswer,
  type IntakeFollowupAnswer,
} from "./intake-followups";
import dayjs from "dayjs";
import { vehicleMakeLabel } from "./vehicle-display";
import { formatIntakeMoney, intakeCurrency } from "./intake-money";
import {
  addressText,
  coverageOption,
  coverageRequestLabel,
  type IntakeDetails,
} from "./insurance-intake-details";

export const INTAKE_VERSION = 2;
export const SAVINGS_INTAKE_REASON = "Save money on my current policies";
export const INTAKE_REASONS = [
  "Purchasing or leasing equipment/vehicles",
  "Purchasing or leasing real estate",
  "Meeting a customer/lender/investor requirement",
  "Starting a new business",
  "Shopping for renewal",
  SAVINGS_INTAKE_REASON,
  "Other",
];
export function hasIntakeRequirements(a: IntakeAnswers) {
  if (INTAKE_REASONS.includes(a.trigger ?? ""))
    return INTAKE_REASONS.slice(0, 3).includes(a.trigger ?? "");
  return !!a.requirements && !["No", "None"].includes(a.requirements);
}
export const INTAKE_STEPS = [
  "What are your contact details?",
  "What’s got you looking for insurance?",
  "When do you need coverage?",
  "Are you buying insurance to meet a customer, lender, or landlord requirement?",
  "Can you share the insurance requirements?",
  "Is there anything else we should know about this request?",
  "What coverages do you need?",
  "What limits and deductibles do you need?",
  "Are there any additional coverages you might need?",
  "What are you looking to get insured?",
  "What is your company name?",
  "What is your company’s legal name and website?",
  "How did you set up your business?",
  "What is your business’s tax ID?",
  "Is your registered business address also your mailing address?",
  "Are there related companies we should know about?",
  "What does your business do?",
  "How many people work at your business?",
  "What is your business’s annual revenue?",
  "Where does your business operate?",
  "Do you have insurance today?",
  "Can you upload your current policies?",
  "What insurance do you have today?",
  "Has your business had any claims?",
  "Can you upload your loss runs?",
  "Has coverage been cancelled or declined for renewal?",
  "Is your business planning any changes?",
  "Are these company details accurate?",
  "Is your request ready to submit?",
  "A few more details for your insurance application",
  "What else should insurers know?",
  ...DRIVER_QUESTIONS,
  ...AUTO_QUOTE_QUESTIONS,
  "We suggest",
] as const;
export const ENTITY_TYPES = [
  "LLC",
  "Corporation",
  "S corporation",
  "Partnership",
  "Sole proprietor",
  "Nonprofit",
  "Trust / estate",
  "Government",
  "Other",
  "Not sure",
] as const;

export const CURRENT_INSURANCE_CHOICES = ["Yes", "No", "Not sure"] as const;

export const INTAKE_FIELDS = {
  intakeGoal: "What would you like help with?",
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
  legalName: "Legal name",
  website: "Website",
  dba: "Company name",
  entityType: "Entity type",
  formation: "State / country of formation",
  fein: "FEIN / tax ID",
  businessNumber: "Canadian business number",
  industry: "Industry",
  industryVertical: "Business category",
  registeredAddress: "Registered business address",
  mailingAddress: "Mailing address",
  relatedEntities: "Related legal entities",
  description: "What does your business do?",
  yearStarted: "Year started",
  fullTime: "Full-time employees",
  partTime: "Part-time employees",
  contractors: "Contractors",
  trailingRevenue: "Annual revenue and reporting period",
  projectedRevenue: "Projected revenue and reporting period",
  locations: "Locations, activities, owned / leased status, and staff",
  companyConfirmed: "Company details confirmed accurate",
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
  if (a.intakeGoal === "savings") {
    return (["name", "email", "legalName", "description"] as const)
      .filter((key) => !a[key]?.trim())
      .map((key) => INTAKE_FIELDS[key]);
  }
  for (const key of [
    "name",
    "email",
    "trigger",
    "coverage",
    "legalName",
    "description",
    "currentInsurance",
  ] as const)
    if (!a[key]?.trim()) missing.push(INTAKE_FIELDS[key]);
  if (!a.effectiveDate?.trim()) missing.push("Desired effective date");
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
export function legacyIntakeMarkdown(
  a: IntakeAnswers,
  fields: IntakeField[] = Object.keys(INTAKE_FIELDS) as IntakeField[],
) {
  return fields
    .flatMap((key) =>
      a[key]?.trim() ? [`### ${INTAKE_FIELDS[key]}\n\n${a[key]!.trim()}`] : [],
    )
    .join("\n\n");
}

export function completedIntakeSteps(a: IntakeAnswers) {
  const steps: number[] = [];
  if (a.name && a.email && a.trigger && a.effectiveDate) steps.push(0);
  if (a.coverage && a.coverageScope) steps.push(1);
  if (a.legalName && a.description) steps.push(2);
  if (a.currentInsurance) steps.push(3);
  return steps;
}

export type CatalogCoverageOwner = (
  row: IntakeFollowupAnswer,
  coverageIds: string[],
) => string | undefined;
/** Answered catalog questions grouped by the coverage that asked them, plus
 * generated follow-ups. Underwriter wording is kept; catalog IDs stay in source data. */
function underwritingAnswers(
  details: IntakeDetails,
  catalogCoverage?: CatalogCoverageOwner,
) {
  const answered = (section: IntakeFollowupAnswer["section"]) =>
    (details.followups ?? []).filter(
      (row) =>
        row.section === section &&
        !isFixedVehicleFollowup(row) &&
        row.answer.trim() &&
        followupQuestionVisible(row, details.followups),
    );
  const catalog = answered("acord");
  const coverageIds = details.coverages.map((line) => line.coverage);
  const owners = new Map(
    catalog.map((row) => [row.id, catalogCoverage?.(row, coverageIds)]),
  );
  return {
    forCoverage: (coverage: string) =>
      catalog.filter((row) => owners.get(row.id) === coverage),
    other: catalog.filter((row) => !owners.get(row.id)),
    followups: answered("additional"),
  };
}

export function intakeMarkdown(
  answers: IntakeAnswers,
  fields: IntakeField[] = Object.keys(INTAKE_FIELDS) as IntakeField[],
  details?: IntakeDetails,
  catalogCoverage?: CatalogCoverageOwner,
) {
  const allowed = new Set(fields);
  const cell = (value: string) =>
    value.trim().replace(/\|/g, "\\|").replace(/\r?\n/g, "&#10;");
  const currency = intakeCurrency(details?.registrationCountry);
  const revenue = details?.revenue;
  const value = (key: IntakeField) => {
    const raw = answers[key]?.trim() ?? "";
    if (key === "trailingRevenue" && revenue?.annualAmount)
      return `${formatIntakeMoney(revenue.annualAmount, currency)} (${revenue.annualPeriod})`;
    if (key === "projectedRevenue" && revenue?.projectedAmount)
      return `${formatIntakeMoney(revenue.projectedAmount, currency)} (${revenue.projectedPeriod})`;
    return ["effectiveDate", "deadline"].includes(key) &&
      /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? dayjs(raw).format("MMMM D, YYYY")
      : raw;
  };
  const full =
    Boolean(details) && fields.length === Object.keys(INTAKE_FIELDS).length;
  const underwriting =
    details && full ? underwritingAnswers(details, catalogCoverage) : undefined;
  const questionRows = (rows: IntakeFollowupAnswer[]): [string, string][] =>
    rows.map((row) => [
      row.label.replace(/\s*Use YYYY-MM-DD\.?$/, ""),
      formatIntakeFollowupAnswer(row, currency),
    ]);
  const table = (rows: [string, string][]) =>
    rows.length
      ? `| Detail | Information |\n| --- | --- |\n${rows.map(([label, text]) => `| ${cell(label)} | ${cell(text)} |`).join("\n")}`
      : "";
  const groups: { title: string; fields: IntakeField[] }[] = [
    { title: "Contact details", fields: ["name", "email", "phone"] },
    {
      title: "Request details",
      fields: [
        "trigger",
        "effectiveDate",
        "deadline",
        "timingUnknown",
        "requirements",
        "requestDetails",
      ],
    },
    {
      title: "Coverage requested",
      fields: ["coverage", "limits", "coverageScope"],
    },
    {
      title: "Business details",
      fields: [
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
      ],
    },
    {
      title: "Insurance history",
      fields: [
        "currentInsurance",
        "currentInsuranceDetails",
        "claims",
        "cancellations",
        "changes",
      ],
    },
  ];
  const sections = groups
    .flatMap((group) => {
      const keys = group.fields.filter((key) => allowed.has(key) && value(key));
      if (!keys.length) return [];
      if (group.title === "Coverage requested" && details?.coverages.length) {
        return [
          `## Coverage requested\n\n${details.coverages
            .map((line) => {
              const option = coverageOption(line.coverage);
              const rows: [string, string][] = option.limits
                .filter(
                  (limit) =>
                    limit.key !== "coverage_description" &&
                    line.limits[limit.key],
                )
                .map((limit) => [
                  limit.label,
                  limit.key === "statutory"
                    ? line.limits[limit.key]
                    : formatIntakeMoney(line.limits[limit.key], currency),
                ]);
              if (line.additionalCoverages?.trim())
                rows.push([
                  "Additional requirements",
                  line.additionalCoverages!,
                ]);
              if (line.scopeDescription)
                rows.push(["Scope", line.scopeDescription]);
              if (line.coverage === "cyber")
                for (const [key, label] of [
                  ["privacyPolicyUrl", "Privacy policy"],
                  ["termsUrl", "Terms of service"],
                ] as const)
                  if (details.cyberDocuments?.[key]?.trim())
                    rows.push([label, details.cyberDocuments[key]!.trim()]);
              line.vehicles?.forEach((vehicle, index) =>
                rows.push([
                  `Vehicle ${index + 1}`,
                  [vehicle.year, vehicleMakeLabel(vehicle.make), vehicle.model]
                    .filter(Boolean)
                    .join(" ") + (vehicle.vin ? `\nVIN # ${vehicle.vin}` : ""),
                ]),
              );
              if (line.coverage === "commercial_auto")
                for (const group of vehicleUnderwritingRows(details!))
                  for (const row of group.rows)
                    if (row.value !== "Not provided")
                      rows.push([`${group.title}: ${row.label}`, row.value]);
              line.properties?.forEach((property, index) =>
                rows.push([
                  property.name || `Property ${index + 1}`,
                  [
                    property.address.formatted ||
                      [
                        property.address.street1,
                        property.address.city,
                        property.address.state,
                        property.address.zip,
                        property.address.country,
                      ]
                        .filter(Boolean)
                        .join(", "),
                    property.details,
                  ]
                    .filter(Boolean)
                    .join("\n\n"),
                ]),
              );
              return `### ${coverageRequestLabel(line)}\n\n${table([
                ...rows,
                ...questionRows(underwriting?.forCoverage(line.coverage) ?? []),
              ])}`;
            })
            .join("\n\n")}

${table(
  (
    [
      ["Limits notes", details.limitsNote],
      ["Scope notes", details.scopeNote],
      ["Additional coverage notes", details.additionalNote],
    ] as [string, string | undefined][]
  ).filter((row): row is [string, string] => Boolean(row[1]?.trim())),
)}`,
        ];
      }
      const prose = new Set<IntakeField>([
        "description",
        "requirements",
        "requestDetails",
        "currentInsuranceDetails",
        "claims",
        "cancellations",
        "changes",
      ]);
      const rows: [string, string][] = keys
        .filter(
          (key) =>
            !prose.has(key) &&
            !(key === "locations" && details?.locations.length),
        )
        .map((key) => [INTAKE_FIELDS[key], value(key)]);
      if (
        group.title === "Insurance history" &&
        details?.noCurrentInsuranceReason?.trim()
      )
        rows.push([
          "Why the business has no current insurance",
          details.noCurrentInsuranceReason,
        ]);
      const paragraphs = keys
        .filter((key) => prose.has(key))
        .map((key) => table([[INTAKE_FIELDS[key], value(key)]]));
      const locations =
        group.title === "Business details" && allowed.has("locations")
          ? (details?.locations.map((location, index) =>
              table(
                (
                  [
                    ["Location", location.name || `Location ${index + 1}`],
                    ["Address", addressText(location.address)],
                    ["Business activities", location.details],
                    [
                      "Occupancy",
                      location.ownership
                        ? location.ownership === "owned"
                          ? "Owned"
                          : "Leased"
                        : "",
                    ],
                    ["Staff", location.staff || ""],
                  ] as [string, string][]
                ).filter(([, text]) => text.trim()),
              ),
            ) ?? [])
          : [];
      return [
        `## ${group.title}\n\n${[table(rows), ...paragraphs, ...locations].filter(Boolean).join("\n\n")}`,
      ];
    })
    .concat(
      underwriting && [...underwriting.other, ...underwriting.followups].length
        ? [
            `## Follow-up questions\n\n${table(
              questionRows([...underwriting.other, ...underwriting.followups]),
            )}`,
          ]
        : [],
    )
    .join("\n\n");
  const drivers =
    details?.coverages.some((line) => line.coverage === "commercial_auto") &&
    details.drivers?.length &&
    allowed.size === Object.keys(INTAKE_FIELDS).length
      ? `## Driver schedule\n\n${table(details.drivers.map((driver) => [driver.name, `License: ${driver.licenseJurisdiction} · ${driver.licenseClass}; experience: ${driver.yearsExperience} years; accidents in past five years: ${driver.accidents} ${driver.accidentDetails}; violations/suspensions in past five years: ${driver.violations} ${driver.violationDetails}. Full license and birth date are retained in the authorized application.`]))}`
      : "";
  const quoteRows: [string, string][] = [];
  if (details && allowed.size === Object.keys(INTAKE_FIELDS).length) {
    if (details.coverages.some((line) => line.coverage === "commercial_auto")) {
      if (details.freightHauled?.trim())
        quoteRows.push(["Freight hauled", details.freightHauled]);
      for (const line of details.coverages)
        for (const vehicle of line.vehicles ?? [])
          if (vehicle.estimatedValue)
            quoteRows.push([
              [vehicle.year, vehicle.make, vehicle.model]
                .filter(Boolean)
                .join(" ") + " — approximate value",
              formatIntakeMoney(vehicle.estimatedValue, currency),
            ]);
    }
  }
  return [
    sections,
    drivers,
    quoteRows.length
      ? `## Additional quote details\n\n${table(quoteRows)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
