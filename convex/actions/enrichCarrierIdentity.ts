"use node";

import dayjs from "dayjs";
import { v } from "convex/values";
import { z } from "zod";
import { decideWithFallback } from "../lib/decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
} from "../lib/domainDecisionQuestions";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  CARRIER_IDENTITY_ENRICHMENT_VERSION,
  carrierIdentityResearchNames,
  groundCarrierIdentitySelection,
  normalizeCarrierIdentityName,
  type GroundedCarrierIdentitySelection,
} from "../lib/carrierIdentityEnrichment";
import { generateObjectForOrg } from "../lib/models";
import { runWebRetrieval, type WebRetrievalSource } from "../lib/webRetrieval";
import {
  normalizePublicWebsiteUrl,
  readWebsiteFaviconSignals,
  readWebsiteBrandSignals,
} from "../lib/websiteBrand";
import {
  readCarrierIdentity,
  type CarrierIdentityAccentColorSource,
} from "../lib/carrierIdentity";

const MAX_CANDIDATE_SITES = 4;
const RETRY_DELAYS_MS = [30_000, 5 * 60_000];

const CarrierIdentitySelectionSchema = z.object({
  candidateIndex: z.number().int().min(-1),
  officialSite: z.boolean(),
  publicName: z.string().min(1).max(120).nullable(),
  nameRelationship: z
    .enum(["same_legal_entity", "trading_name", "parent_brand", "group_brand"])
    .nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string().min(1).max(500),
});

type CarrierIdentityPolicy = Pick<
  Doc<"policies">,
  "carrier" | "carrierIdentity" | "security" | "carrierLegalName" | "insurer"
>;

type CandidateSite = {
  website: string;
  title?: string;
  siteName?: string;
  identityEvidence?: string;
  primaryColor?: string;
  primaryColorSource?: CarrierIdentityAccentColorSource;
  colorCandidates: string[];
};

type CarrierIdentityEnrichmentResult = {
  success: boolean;
  cached?: boolean;
  reason?: "not_found" | "missing_carrier" | "in_progress" | "lookup_failed";
};

function carrierNamesForPolicy(policy: CarrierIdentityPolicy) {
  const identity = readCarrierIdentity(policy.carrierIdentity);
  return carrierIdentityResearchNames(identity, [
    policy.carrier,
    policy.insurer?.legalName,
    policy.carrierLegalName,
    policy.security,
  ]);
}

type CandidateSeed = {
  url: string;
  title?: string;
  snippet?: string;
};

function candidateUrls(
  sources: WebRetrievalSource[],
  retrievalText: string,
): CandidateSeed[] {
  const candidates = [
    ...sources.map((source) => ({
      url: source.url,
      title: source.title,
      snippet: source.snippet,
    })),
    ...Array.from(retrievalText.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)).map(
      (match) => ({ url: match[0] }),
    ),
  ];
  const seenUrls = new Set<string>();
  return candidates
    .flatMap((candidate): CandidateSeed[] => {
      try {
        const parsed = new URL(normalizePublicWebsiteUrl(candidate.url));
        parsed.hash = "";
        const normalizedUrl = parsed.toString();
        if (seenUrls.has(normalizedUrl)) return [];
        seenUrls.add(normalizedUrl);
        return [{ ...candidate, url: normalizedUrl }];
      } catch {
        return [];
      }
    })
    .slice(0, MAX_CANDIDATE_SITES);
}

function boundedEvidence(parts: Array<string | undefined>) {
  const evidence = Array.from(
    new Set(
      parts
        .map((part) => part?.replace(/\s+/g, " ").trim())
        .filter((part): part is string => Boolean(part)),
    ),
  ).join("\n");
  return evidence.slice(0, 8_000) || undefined;
}

async function inspectCarrierCandidate(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  carrierName: string,
  seed: CandidateSeed,
): Promise<CandidateSite> {
  const [directSignals, extracted] = await Promise.all([
    readWebsiteBrandSignals(seed.url).catch(() => null),
    runWebRetrieval(ctx, orgId, {
      url: seed.url,
      goal: `Extract first-party evidence that connects ${carrierName} to the organization or brand represented by this site. Preserve exact legal, syndicate, trading-name, DBA, operating-name, parent, and group wording.`,
    }).catch(() => null),
  ]);
  return {
    website: directSignals?.website ?? seed.url,
    title: directSignals?.title ?? seed.title,
    siteName: directSignals?.siteName,
    identityEvidence: boundedEvidence([
      directSignals?.identityEvidence,
      seed.snippet,
      ...(extracted?.sources.map((source) => source.snippet) ?? []),
      extracted?.text,
    ]),
    primaryColor: directSignals?.primaryColor,
    primaryColorSource: directSignals?.primaryColorSource,
    colorCandidates: directSignals?.colorCandidates ?? [],
  };
}

async function applyCachedIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
  normalizedName: string,
) {
  const existing = await ctx.runQuery(
    internal.carrierIdentityCache.getByNormalizedNameInternal,
    { normalizedName },
  );
  if (
    !existing ||
    existing.enrichmentVersion !== CARRIER_IDENTITY_ENRICHMENT_VERSION
  ) {
    return { applied: false, identityChanged: false };
  }
  return await ctx.runMutation(
    internal.carrierIdentityCache.applyToPolicyInternal,
    {
      policyId,
      cacheEntryId: existing._id,
      normalizedName,
    },
  );
}

async function rescheduleChangedCarrierIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
) {
  await ctx.scheduler.runAfter(
    0,
    internal.actions.enrichCarrierIdentity.ensureInternal,
    { policyId },
  );
}

function reusableCacheSources(
  cachedIdentities: Array<Doc<"carrierBrands"> | null>,
): WebRetrievalSource[] {
  return cachedIdentities.flatMap((cachedIdentity) => {
    if (!cachedIdentity || cachedIdentity.confidence === "low") return [];
    return [
      {
        url: cachedIdentity.website,
        title: cachedIdentity.websiteTitle,
      },
      ...cachedIdentity.sourceUrls.map((url) => ({ url })),
    ];
  });
}

async function selectCarrierIdentityWithModel(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  carrierName: string,
  sites: CandidateSite[],
  retrievalText: string,
): Promise<GroundedCarrierIdentitySelection> {
  return decideWithFallback({
    ctx,
    orgId,
    family: "identity.carrier_website",
    state: decisionState({
      carrierName,
      sites,
      retrievalText: retrievalText.slice(0, 8_000),
    }),
    questions: {
      site: choiceQuestion(
        "Which official first-party site explicitly identifies the exact carrier, trading name, parent or group? Reject namesakes, brokers, directories, portals and unsupported name similarity.",
        Object.fromEntries(
          sites.map((site, index) => [
            String(index),
            { candidate: decisionState(site) },
          ]),
        ),
      ),
      ...Object.fromEntries(
        sites.map((site, index) => [
          `relationship_${index}`,
          choiceQuestion(
            "If this site is official, how is its siteName related to the policy carrier? Require an explicit first-party relationship, never infer a subsidiary from an additional insured.",
            {
              same_legal_entity: "Same legal entity's concise public name.",
              trading_name: "Explicit documented DBA/trading name.",
              parent_brand: "Explicit documented parent brand.",
              group_brand: "Explicit documented group brand.",
              unnamed:
                "Official site established but no supported public name.",
            },
            { site: decisionState(site) },
          ),
        ]),
      ),
    },
    accept: (answers) => {
      const choice = acceptedChoice(
        answers.site,
        sites.map((_, index) => String(index)),
      );
      if (!choice) return undefined;
      const index = Number(choice.value);
      const relationship = acceptedChoice(answers[`relationship_${index}`], [
        "same_legal_entity",
        "trading_name",
        "parent_brand",
        "group_brand",
        "unnamed",
      ]);
      if (!relationship) return undefined;
      const named = relationship.value !== "unnamed";
      if (named && !sites[index].siteName) return undefined;
      try {
        return groundCarrierIdentitySelection(
          {
            candidateIndex: index,
            officialSite: true,
            publicName: named ? sites[index].siteName! : null,
            nameRelationship: named
              ? (relationship.value as
                  | "same_legal_entity"
                  | "trading_name"
                  | "parent_brand"
                  | "group_brand")
              : null,
            confidence: "high",
            reason:
              "Explicit first-party identity and relationship selected from supplied candidates.",
          },
          sites,
        );
      } catch {
        return undefined;
      }
    },
    fallback: () =>
      reasonCarrierIdentity(ctx, orgId, carrierName, sites, retrievalText),
  });
}

async function reasonCarrierIdentity(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  carrierName: string,
  sites: CandidateSite[],
  retrievalText: string,
): Promise<GroundedCarrierIdentitySelection> {
  const { output } = await generateObjectForOrg(
    ctx,
    orgId,
    "triage",
    {
      schema: CarrierIdentitySelectionSchema,
      maxOutputTokens: 768,
      prompt: `Judge which candidate, if any, is the official public website for this insurance carrier.

Carrier designation extracted from the policy: ${carrierName}

Candidate websites and first-party evidence:
${JSON.stringify(
  sites.map((site, index) => ({ index, ...site })),
  null,
  2,
)}

Search evidence:
${retrievalText.slice(0, 8_000)}

Make an identity judgment from the meaning of the evidence. Do not treat token overlap, exact word agreement, acronyms, or domain-name similarity as proof. Account for legal suffixes, jurisdictions, inflections, abbreviations, translations, branch designations, syndicates, and concise public names. A shorter public name may identify the same legal entity when first-party evidence explicitly connects them.

Return:
- candidateIndex: the official-site candidate index, or -1 when no candidate is supported confidently.
- officialSite: true only when first-party evidence connects the selected site to this exact carrier, its documented trading name, parent brand, or group brand.
- publicName: the concise public-facing name visibly used in the selected site's siteName or title, or null when the evidence supports the site but no distinct public name.
- nameRelationship: "same_legal_entity" when the public name is the same entity's concise public form; "trading_name" for a documented trading name or DBA; "parent_brand" for a documented parent; "group_brand" for a documented group identity; or null when publicName is null.
- confidence: high only when the relationship is supported by first-party evidence.
- reason: a concise evidence-based explanation.

Keep the extracted carrier designation intact. Do not choose a login portal, broker, agency, directory, social network, news site, or similarly named unrelated company. If the evidence is ambiguous, return candidateIndex -1, officialSite false, and null public fields.`,
    },
    { taskKind: "carrier_identity_selection" },
  );

  return groundCarrierIdentitySelection(output, sites);
}

async function enrichPolicyCarrierIdentity(
  ctx: ActionCtx,
  policyId: Id<"policies">,
): Promise<CarrierIdentityEnrichmentResult> {
  const policy = await ctx.runQuery(internal.policies.getInternal, {
    id: policyId,
  });
  if (!policy?.orgId) return { success: false as const, reason: "not_found" };
  const identity = readCarrierIdentity(policy.carrierIdentity);
  if (
    identity?.branding?.enrichmentVersion ===
    CARRIER_IDENTITY_ENRICHMENT_VERSION
  ) {
    return { success: true as const, cached: true };
  }

  const carrierNames = carrierNamesForPolicy(policy);
  const carrierName = carrierNames[0];
  if (!carrierName) {
    await ctx.runMutation(
      internal.carrierIdentityCache.markPolicyFailedInternal,
      { policyId },
    );
    return { success: false as const, reason: "missing_carrier" };
  }
  const normalizedName = normalizeCarrierIdentityName(carrierName);
  const cachedResult = await applyCachedIdentity(ctx, policyId, normalizedName);
  if (cachedResult.applied) {
    return { success: true as const, cached: true };
  }
  if (cachedResult.identityChanged) {
    await rescheduleChangedCarrierIdentity(ctx, policyId);
    return { success: false as const, reason: "in_progress" };
  }

  const attemptedAt = dayjs().valueOf();
  const attempt = await ctx.runMutation(
    internal.carrierIdentityCache.markPolicyPendingInternal,
    {
      policyId,
      attemptedAt,
      allowReady: true,
    },
  );
  if (attempt === 0) {
    return { success: false as const, reason: "in_progress" };
  }

  try {
    const cachedIdentity = await ctx.runQuery(
      internal.carrierIdentityCache.getByNormalizedNameInternal,
      { normalizedName },
    );
    const retrievals = await Promise.all(
      carrierNames.slice(0, 2).map((researchName) =>
        runWebRetrieval(ctx, policy.orgId!, {
          query: `"${researchName}" official insurer website trading name brand`,
          goal: "Find the insurer's official public website and any official statement connecting the extracted legal insurer, syndicate, or underwriting entity to its trading name, DBA, parent brand, or group brand. Prefer first-party evidence over brokers, directories, social profiles, and news coverage.",
          maxResults: MAX_CANDIDATE_SITES,
        }),
      ),
    );
    const retrievalSources = retrievals.flatMap(
      (retrieval) => retrieval.sources,
    );
    const retrievalText =
      boundedEvidence(retrievals.map((retrieval) => retrieval.text)) ?? "";
    const reusablePreviousSources = reusableCacheSources([cachedIdentity]);
    let sites = await Promise.all(
      candidateUrls(
        [...reusablePreviousSources, ...retrievalSources],
        retrievalText,
      ).map((seed) =>
        inspectCarrierCandidate(ctx, policy.orgId!, carrierName, seed),
      ),
    );
    if (sites.length === 0) throw new Error("No candidate carrier websites");

    let selection = await selectCarrierIdentityWithModel(
      ctx,
      policy.orgId,
      carrierName,
      sites,
      retrievalText,
    );
    let relationshipSourceUrls: string[] = [];
    if (
      selection.publicName &&
      selection.nameRelationship !== "trading_name" &&
      /\b(?:syndicate|managing agency|underwriters)\b/i.test(carrierName)
    ) {
      try {
        const selectedSite = sites[selection.candidateIndex];
        if (!selectedSite) {
          throw new Error(
            "Carrier identity model selected an unavailable website",
          );
        }
        const hostname = new URL(selectedSite.website).hostname;
        const relationshipRetrieval = await runWebRetrieval(ctx, policy.orgId, {
          query: `"${selection.publicName}" "trading name"`,
          goal: `Find a first-party statement on ${hostname} that says whether ${selection.publicName} is a trading name, DBA, or operating name for the extracted legal insurer or syndicate. Return the exact official page, not a directory or news story.`,
          allowedDomains: [hostname],
          maxResults: MAX_CANDIDATE_SITES,
        });
        relationshipSourceUrls = relationshipRetrieval.sources.map(
          (source) => source.url,
        );
        const relationshipSites = await Promise.all(
          candidateUrls(
            relationshipRetrieval.sources,
            relationshipRetrieval.text,
          ).map((seed) =>
            inspectCarrierCandidate(ctx, policy.orgId!, carrierName, seed),
          ),
        );
        const knownSites = new Set(sites.map((site) => site.website));
        sites = [
          ...sites,
          ...relationshipSites.filter((site) => !knownSites.has(site.website)),
        ];
        selection = await selectCarrierIdentityWithModel(
          ctx,
          policy.orgId,
          carrierName,
          sites,
          boundedEvidence([retrievalText, relationshipRetrieval.text]) ??
            retrievalText,
        );
      } catch (error) {
        console.warn(
          "[carrier-identity] targeted relationship selection failed; keeping initial model judgment",
          {
            policyId,
            carrierName,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    const selected = sites[selection.candidateIndex];
    if (!selected) {
      throw new Error("Carrier identity model selected an unavailable website");
    }
    const { publicName, nameRelationship, confidence } = selection;
    const faviconSignals = await readWebsiteFaviconSignals(selected.website);
    const fallbackFaviconColor = faviconSignals.colorCandidates[0];
    const accentColor =
      selected.primaryColor ??
      fallbackFaviconColor ??
      selected.colorCandidates[0];
    const accentColorSource = selected.primaryColor
      ? selected.primaryColorSource
      : fallbackFaviconColor
        ? "favicon"
        : undefined;
    const iconStorageId = faviconSignals.favicon
      ? await ctx.storage.store(faviconSignals.favicon)
      : null;
    const website = normalizePublicWebsiteUrl(new URL(selected.website).origin);
    const cacheEntryId = await ctx.runMutation(
      internal.carrierIdentityCache.upsertInternal,
      {
        normalizedName,
        carrierName,
        publicName,
        nameRelationship,
        website,
        websiteTitle: selected.title,
        iconStorageId: iconStorageId ?? undefined,
        accentColor,
        accentColorSource,
        confidence,
        sourceUrls: Array.from(
          new Set([
            selected.website,
            ...relationshipSourceUrls,
            ...retrievalSources.map((source) => source.url),
          ]),
        ).slice(0, 5),
        enrichmentVersion: CARRIER_IDENTITY_ENRICHMENT_VERSION,
        updatedAt: dayjs().valueOf(),
      },
    );
    const applied = await ctx.runMutation(
      internal.carrierIdentityCache.applyToPolicyInternal,
      { policyId, cacheEntryId, normalizedName },
    );
    if (applied.identityChanged) {
      await rescheduleChangedCarrierIdentity(ctx, policyId);
      return { success: false as const, reason: "in_progress" };
    }
    return { success: applied.applied, cached: false };
  } catch (error) {
    console.warn("[carrier-identity] enrichment failed", {
      policyId,
      carrierName,
      error: error instanceof Error ? error.message : String(error),
    });
    const failureResult = await ctx.runMutation(
      internal.carrierIdentityCache.markPolicyFailedInternal,
      { policyId, normalizedName, attemptedAt },
    );
    if (failureResult.status === "identity_changed") {
      await rescheduleChangedCarrierIdentity(ctx, policyId);
      return { success: false as const, reason: "in_progress" };
    }
    if (failureResult.status === "ready") {
      return { success: true as const, cached: true };
    }
    if (failureResult.status === "superseded") {
      return { success: false as const, reason: "in_progress" };
    }
    const retryDelay = RETRY_DELAYS_MS[attempt - 1];
    if (failureResult.status === "failed" && retryDelay !== undefined) {
      await ctx.scheduler.runAfter(
        retryDelay,
        internal.actions.enrichCarrierIdentity.ensureInternal,
        { policyId },
      );
    }
    return { success: false as const, reason: "lookup_failed" };
  }
}

export const ensureInternal = internalAction({
  args: { policyId: v.id("policies") },
  returns: v.any(),
  handler: async (ctx, args): Promise<CarrierIdentityEnrichmentResult> => {
    return await enrichPolicyCarrierIdentity(ctx, args.policyId);
  },
});
