import { Migrations } from "@convex-dev/migrations";
import { internalMutation, internalQuery } from "./_generated/server";
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
import { reserveLegacyOperatorEmailIdentity } from "./lib/operatorIdentity";

export const migrations = new Migrations<DataModel>(components.migrations);

export const simplifyProcurementFiles = migrations.define({
  table: "procurementFileItems",
  batchSize: 100,
  migrateOne: async (ctx, item) => {
    // Removing a broker-specific scope must never grant access to every broker.
    if (
      item.outreachId &&
      item.brokerRelease &&
      item.brokerRelease !== "hidden"
    ) {
      const request = await ctx.db.get(item.requestId);
      if (request) {
        await ctx.db.patch(request._id, {
          packetRevision: (request.packetRevision ?? 0) + 1,
          updatedAt: dayjs().valueOf(),
        });
      }
    }
    return {
      purpose: undefined,
      status: undefined,
      outreachId: undefined,
      brokerReleaseProposed: undefined,
      ...(item.outreachId ? { brokerRelease: "hidden" as const } : {}),
    };
  },
});

export const backfillOperatorUserEmailIdentities = migrations.define({
  table: "users",
  batchSize: 100,
  migrateOne: async (ctx, user) => {
    await reserveLegacyOperatorEmailIdentity(ctx, user.email, user._id);
  },
});

export const backfillOperatorProfileEmailIdentities = migrations.define({
  table: "operatorProfiles",
  batchSize: 100,
  migrateOne: async (ctx, profile) => {
    await reserveLegacyOperatorEmailIdentity(
      ctx,
      profile.email,
      profile.userId,
    );
  },
});

export const backfillOperatorAuthEmailIdentities = migrations.define({
  table: "authAccounts",
  batchSize: 100,
  migrateOne: async (ctx, account) => {
    if (account.provider === "resend-otp") {
      await reserveLegacyOperatorEmailIdentity(
        ctx,
        account.providerAccountId,
        account.userId,
      );
    }
  },
});

const operatorIdentityMigrations = [
  internal.migrations.backfillOperatorUserEmailIdentities,
  internal.migrations.backfillOperatorProfileEmailIdentities,
  internal.migrations.backfillOperatorAuthEmailIdentities,
];

export const runOperatorEmailIdentityBackfill = migrations.runner(
  operatorIdentityMigrations,
);

export const operatorEmailIdentityBackfillStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const statuses = await migrations.getStatus(ctx, {
      migrations: operatorIdentityMigrations,
    });
    const ready = await ctx.db
      .query("operatorEmailIdentityBackfill")
      .withIndex("key", (q) => q.eq("key", "legacy"))
      .unique();
    return { ready: !!ready, statuses };
  },
});

export const finishOperatorEmailIdentityBackfill = internalMutation({
  args: {},
  handler: async (ctx) => {
    const statuses = await migrations.getStatus(ctx, {
      migrations: operatorIdentityMigrations,
    });
    if (statuses.length !== 3 || statuses.some((status) => !status.isDone)) {
      throw new Error(
        "Complete all operator email identity migrations before enabling alias login.",
      );
    }
    const existing = await ctx.db
      .query("operatorEmailIdentityBackfill")
      .withIndex("key", (q) => q.eq("key", "legacy"))
      .unique();
    if (!existing) {
      await ctx.db.insert("operatorEmailIdentityBackfill", {
        key: "legacy",
        completedAt: dayjs().valueOf(),
      });
    }
    return { ready: true };
  },
});

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

export const removeCompanyDetails = migrations.define({
  table: "organizations",
  batchSize: 10,
  migrateOne: async (ctx, org) => {
    await ctx.db.patch(org._id, {
      industry: undefined,
      industryVertical: undefined,
      mailingAddress: undefined,
      profileFacts: undefined,
      profileFactsUpdatedAt: undefined,
      profileOverrides: undefined,
      profileOverridesUpdatedAt: undefined,
      profileOverridesUpdatedByUserId: undefined,
      relatedLegalEntities: undefined,
    });
  },
});

export const removeCompanyExtractionProfiles = migrations.define({
  table: "companyInformationExtractions",
  batchSize: 100,
  migrateOne: async () => ({ profile: undefined }),
});

export const removeStructuredCompanyDetails = migrations.runner([
  internal.migrations.removeCompanyDetails,
  internal.migrations.removeCompanyExtractionProfiles,
]);

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
