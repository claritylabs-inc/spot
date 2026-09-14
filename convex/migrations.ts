import { Migrations, type MigrationFunctionReference, type MigrationStatus } from "@convex-dev/migrations";
import { internalMutation, internalQuery } from "./_generated/server";
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
import { reserveLegacyOperatorEmailIdentity } from "./lib/operatorIdentity";
import {
  canonicalPendingEmail,
  canonicalSlackActor,
  canonicalSlackAttachments,
  retiredModelRoute,
  retiredNotificationExpiry,
  retiredOrganizationSettings,
  retiredPolicyChangeReference,
} from "./schemaCleanup";

export const migrations = new Migrations<DataModel>(components.migrations);

export const cleanupOrganizationSettings = migrations.define({
  table: "organizations",
  batchSize: 50,
  migrateOne: (_, row) => retiredOrganizationSettings(row) ?? undefined,
});

export const cleanupPendingEmailStorage = migrations.define({
  table: "pendingEmails",
  batchSize: 8,
  migrateOne: async (_, row) => await canonicalPendingEmail(row) ?? undefined,
});

export const cleanupSlackAttachmentStorage = migrations.define({
  table: "slackInboundEvents",
  batchSize: 8,
  migrateOne: (_, row) => canonicalSlackAttachments(row) ?? undefined,
});

export const cleanupNotificationExpiry = migrations.define({
  table: "notifications",
  batchSize: 50,
  migrateOne: (_, row) => retiredNotificationExpiry(row) ?? undefined,
});

export const cleanupThreadPolicyChangeReferences = migrations.define({
  table: "threadMessages",
  batchSize: 8,
  migrateOne: (_, row) => retiredPolicyChangeReference(row) ?? undefined,
});

export const cleanupHoldPolicyChangeReferences = migrations.define({
  table: "certificateRequestHolds",
  batchSize: 8,
  migrateOne: (_, row) => retiredPolicyChangeReference(row) ?? undefined,
});

export const cleanupCardPolicyChangeReferences = migrations.define({
  table: "appCardAccessLinks",
  batchSize: 50,
  migrateOne: (_, row) => retiredPolicyChangeReference(row) ?? undefined,
});

export const cleanupRetiredModelRoute = migrations.define({
  table: "globalModelSettings",
  batchSize: 25,
  migrateOne: (_, row) => retiredModelRoute(row) ?? undefined,
});

const schemaCleanupMigrations: MigrationFunctionReference[] = [
  internal.migrations.cleanupOrganizationSettings,
  internal.migrations.cleanupPendingEmailStorage,
  internal.migrations.cleanupSlackAttachmentStorage,
  internal.migrations.cleanupNotificationExpiry,
  internal.migrations.cleanupThreadPolicyChangeReferences,
  internal.migrations.cleanupHoldPolicyChangeReferences,
  internal.migrations.cleanupCardPolicyChangeReferences,
  internal.migrations.cleanupRetiredModelRoute,
  internal.migrations.backfillSlackActorSpotIdentity,
];

export const runSchemaCleanup = migrations.runner(schemaCleanupMigrations);

export const schemaCleanupStatus = internalQuery({
  args: {},
  handler: (ctx): Promise<MigrationStatus[]> => migrations.getStatus(ctx, { migrations: schemaCleanupMigrations }),
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
  migrateOne: (_, row) => canonicalSlackActor(row) ?? undefined,
});

export const runDeclarationFactsBackfill = migrations.runner([
  internal.migrations.backfillDeclarationFacts,
  internal.migrations.syncDeclarationFactProfiles,
]);

export const runCarrierIdentityBackfill = migrations.runner([
  internal.migrations.rebuildCarrierIdentitiesFromStoredSources,
]);

export const runSlackInboundEventMentionsSpotBackfill = migrations.runner([
  internal.migrations.backfillSlackInboundEventMentionsSpot,
]);

export const runSlackActorSpotIdentityBackfill = migrations.runner([
  internal.migrations.backfillSlackActorSpotIdentity,
]);
