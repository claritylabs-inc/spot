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

// Jev's best answer to each underwriting question, chosen among evidenced candidates.
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
