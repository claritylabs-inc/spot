import dayjs from "dayjs";
import { vehicleMakeLabel } from "./vehicle-display";
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
  "What is your business’s legal name?",
  "What name and website does your business use?",
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
] as const;
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
    return (
      [
        "name",
        "email",
        "phone",
        "legalName",
        "description",
        "locations",
      ] as const
    )
      .filter((key) => !a[key]?.trim())
      .map((key) => INTAKE_FIELDS[key]);
  }
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
  if (a.name && a.email && a.phone && a.trigger && a.effectiveDate)
    steps.push(0);
  if (a.coverage && a.coverageScope) steps.push(1);
  if (a.legalName && a.description && a.locations) steps.push(2);
  if (a.currentInsurance) steps.push(3);
  return steps;
}

export function intakeMarkdown(
  answers: IntakeAnswers,
  fields: IntakeField[] = Object.keys(INTAKE_FIELDS) as IntakeField[],
  details?: IntakeDetails,
) {
  const allowed = new Set(fields);
  const cell = (value: string) =>
    value.trim().replace(/\|/g, "\\|").replace(/\r?\n/g, "&#10;");
  const value = (key: IntakeField) => {
    const raw = answers[key]?.trim() ?? "";
    return key === "effectiveDate" && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? dayjs(raw).format("MMMM D, YYYY")
      : raw;
  };
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
        "timingUnknown",
        "requirements",
        "requestDetails",
      ],
    },
    {
      title: "Coverage Requested",
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
      fields: ["currentInsurance", "claims", "cancellations"],
    },
  ];
  return groups
    .flatMap((group) => {
      const keys = group.fields.filter((key) => allowed.has(key) && value(key));
      if (!keys.length) return [];
      if (group.title === "Coverage Requested" && details?.coverages.length) {
        return [
          `## Coverage Requested\n\n${details.coverages
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
                  /^\$?[\d,]+(?:\.\d+)?$/.test(line.limits[limit.key]) &&
                  limit.key !== "statutory"
                    ? `$${line.limits[limit.key].replace(/^\$/, "")}`
                    : line.limits[limit.key],
                ]);
              if (line.additionalCoverages?.trim())
                rows.push([
                  "Additional requirements",
                  line.additionalCoverages!,
                ]);
              if (line.scopeDescription)
                rows.push(["Scope", line.scopeDescription]);
              line.vehicles?.forEach((vehicle, index) =>
                rows.push([
                  `Vehicle ${index + 1}`,
                  [vehicle.year, vehicleMakeLabel(vehicle.make), vehicle.model]
                    .filter(Boolean)
                    .join(" ") + (vehicle.vin ? `\nVIN # ${vehicle.vin}` : ""),
                ]),
              );
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
              return table([
                ["Coverage Requested", coverageRequestLabel(line)],
                ...rows,
              ]);
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
        "claims",
        "cancellations",
      ]);
      const rows: [string, string][] = keys
        .filter(
          (key) =>
            !prose.has(key) &&
            !(key === "locations" && details?.locations.length),
        )
        .map((key) => [INTAKE_FIELDS[key], value(key)]);
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
    .join("\n\n");
}
