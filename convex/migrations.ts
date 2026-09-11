import { Migrations } from "@convex-dev/migrations";
import dayjs from "dayjs";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { effectiveExtractionDataStage } from "./backfillDeclarationFacts";
import { recordCarrierIdentityBackfillResult } from "./carrierIdentityBackfill";
import { replacePolicyDeclarationFacts } from "./declarationFacts";
import { carrierIdentityBackfillSkipReason } from "./lib/carrierIdentityBackfill";
import { syncOrgProfileFromDeclarationFacts } from "./lib/orgProfileFacts";
import {
  applyCarrierIdentityEnrichment,
  readCarrierIdentity,
} from "./lib/carrierIdentity";
import {
  requestNarrative,
  seedNarrativePacketSection,
} from "./lib/procurementNarrative";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillDeclarationFacts = migrations.define({
  table: "policies",
  batchSize: 10,
  migrateOne: async (ctx, policy) => {
    if (!policy.orgId || effectiveExtractionDataStage(policy) !== "final") {
      return;
    }
    await replacePolicyDeclarationFacts(ctx, policy._id, undefined, false);
  },
});

export const syncDeclarationFactProfiles = migrations.define({
  table: "organizations",
  batchSize: 10,
  migrateOne: async (ctx, org) => {
    await syncOrgProfileFromDeclarationFacts(ctx, org._id);
  },
});

export const consolidateCarrierIdentityBranding = migrations.define({
  table: "policies",
  batchSize: 25,
  migrateOne: async (ctx, policy) => {
    if (!policy.carrierBrandId) return;
    const identity = readCarrierIdentity(policy.carrierIdentity);
    const cachedIdentity = await ctx.db.get(policy.carrierBrandId);
    if (!identity || !cachedIdentity) return;

    const carrierIdentity = applyCarrierIdentityEnrichment(identity, {
      publicName: cachedIdentity.publicName,
      nameRelationship: cachedIdentity.nameRelationship,
      website: cachedIdentity.website,
      websiteTitle: cachedIdentity.websiteTitle,
      iconStorageId: cachedIdentity.iconStorageId,
      accentColor: cachedIdentity.accentColor,
      accentColorSource: cachedIdentity.accentColorSource,
      confidence: cachedIdentity.confidence,
      sourceUrls: cachedIdentity.sourceUrls,
      enrichmentVersion: cachedIdentity.enrichmentVersion ?? 0,
      updatedAt: cachedIdentity.updatedAt,
    });
    await ctx.db.patch(policy._id, {
      carrier: carrierIdentity.displayName,
      carrierIdentity,
      carrierIdentityEnrichmentStatus: "ready",
      carrierBrandId: undefined,
      carrierBrandStatus: undefined,
      carrierBrandAttempts: undefined,
      carrierBrandAttemptedAt: undefined,
    });
  },
});

// Write phase only. Audit actual stored-evidence decisions first through
// actions/backfillCarrierIdentity:audit; migration dry-run rolls back scheduling.
export const rebuildCarrierIdentitiesFromStoredSources = migrations.define({
  table: "policies",
  batchSize: 1,
  migrateOne: async (ctx, policy) => {
    const now = dayjs().valueOf();
    const skipReason = carrierIdentityBackfillSkipReason(policy);
    if (skipReason) {
      await recordCarrierIdentityBackfillResult(
        ctx,
        policy._id,
        {
          outcome: "skipped",
          reason: skipReason,
          shouldEnrich: false,
        },
        now,
      );
      return;
    }
    await recordCarrierIdentityBackfillResult(
      ctx,
      policy._id,
      {
        outcome: "pending",
        reason: "source_evidence_paging",
        shouldEnrich: false,
      },
      now,
    );
    await ctx.scheduler.runAfter(
      0,
      internal.actions.backfillCarrierIdentity.rebuildOne,
      { policyId: policy._id },
    );
  },
});

export const unsetLegacyCoiAttachmentAuthorization = migrations.define({
  table: "pendingEmails",
  batchSize: 100,
  migrateOne: async (ctx, pendingEmail) => {
    if (pendingEmail.allowMultipleCoiAttachments === undefined) return;
    await ctx.db.patch(pendingEmail._id, {
      allowMultipleCoiAttachments: undefined,
    });
  },
});

export const unsetLegacyBrokerModelProviderKeys = migrations.define({
  table: "brokerModelSettings",
  batchSize: 100,
  migrateOne: async (ctx, settings) => {
    if (settings.providerKeys === undefined) return;
    await ctx.db.patch(settings._id, { providerKeys: undefined });
  },
});

export const backfillSlackInboundEventMentionsSpot = migrations.define({
  table: "slackInboundEvents",
  batchSize: 100,
  migrateOne: async (ctx, event) => {
    if (event.mentionsSpot !== undefined && event.mentionsGlass === undefined) {
      return;
    }
    await ctx.db.patch(event._id, {
      mentionsSpot: event.mentionsSpot ?? event.mentionsGlass ?? false,
      mentionsGlass: undefined,
    });
  },
});

export const backfillSlackActorSpotIdentity = migrations.define({
  table: "slackActors",
  batchSize: 100,
  migrateOne: async (ctx, actor) => {
    if (
      actor.classification !== "glass_operator" &&
      actor.glassUserId === undefined
    ) {
      return;
    }
    await ctx.db.patch(actor._id, {
      classification:
        actor.classification === "glass_operator"
          ? "spot_operator"
          : actor.classification,
      spotUserId: actor.spotUserId ?? actor.glassUserId,
      glassUserId: undefined,
    });
  },
});

export const migrateProcurementRequestStatuses = migrations.define({
  table: "procurementRequests",
  batchSize: 50,
  migrateOne: async (ctx, request) => {
    const mapped =
      request.status === "quote_review" || request.status === "client_decision"
        ? ("proposal_review" as const)
        : request.status === "accepted"
          ? ("binding" as const)
          : request.status === "closed"
            ? ("completed" as const)
            : request.status;
    const patch: Record<string, unknown> = {};
    if (mapped !== request.status) patch.status = mapped;
    if (request.requirementRevision === undefined)
      patch.requirementRevision = 0;
    if (request.specificationRevision === undefined)
      patch.specificationRevision = 0;
    if (request.clientVisible === undefined) patch.clientVisible = false;
    if (Object.keys(patch).length) await ctx.db.patch(request._id, patch);
  },
});

// Prefer the prior original narrative, then the request summary. The legacy
// requirements field is a fallback because it may contain operator-authored
// prose rather than the client's words.
export const backfillProcurementNarrative = migrations.define({
  table: "procurementRequests",
  batchSize: 50,
  migrateOne: async (ctx, request) => {
    const patch: Record<string, unknown> = {};
    if (request.narrative === undefined) {
      const narrative =
        request.originalNarrative?.trim() ||
        request.requestSummary?.trim() ||
        request.requirements?.trim() ||
        request.title;
      patch.narrative = narrative;
    }
    if (request.requestSummary !== undefined) patch.requestSummary = undefined;
    if (request.requirements !== undefined) patch.requirements = undefined;
    if (request.originalNarrative !== undefined)
      patch.originalNarrative = undefined;
    if (request.createdBySide !== undefined) patch.createdBySide = undefined;
    if (request.sharedAt !== undefined) patch.sharedAt = undefined;
    if (Object.keys(patch).length) await ctx.db.patch(request._id, patch);
  },
});

export const seedProcurementNarrativeSections = migrations.define({
  table: "procurementRequests",
  batchSize: 25,
  migrateOne: async (ctx, request) => {
    await seedNarrativePacketSection(ctx, {
      requestId: request._id,
      clientOrgId: request.clientOrgId,
      narrative: requestNarrative(request),
      userId: request.createdByUserId,
      source: "manual",
    });
  },
});

function normalizedBrokerName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const migrateProcurementOutreaches = migrations.define({
  table: "procurementBrokerOutreaches",
  batchSize: 10,
  migrateOne: async (ctx, outreach) => {
    let brokerOrgId = outreach.brokerOrgId;
    if (!brokerOrgId) {
      const brokers = await ctx.db
        .query("organizations")
        .withIndex("type", (q) => q.eq("type", "broker"))
        .collect();
      const matches = brokers.filter(
        (broker) =>
          normalizedBrokerName(broker.name) ===
          normalizedBrokerName(outreach.brokerName),
      );
      if (matches.length > 1)
        throw new Error(`Ambiguous legacy broker name: ${outreach.brokerName}`);
      if (matches.length === 1) brokerOrgId = matches[0]._id;
      else {
        brokerOrgId = await ctx.db.insert("organizations", {
          name: outreach.brokerName,
          type: "broker",
          operatorStatus: "live",
          onboardingComplete: true,
        });
        await ctx.db.insert("brokerProfiles", {
          brokerOrgId,
          networkStatus: "prospect",
          writingStates: [],
          lineOfBusinessCodes: [],
          createdByUserId: outreach.createdByUserId,
          updatedByUserId: outreach.updatedByUserId,
          createdAt: outreach.createdAt,
          updatedAt: outreach.updatedAt,
        });
      }
    }
    const patch: Record<string, unknown> = { brokerOrgId };
    if (!outreach.contactSnapshot)
      patch.contactSnapshot = {
        name: outreach.contactName,
        email: outreach.contactEmail,
        phone: outreach.contactPhone,
      };
    await ctx.db.patch(outreach._id, patch);
    const quoteFiles = await ctx.db
      .query("procurementFileItems")
      .withIndex("outreach", (q) => q.eq("outreachId", outreach._id))
      .collect();
    const hasLegacyQuote = Boolean(
      outreach.quoteSummary ||
      outreach.quoteAmount !== undefined ||
      outreach.quoteUrl ||
      quoteFiles.some((file) => file.purpose === "quote"),
    );
    if (!hasLegacyQuote) return;
    const existing = await ctx.db
      .query("procurementProposals")
      .withIndex("outreach", (q) => q.eq("outreachId", outreach._id))
      .first();
    if (existing) return;
    await ctx.db.insert("procurementProposals", {
      requestId: outreach.requestId,
      clientOrgId: outreach.clientOrgId,
      brokerOrgId,
      outreachId: outreach._id,
      status: "draft",
      extractedOffer: {
        legacyQuoteSummary: outreach.quoteSummary,
        premiumAmount: outreach.quoteAmount,
        currency: outreach.quoteCurrency,
        quoteUrl: outreach.quoteUrl,
      },
      createdByUserId: outreach.createdByUserId,
      updatedByUserId: outreach.updatedByUserId,
      createdAt: outreach.createdAt,
      updatedAt: outreach.updatedAt,
    });
  },
});

export const purgePolicyDeliverySettings = migrations.define({
  table: "policyDeliverySettings",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(row._id);
  },
});
export const purgePolicyDeliveryRules = migrations.define({
  table: "policyDeliveryRules",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(row._id);
  },
});
export const purgePolicyDeliveryJobs = migrations.define({
  table: "policyDeliveryJobs",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(row._id);
  },
});
export const purgePolicyDeliveryAttempts = migrations.define({
  table: "policyDeliveryAttempts",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(row._id);
  },
});
// Broker/client ownership assignments are retired. Keep the table available
// until the narrowing release, but remove any legacy rows in the gated purge.
export const purgeBrokerClientAssignments = migrations.define({
  table: "brokerClientAssignments",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(row._id);
  },
});
export const purgeBrokerBranding = migrations.define({
  table: "organizations",
  batchSize: 50,
  migrateOne: async (ctx, org) => {
    if (org.type !== "broker") return;
    await ctx.db.patch(org._id, {
      whiteLabelingEnabled: undefined,
      brandingColor: undefined,
      brandingMode: undefined,
      brandingTextOnAccent: undefined,
      agentDisplayName: undefined,
    });
  },
});

// The curated per-org store is now `orgWikiSections`. These retire the row
// stores it replaced, plus the two legacy fields that referenced them, so the
// narrowing release can drop the tables and fields outright.
export const purgeOrgMemory = migrations.define({
  table: "orgMemory",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(row._id);
  },
});
export const purgeProcurementMemory = migrations.define({
  table: "procurementMemory",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(row._id);
  },
});
export const unsetConnectedEmailAutomationMemoryIds = migrations.define({
  table: "connectedEmailAutomationItems",
  batchSize: 100,
  migrateOne: async (ctx, row) => {
    if (!row.memoryIds) return;
    await ctx.db.patch(row._id, { memoryIds: undefined });
  },
});
// Procurement learnings no longer have their own store, and organization facts
// stored before the wiki gained sections belong in the general profile section.
export const backfillCompanyInformationFactSections = migrations.define({
  table: "companyInformationExtractions",
  batchSize: 50,
  migrateOne: async (ctx, row) => {
    const needsSections = row.organizationFacts?.some((fact) => !fact.section);
    if (!needsSections && !row.procurementFacts) return;
    await ctx.db.patch(row._id, {
      organizationFacts: row.organizationFacts?.map((fact) => ({
        ...fact,
        section: fact.section ?? ("profile" as const),
      })),
      procurementFacts: undefined,
    });
  },
});

export const runDeclarationFactsBackfill = migrations.runner([
  internal.migrations.backfillDeclarationFacts,
  internal.migrations.syncDeclarationFactProfiles,
]);

export const runCarrierIdentityBackfill = migrations.runner([
  internal.migrations.rebuildCarrierIdentitiesFromStoredSources,
]);

export const runLegacyCoiAttachmentAuthorizationCleanup = migrations.runner([
  internal.migrations.unsetLegacyCoiAttachmentAuthorization,
]);

export const runLegacyBrokerModelProviderKeyCleanup = migrations.runner([
  internal.migrations.unsetLegacyBrokerModelProviderKeys,
]);

export const runSlackInboundEventMentionsSpotBackfill = migrations.runner([
  internal.migrations.backfillSlackInboundEventMentionsSpot,
]);

export const runSlackActorSpotIdentityBackfill = migrations.runner([
  internal.migrations.backfillSlackActorSpotIdentity,
]);

export const runProcurementDomainBackfill = migrations.runner([
  internal.migrations.migrateProcurementRequestStatuses,
  internal.migrations.migrateProcurementOutreaches,
]);

// Pre-packet reviews cannot be confirmed because they scored the retired
// requirement/specification rows.
export const clearLegacyProposalReviews = migrations.define({
  table: "procurementProposalReviews",
  batchSize: 50,
  migrateOne: async (ctx, review) => {
    if (review.packetRevision !== undefined) return;
    await ctx.db.delete(review._id);
  },
});

// Run before the release that drops `requirementRevision` and
// `specificationRevision` from procurementProposalReviews and
// procurementRequests, and makes `packetRevision` required on reviews.
export const runProposalReviewPacketBackfill = migrations.runner([
  internal.migrations.clearLegacyProposalReviews,
]);

// Run before the release that drops `requestSummary`, `requirements`,
// `originalNarrative`, `createdBySide`, and `sharedAt` from the schema and
// makes `narrative` required.
export const runProcurementNarrativeBackfill = migrations.runner([
  internal.migrations.backfillProcurementNarrative,
  internal.migrations.seedProcurementNarrativeSections,
]);

// Run only after procurementMigration.auditLegacyNarrowing reports safe=true.
export const runProcurementLegacyPurge = migrations.runner([
  internal.migrations.purgeBrokerClientAssignments,
  internal.migrations.purgePolicyDeliveryAttempts,
  internal.migrations.purgePolicyDeliveryJobs,
  internal.migrations.purgePolicyDeliveryRules,
  internal.migrations.purgePolicyDeliverySettings,
  internal.migrations.purgeBrokerBranding,
]);


// Run before the release that drops `orgMemory`, `procurementMemory`,
// `connectedEmailAutomationItems.memoryIds`, and
// `companyInformationExtractions.procurementFacts` from the schema.
export const runCompanyWikiLegacyPurge = migrations.runner([
  internal.migrations.backfillCompanyInformationFactSections,
  internal.migrations.unsetConnectedEmailAutomationMemoryIds,
  internal.migrations.purgeProcurementMemory,
  internal.migrations.purgeOrgMemory,
]);
