import { z } from "zod";
import { INDUSTRIES } from "./industries";
import { IRS_ENTITY_TYPES } from "./entityTypes";
import { normalizeDeclarationValue } from "./declarationFacts";

export const relatedLegalEntitySchema = z.object({
  legalName: z.string().trim().min(1).max(500),
  relationship: z.enum(["current", "fka", "dba", "subsidiary", "parent", "affiliate", "other"]).optional(),
  incorporationNumber: z.string().max(100).optional(),
  taxId: z.string().max(100).optional(),
  jurisdiction: z.string().max(200).optional(),
});

export const insuranceProfilePatchSchema = z.object({
  mailingAddress: z.object({
    street1: z.string().max(300).optional(), street2: z.string().max(300).optional(),
    city: z.string().max(200).optional(), state: z.string().max(100).optional(),
    zip: z.string().max(50).optional(), country: z.string().max(100).optional(),
    formatted: z.string().max(700).optional(),
  }).optional(),
  entityType: z.union([z.enum(IRS_ENTITY_TYPES.map((item) => item.value)), z.literal("")]).optional(),
  fein: z.string().trim().regex(/^(?:\d{2}-?\d{7})?$/, "FEIN must contain 9 digits").optional(),
  businessNumber: z.string().trim().regex(/^(?:\d{9}(?:\s*[A-Za-z]{2}\s*\d{4})?)?$/).optional(),
  operationsDescription: z.string().trim().max(2000).optional(),
});

export type RelatedLegalEntity = z.infer<typeof relatedLegalEntitySchema>;

/** Split only an explicit, single DBA declaration; ordinary names stay intact. */
export function clientIdentity(name: string, entities: RelatedLegalEntity[] = []) {
  const clean = name.trim().replace(/\s+/g, " ");
  const parts = clean.split(/\s+(?:d\/?b\/?a\.?|doing business as)\s+/i);
  const displayName = parts.length === 2 && parts.every((part) => part.trim()) ? parts[1].trim() : clean;
  const names = [...entities];
  if (displayName !== clean) names.push({ legalName: parts[0].trim(), relationship: "current" });
  const merged = new Map<string, RelatedLegalEntity>();
  for (const entity of names) {
    const legalName = entity.legalName.trim().replace(/\s+/g, " ");
    const key = normalizeDeclarationValue(legalName);
    if (!key) continue;
    const defined = Object.fromEntries(Object.entries(entity).filter(([, value]) => value !== undefined));
    merged.set(key, { ...defined, legalName, ...merged.get(key) });
  }
  return { name: displayName, relatedLegalEntities: [...merged.values()] };
}

export function validateClientClassification(industry?: string | null, vertical?: string | null) {
  if (!industry && !vertical) return;
  const match = INDUSTRIES.find((item) => item.value === industry);
  if (!match) throw new Error("Select a supported industry");
  if (vertical && !match.verticals.some((item) => item.value === vertical)) {
    throw new Error("Select a vertical belonging to the selected industry");
  }
}

export function clientIdentityMatches(
  current: { name: string; relatedLegalEntities?: RelatedLegalEntity[] },
  proposedName: string,
) {
  const keys = (name: string, entities: RelatedLegalEntity[] = []) => {
    const identity = clientIdentity(name, entities);
    return new Set([identity.name, ...identity.relatedLegalEntities
      .filter((entity) => entity.relationship === "current" || entity.relationship === "dba")
      .map((entity) => entity.legalName)].map((value) => normalizeDeclarationValue(value)));
  };
  const existing = keys(current.name, current.relatedLegalEntities);
  return [...keys(proposedName)].some((key) => existing.has(key));
}

export function clientClassificationPatch(
  current: { industry?: string; industryVertical?: string },
  input: { industry?: string | null; industryVertical?: string | null },
) {
  const hasIndustry = input.industry !== undefined;
  const hasVertical = input.industryVertical !== undefined;
  if (!hasIndustry && !hasVertical) return {};
  const industry = hasIndustry ? input.industry?.trim() || undefined : current.industry;
  const industryChanged = hasIndustry && industry !== current.industry;
  const industryVertical = hasVertical ? input.industryVertical?.trim() || undefined : industryChanged ? undefined : current.industryVertical;
  validateClientClassification(industry, industryVertical);
  return {
    ...(hasIndustry ? { industry } : {}),
    ...(hasVertical || industryChanged ? { industryVertical } : {}),
  };
}

export function mergeInsuranceProfilePatch(
  overrides: z.infer<typeof insuranceProfilePatchSchema> | undefined,
  effectiveAddress: NonNullable<z.infer<typeof insuranceProfilePatchSchema>["mailingAddress"]>,
  input: z.infer<typeof insuranceProfilePatchSchema>,
) {
  return {
    ...overrides,
    ...input,
    ...(input.mailingAddress !== undefined ? {
      mailingAddress: Object.keys(input.mailingAddress).length === 0
        ? {}
        : { ...effectiveAddress, ...input.mailingAddress },
    } : {}),
  };
}

export const CLIENT_PROFILE_GUIDANCE = `When importing or updating a client, read its full profile and company .md document first. Use the verified operating/DBA name as the client name; put the legal named entity under relatedLegalEntities with relationship=current, and preserve explicitly supported subsidiaries, parents, affiliates, and former names. A named insured is not automatically a subsidiary. Never invent a DBA or legal relationship. Keep mailing address, entity type, FEIN/business number, and a concise operations description in insuranceProfile. Put detailed operations, dated revenue/headcount, ownership narrative, locations, products, preferences, and other durable context in the company .md document with normal Markdown headings and YAML front matter. Preserve existing facts and human edits; report conflicts. Public web research is required for intake: use web_search to identify the official website and support industry/vertical classification; read the official site and cite sources. Search only public identity terms, never tax IDs or private source content. Use supported industry and vertical values. Unknown facts stay unknown with an explicit research outcome; a queued or failed research run is not a completed import. Read back the profile, companyResearch status, and wiki before reporting completion.`;
