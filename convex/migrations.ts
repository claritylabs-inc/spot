import { Migrations } from "@convex-dev/migrations";
import dayjs from "dayjs";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { effectiveExtractionDataStage } from "./backfillDeclarationFacts";
import { recordCarrierIdentityBackfillResult } from "./carrierIdentityBackfill";
import { replacePolicyDeclarationFacts } from "./declarationFacts";
import { carrierIdentityBackfillSkipReason } from "./lib/carrierIdentityBackfill";
import {
  applyCarrierIdentityEnrichment,
  readCarrierIdentity,
} from "./lib/carrierIdentity";

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillDeclarationFacts = migrations.define({
  table: "policies",
  batchSize: 10,
  migrateOne: async (ctx, policy) => {
    if (!policy.orgId || effectiveExtractionDataStage(policy) !== "final") {
      return;
    }
    await replacePolicyDeclarationFacts(ctx, policy._id);
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

export const runDeclarationFactsBackfill = migrations.runner([
  internal.migrations.backfillDeclarationFacts,
]);

export const runCarrierIdentityBackfill = migrations.runner([
  internal.migrations.rebuildCarrierIdentitiesFromStoredSources,
]);
