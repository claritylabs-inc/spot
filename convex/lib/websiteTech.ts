import { v, type Infer } from "convex/values";
import { publicResearchUrl } from "./companyResearch";

export const websiteTechSignalValidator = v.object({
  category: v.string(),
  name: v.string(),
  evidence: v.string(),
  source: v.union(
    v.literal("html"),
    v.literal("headers"),
    v.literal("dns"),
    v.literal("browser"),
  ),
  region: v.optional(v.string()),
});

export const websiteTechDisclosureValidator = v.object({
  category: v.union(
    v.literal("payment_processor"),
    v.literal("hosting_provider"),
    v.literal("data_region"),
    v.literal("subprocessor"),
  ),
  name: v.string(),
  detail: v.optional(v.string()),
  sourceUrl: v.string(),
  quote: v.string(),
});

// Jev's reconciled candidates per underwriting question, each scored from the evidence found.
export const websiteTechInferenceValidator = v.object({
  topic: v.union(
    v.literal("payment_processor"),
    v.literal("hosting_provider"),
    v.literal("data_region"),
  ),
  answer: v.string(),
  confidence: v.number(),
});

export type WebsiteTechInference = Infer<typeof websiteTechInferenceValidator>;
export type WebsiteTechSignal = Infer<typeof websiteTechSignalValidator>;
export type WebsiteTechDisclosure = Infer<typeof websiteTechDisclosureValidator>;

/** Scans are keyed by bare hostname so intake drafts and organizations share one result. */
export function websiteTechDomain(website: string | undefined) {
  const trimmed = website?.trim();
  if (!trimmed) return null;
  const url = publicResearchUrl(
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
  );
  return url ? new URL(url).hostname.replace(/^www\./, "") : null;
}

const AWS_REGION_COUNTRY: Record<string, string> = {
  "eu-west-1": "Ireland",
  "eu-west-2": "United Kingdom",
  "eu-west-3": "France",
  "eu-central-1": "Germany",
  "eu-central-2": "Switzerland",
  "eu-north-1": "Sweden",
  "eu-south-1": "Italy",
  "eu-south-2": "Spain",
  "ap-northeast-1": "Japan",
  "ap-northeast-2": "South Korea",
  "ap-northeast-3": "Japan",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Australia",
  "ap-southeast-3": "Indonesia",
  "ap-south-1": "India",
  "ap-east-1": "Hong Kong",
  "sa-east-1": "Brazil",
  "af-south-1": "South Africa",
  "me-central-1": "United Arab Emirates",
  "me-south-1": "Bahrain",
  "il-central-1": "Israel",
};

/** Best-guess country for a cloud region such as "iad1 (AWS us-east-1)" or "eu-west-2". */
export function regionCountry(region: string | undefined) {
  const code = region?.match(/\b[a-z]{2}(?:-gov)?-[a-z]+-\d\b/i)?.[0].toLowerCase();
  if (!code) return null;
  if (AWS_REGION_COUNTRY[code]) return AWS_REGION_COUNTRY[code];
  if (code.startsWith("us-")) return "United States";
  if (code.startsWith("ca-")) return "Canada";
  return null;
}

/** Receives signup verification mail for the browser agent; never routed to agents or operators. */
export const RESEARCH_EMAIL_DOMAIN = "research.spot.insure";

export function isResearchEmailAddress(address: string) {
  return address.trim().toLowerCase().endsWith(`@${RESEARCH_EMAIL_DOMAIN}`);
}
