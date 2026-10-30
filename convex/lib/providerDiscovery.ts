import { z } from "zod";
import { COVERAGE_OPTIONS } from "../../lib/insurance-intake-details";
import type {
  ClRouterCreateDiscoveryRequest,
  ClRouterDiscoveryGenerator,
} from "./clRouterClient";
import { USPS_STATE_CODES, USPS_STATE_NAMES } from "./brokerProfileValidation";
import { publicResearchUrl } from "./companyResearch";
import { NoWriteInputError } from "./noWriteInputError";
import { providerDomain } from "./operatorBrokerProfiles";

export const PROVIDER_DISCOVERY_CALLBACK_PATH = "/router-discoveries/events";
export const PROVIDER_DISCOVERY_BODY_BYTES = 1024 * 1024;
export const DEFAULT_PROVIDER_DISCOVERY_MATCH_LIMIT = 25;
export const MAX_PROVIDER_DISCOVERY_MATCH_LIMIT = 50;
export const MAX_PROVIDER_DISCOVERY_EXCLUDES = 1_000;
// A create that never finished (the action died between its steps) fails and
// stops blocking a new discovery after this long.
export const PROVIDER_DISCOVERY_PENDING_MS = 10 * 60 * 1000;
// The router retries delivery for about an hour after the provider finishes.
export const PROVIDER_DISCOVERY_RUNNING_MS = 6 * 60 * 60 * 1000;

export const PROVIDER_DISCOVERY_ENTITY_TYPE =
  "insurance carriers, MGAs, program administrators and wholesale brokers";

export const PROVIDER_DISCOVERY_TYPES = [
  "carrier",
  "mga",
  "wholesaler",
  "program_administrator",
  "agency",
  "other",
] as const;

const PROVIDER_DISCOVERY_FIELDS: ClRouterCreateDiscoveryRequest["input"]["fields"] =
  [
    {
      key: "provider_type",
      description: "What kind of insurance market this organization is.",
      type: "enum",
      options: [...PROVIDER_DISCOVERY_TYPES],
    },
    {
      key: "lines_offered",
      description:
        "Lines of business the organization writes or places, as its own pages state them.",
      type: "string",
    },
    {
      key: "states_served",
      description:
        "US states or Canadian provinces where the organization can write business, as its own pages state them.",
      type: "string",
    },
    {
      key: "appointment_url",
      description:
        "URL of the page where producers or retail brokers get appointed or submit business.",
      type: "string",
    },
  ];

export type ProviderDiscoveryCriteria = {
  lines: string[];
  states: string[];
  industry?: string;
};

/** Coverage catalog labels a discovery can search for. */
export const PROVIDER_DISCOVERY_LINES: readonly string[] = COVERAGE_OPTIONS.filter(
  (option) => option.id !== "unknown" && option.id !== "other",
).map((option) => option.label);
export const MAX_PROVIDER_DISCOVERY_LINES = 10;
export const MAX_PROVIDER_DISCOVERY_STATES = 20;
export const MAX_PROVIDER_DISCOVERY_INDUSTRY_CHARS = 80;

const LINE_BY_KEY = new Map(
  PROVIDER_DISCOVERY_LINES.map((label) => [label.toLowerCase(), label]),
);
const STATE_CODES = new Set<string>(USPS_STATE_CODES);

/**
 * Only public, non-identifying criteria: coverage catalog labels, USPS state
 * codes and an optional generic industry. Never client or request details.
 */
export function providerDiscoveryCriteria(input: {
  lines: string[];
  states: string[];
  industry?: string;
}): ProviderDiscoveryCriteria {
  const lines = [
    ...new Set(
      input.lines.map((line) => {
        const label = LINE_BY_KEY.get(line.trim().toLowerCase());
        if (!label)
          throw new NoWriteInputError(
            "invalid_line",
            `${JSON.stringify(line)} is not a coverage line. Use one of: ${PROVIDER_DISCOVERY_LINES.join(", ")}.`,
          );
        return label;
      }),
    ),
  ];
  if (!lines.length || lines.length > MAX_PROVIDER_DISCOVERY_LINES)
    throw new NoWriteInputError(
      "invalid_lines",
      `Pass 1–${MAX_PROVIDER_DISCOVERY_LINES} coverage lines.`,
    );
  const states = [
    ...new Set(
      input.states.map((state) => {
        const code = state.trim().toUpperCase();
        if (!STATE_CODES.has(code))
          throw new NoWriteInputError(
            "invalid_state",
            `${JSON.stringify(state)} is not a US state code.`,
          );
        return code;
      }),
    ),
  ];
  if (!states.length || states.length > MAX_PROVIDER_DISCOVERY_STATES)
    throw new NoWriteInputError(
      "invalid_states",
      `Pass 1–${MAX_PROVIDER_DISCOVERY_STATES} US state codes.`,
    );
  const industry = input.industry?.trim();
  if (industry && industry.length > MAX_PROVIDER_DISCOVERY_INDUSTRY_CHARS)
    throw new NoWriteInputError(
      "invalid_industry",
      `Keep the industry to ${MAX_PROVIDER_DISCOVERY_INDUSTRY_CHARS} characters.`,
    );
  return { lines, states, ...(industry ? { industry } : {}) };
}

function listText(values: string[]) {
  return values.length > 1
    ? `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`
    : values[0];
}

/** The router request body's input: the criteria, phrased for the provider. */
export function providerDiscoveryInput(
  criteria: ProviderDiscoveryCriteria,
  options: {
    matchLimit: number;
    generator: ClRouterDiscoveryGenerator;
    exclude: Array<{ name: string; url: string }>;
  },
): ClRouterCreateDiscoveryRequest["input"] {
  const lines = listText(criteria.lines);
  const states = listText(criteria.states.map((code) => USPS_STATE_NAMES[code] ?? code));
  return {
    objective: `Find insurance markets that write ${lines} for ${criteria.industry ? `${criteria.industry} ` : ""}businesses in ${states} and accept submissions from retail brokers.`,
    entityType: PROVIDER_DISCOVERY_ENTITY_TYPE,
    matchConditions: [
      {
        name: "writes_lines",
        description: `Writes or places ${lines} insurance.`,
      },
      {
        name: "serves_states",
        description: `Can write business in ${states}.`,
      },
      {
        name: "market_type",
        description:
          "Is an insurance carrier, MGA, program administrator or wholesale broker, not a consumer comparison site, lead-generation site or retail agency.",
      },
      ...(criteria.industry
        ? [
            {
              name: "industry_appetite",
              description: `Has stated appetite for ${criteria.industry} businesses.`,
            },
          ]
        : []),
    ],
    matchLimit: options.matchLimit,
    generator: options.generator,
    ...(options.exclude.length ? { exclude: options.exclude } : {}),
    fields: PROVIDER_DISCOVERY_FIELDS,
  };
}

/** Broker-profile domain normalization; null when the value is not a public host. */
export function providerDiscoveryDomain(value: string | undefined) {
  if (!value) return null;
  try {
    return providerDomain(value);
  } catch {
    return null;
  }
}

const citationSchema = z.strictObject({
  url: z.string().max(2048),
  title: z.string().max(500).optional(),
  excerpts: z.array(z.string().max(1000)).max(3).optional(),
});
const citationsSchema = z.array(citationSchema).max(10);
const answerSchema = z.strictObject({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
  citations: citationsSchema,
  reasoning: z.string().max(2000).optional(),
});

/** Contract D consumer callback; unknown fields are rejected. */
export const providerDiscoveryCallbackSchema = z.strictObject({
  contractVersion: z.literal(1),
  discoveryId: z.string().min(1).max(300),
  orgId: z.string().min(1).max(512).optional(),
  deliveryId: z.string().min(1).max(200),
  kind: z.enum(["completed", "failed", "cancelled"]),
  candidates: z
    .array(
      z.strictObject({
        candidateId: z.string().min(1).max(300),
        name: z.string().min(1).max(300),
        url: z.string().max(2048),
        description: z.string().max(2000).optional(),
        conditions: z
          .array(
            z.strictObject({
              name: z.string().min(1).max(64),
              matched: z.boolean(),
              value: z.string().max(1000).optional(),
              citations: citationsSchema,
            }),
          )
          .max(10),
        answers: z.record(z.string(), answerSchema).optional(),
      }),
    )
    .max(100),
});

type CallbackCandidate = z.infer<
  typeof providerDiscoveryCallbackSchema
>["candidates"][number];

function answerText(candidate: CallbackCandidate, key: string) {
  const value = candidate.answers?.[key]?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedCitations(citations: z.infer<typeof citationsSchema>) {
  const seen = new Set<string>();
  const bounded: Array<{ url: string; title?: string; excerpt?: string }> = [];
  for (const source of citations) {
    const url = publicResearchUrl(source.url);
    if (!url || seen.has(url) || bounded.length === 3) continue;
    seen.add(url);
    bounded.push({
      url,
      ...(source.title ? { title: source.title } : {}),
      ...(source.excerpts?.[0]
        ? { excerpt: source.excerpts[0].slice(0, 600) }
        : {}),
    });
  }
  return bounded;
}

/** The stored shape of one candidate: bounded, cited, never instructions. Null without a public website. */
export function providerDiscoveryCandidateFields(candidate: CallbackCandidate) {
  const url = publicResearchUrl(candidate.url);
  const domain = url ? providerDiscoveryDomain(url) : null;
  if (!url || !domain) return null;
  const providerType = PROVIDER_DISCOVERY_TYPES.find(
    (type) => type === answerText(candidate, "provider_type"),
  );
  const linesOffered = answerText(candidate, "lines_offered");
  const statesServed = answerText(candidate, "states_served");
  const appointment = answerText(candidate, "appointment_url");
  const appointmentUrl = appointment ? publicResearchUrl(appointment) : null;
  return {
    name: candidate.name.trim().slice(0, 300) || domain,
    url,
    domain,
    ...(candidate.description
      ? { description: candidate.description.slice(0, 2000) }
      : {}),
    conditions: candidate.conditions.map((condition) => ({
      name: condition.name,
      matched: condition.matched,
      ...(condition.value ? { value: condition.value.slice(0, 1000) } : {}),
      citations: boundedCitations(condition.citations),
    })),
    ...(providerType ? { providerType } : {}),
    ...(linesOffered ? { linesOffered: linesOffered.slice(0, 500) } : {}),
    ...(statesServed ? { statesServed: statesServed.slice(0, 500) } : {}),
    ...(appointmentUrl ? { appointmentUrl } : {}),
  };
}
