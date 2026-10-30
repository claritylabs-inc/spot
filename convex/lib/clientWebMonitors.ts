import { z } from "zod";
import type { ClRouterMonitorField } from "./clRouterClient";
import { publicResearchUrl } from "./companyResearch";

export const CLIENT_WEB_MONITOR_CALLBACK_PATH = "/router-monitors/events";
export const CLIENT_WEB_MONITOR_BODY_BYTES = 256 * 1024;
export const DEFAULT_CLIENT_WEB_MONITOR_FREQUENCY = "1d";
export const CLIENT_WEB_MONITOR_ATTENTION_DAYS = 30;
export const CLIENT_WEB_MONITOR_ACKNOWLEDGED_RETENTION_DAYS = 180;
export const CLIENT_WEB_MONITOR_RETENTION_DAYS = 365;
export const CLIENT_WEB_MONITOR_SWEEP_BATCH = 200;
// A create that never finished (the action died between its steps) stops
// blocking a new monitor after this long.
export const CLIENT_WEB_MONITOR_PENDING_MS = 10 * 60 * 1000;

export const CLIENT_WEB_MONITOR_CATEGORIES = [
  "litigation",
  "regulatory_action",
  "sanctions",
  "data_breach",
  "product_recall",
  "safety_violation",
  "layoffs",
  "corporate_transaction",
  "executive_change",
  "location_change",
  "major_contract",
  "bankruptcy",
  "other",
] as const;

export const CLIENT_WEB_MONITOR_QUERY =
  "Material public developments for this exact company: lawsuits and litigation, regulatory or enforcement actions, sanctions, data breaches and cyber incidents, product recalls, safety violations, layoffs, mergers, acquisitions and funding, executive changes, new or closed locations, major contracts and bankruptcy. Exclude marketing content, press-release fluff, job postings and routine product announcements.";

export const CLIENT_WEB_MONITOR_FIELDS: ClRouterMonitorField[] = [
  {
    key: "category",
    description: "The kind of development this event reports.",
    type: "enum",
    options: [...CLIENT_WEB_MONITOR_CATEGORIES],
  },
  {
    key: "headline",
    description: "One-line headline of the event, under 150 characters.",
    type: "string",
  },
  {
    key: "materiality",
    description:
      "How material the event is to an insurer underwriting this company: high for legal, regulatory, cyber, safety, solvency or ownership events, low for minor operational news.",
    type: "enum",
    options: ["low", "medium", "high"],
  },
  {
    key: "summary",
    description: "Two or three sentences stating only what the sources report.",
    type: "string",
  },
];

const FREQUENCY_HOURS = { h: 1, d: 24, w: 168 } as const;

/** Router frequencies are `<n>h|d|w`, between one hour and thirty days. */
export function isClientWebMonitorFrequency(value: string) {
  const match = /^([1-9]\d*)(h|d|w)$/.exec(value);
  if (!match) return false;
  const hours = Number(match[1]) * FREQUENCY_HOURS[match[2] as "h" | "d" | "w"];
  return hours >= 1 && hours <= 30 * 24;
}

export function clientWebMonitorPublicWebsite(website: string | undefined) {
  const trimmed = website?.trim();
  if (!trimmed) return undefined;
  const url = publicResearchUrl(
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
  );
  return url ? new URL(url).origin : undefined;
}

export function newClientWebMonitorToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
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

/** Contract M consumer callback; unknown fields are rejected. */
export const clientWebMonitorCallbackSchema = z.strictObject({
  contractVersion: z.literal(1),
  monitorId: z.string().min(1).max(300),
  orgId: z.string().min(1).max(512).optional(),
  deliveryId: z.string().min(1).max(200),
  kind: z.enum(["events", "execution_failed"]),
  events: z
    .array(
      z.strictObject({
        eventId: z.string().min(1).max(300),
        eventDate: z.string().max(100).optional(),
        summary: z.string().max(4000).optional(),
        answers: z.record(z.string(), answerSchema).optional(),
        citations: citationsSchema,
      }),
    )
    .max(50),
});

export type ClientWebMonitorCallback = z.infer<
  typeof clientWebMonitorCallbackSchema
>;
type CallbackEvent = ClientWebMonitorCallback["events"][number];

function answerText(event: CallbackEvent, key: string) {
  const value = event.answers?.[key]?.value;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedCitations(event: CallbackEvent) {
  const sources = event.citations.length
    ? event.citations
    : (event.answers?.headline?.citations ?? []);
  const seen = new Set<string>();
  const citations: Array<{ url: string; title?: string; excerpt?: string }> = [];
  for (const source of sources) {
    const url = publicResearchUrl(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      url,
      ...(source.title ? { title: source.title } : {}),
      ...(source.excerpts?.[0]
        ? { excerpt: source.excerpts[0].slice(0, 600) }
        : {}),
    });
  }
  return citations;
}

/** The stored shape of one callback event: bounded, cited, never instructions. */
export function clientWebMonitorEventFields(event: CallbackEvent) {
  const category = CLIENT_WEB_MONITOR_CATEGORIES.find(
    (known) => known === answerText(event, "category"),
  );
  const materiality = (["low", "medium", "high"] as const).find(
    (level) => level === answerText(event, "materiality"),
  );
  const summary = answerText(event, "summary") ?? event.summary;
  const headline =
    answerText(event, "headline") ?? summary?.split(/(?<=[.!?])\s/)[0];
  return {
    eventId: event.eventId,
    ...(event.eventDate ? { eventDate: event.eventDate } : {}),
    ...(category ? { category } : {}),
    headline: (headline ?? "Public development detected").slice(0, 300),
    ...(summary ? { summary: summary.slice(0, 4000) } : {}),
    ...(materiality ? { materiality } : {}),
    citations: boundedCitations(event),
  };
}
