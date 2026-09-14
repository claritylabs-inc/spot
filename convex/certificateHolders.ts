import dayjs from "dayjs";
import { readHolderNotes, saveHolderNotes } from "./certificateNotes";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  assertCanReadPolicies,
  getOrgAccess,
} from "./lib/access";
import {
  normalizeCertificateHolderAddress,
  normalizeCertificateHolderContactName,
  normalizeCertificateHolderEmail,
  normalizeCertificateHolderName,
} from "./lib/certificateIdentity";
import { parseCertificateHolderCandidates } from "./lib/certificateHolderPopulation";

const addressValidator = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  country: v.optional(v.string()),
  formatted: v.optional(v.string()),
});

const sourceValidator = v.union(
  v.literal("manual"),
  v.literal("extraction"),
  v.literal("certificate_generation"),
  v.literal("migration"),
  v.literal("api"),
  v.literal("mcp"),
  v.literal("agent"),
);

type ReadCtx = QueryCtx | MutationCtx;

function cleanOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

async function findExistingHolder(
  ctx: ReadCtx,
  args: {
    orgId: Id<"organizations">;
    normalizedName: string;
    normalizedEmail?: string;
    normalizedAddressKey?: string;
  },
) {
  if (args.normalizedEmail) {
    const byEmail = await ctx.db
      .query("certificateHolders")
      .withIndex("organization_email", (q) =>
        q.eq("orgId", args.orgId).eq("normalizedEmail", args.normalizedEmail),
      )
      .first();
    if (byEmail) return byEmail;
  }

  const named = await ctx.db
    .query("certificateHolders")
    .withIndex("organization_name", (q) =>
      q.eq("orgId", args.orgId).eq("normalizedName", args.normalizedName),
    )
    .collect();
  if (args.normalizedAddressKey) {
    return (
      named.find(
        (holder: Doc<"certificateHolders">) =>
          holder.normalizedAddressKey === args.normalizedAddressKey,
      ) ?? null
    );
  }
  return (
    named.find(
      (holder: Doc<"certificateHolders">) => !holder.normalizedAddressKey,
    ) ?? (named.length === 1 ? named[0] : null)
  );
}

export const listForOrg = query({
  args: {
    orgId: v.id("organizations"),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getOrgAccess(ctx, args.orgId, { allowOperator: true });
    assertCanReadPolicies(access);
    const rows = await ctx.db
      .query("certificateHolders")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .collect();
    const holders = await Promise.all(rows.map(async (holder) => ({
      ...holder, notes: await readHolderNotes(ctx, holder, access.accessType === "operator"),
    })));
    const needle = normalizeCertificateHolderName(args.query ?? "");
    if (!needle)
      return holders.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return holders
      .filter(
        (holder) =>
          holder.normalizedName.includes(needle) ||
          normalizeCertificateHolderName(holder.contactName ?? "").includes(
            needle,
          ) ||
          holder.normalizedEmail?.includes(needle) ||
          holder.normalizedAddressKey?.includes(needle),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export const listForOrgInternal = internalQuery({
  args: {
    orgId: v.id("organizations"),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("certificateHolders")
      .withIndex("organization", (q) => q.eq("orgId", args.orgId))
      .collect();
    const holders = await Promise.all(rows.map(async (holder) => ({
      ...holder, notes: await readHolderNotes(ctx, holder),
    })));
    const needle = normalizeCertificateHolderName(args.query ?? "");
    const filtered = needle
      ? holders.filter(
          (holder) =>
            holder.normalizedName.includes(needle) ||
            normalizeCertificateHolderName(holder.contactName ?? "").includes(
              needle,
            ) ||
            holder.normalizedEmail?.includes(needle) ||
            holder.normalizedAddressKey?.includes(needle),
        )
      : holders;
    return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

export async function upsertCertificateHolder(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    displayName: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
      formatted?: string;
    };
    mapboxFeatureId?: string;
    mapboxMetadata?: unknown;
    source:
      | "manual"
      | "extraction"
      | "certificate_generation"
      | "migration"
      | "api"
      | "mcp"
      | "agent";
    sourceRef?: string;
    notes?: string;
    createdByUserId?: Id<"users">;
    updatedByUserId?: Id<"users">;
  },
) {
  const displayName = args.displayName.trim();
  if (!displayName) throw new Error("Certificate holder name is required.");
  const normalizedName = normalizeCertificateHolderName(displayName);
  const normalizedEmail = normalizeCertificateHolderEmail(args.email);
  const normalizedAddressKey = normalizeCertificateHolderAddress(args.address);
  const existing = await findExistingHolder(ctx, {
    orgId: args.orgId,
    normalizedName,
    normalizedEmail,
    normalizedAddressKey,
  });
  const now = dayjs().valueOf();
  const preserveExistingOptionalFields =
    Boolean(existing) &&
    (args.source === "certificate_generation" || args.source === "extraction");
  const patch = {
    displayName,
    normalizedName,
    contactName:
      normalizeCertificateHolderContactName(args.contactName) ??
      (preserveExistingOptionalFields ? existing?.contactName : undefined),
    email:
      cleanOptional(args.email) ??
      (preserveExistingOptionalFields ? existing?.email : undefined),
    normalizedEmail:
      normalizedEmail ??
      (preserveExistingOptionalFields ? existing?.normalizedEmail : undefined),
    phone:
      cleanOptional(args.phone) ??
      (preserveExistingOptionalFields ? existing?.phone : undefined),
    address:
      args.address ??
      (preserveExistingOptionalFields ? existing?.address : undefined),
    normalizedAddressKey:
      normalizedAddressKey ??
      (preserveExistingOptionalFields
        ? existing?.normalizedAddressKey
        : undefined),
    mapboxFeatureId: cleanOptional(args.mapboxFeatureId),
    mapboxMetadata: args.mapboxMetadata,
    source: args.source,
    sourceRef: args.sourceRef,
    updatedByUserId: args.updatedByUserId,
    updatedAt: now,
  };
  const holderId = existing?._id ?? await ctx.db.insert("certificateHolders", {
    orgId: args.orgId,
    ...patch,
    createdByUserId: args.createdByUserId,
    createdAt: now,
  });
  if (existing) await ctx.db.patch(holderId, patch);
  if (args.notes !== undefined) {
    const holder = await ctx.db.get(holderId);
    if (holder) await saveHolderNotes(ctx, holder, args.notes, { actorUserId: args.updatedByUserId ?? args.createdByUserId });
  }
  return holderId;
}

export const upsertInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    displayName: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(addressValidator),
    mapboxFeatureId: v.optional(v.string()),
    mapboxMetadata: v.optional(v.any()),
    source: sourceValidator,
    sourceRef: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    updatedByUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    return await upsertCertificateHolder(ctx, args);
  },
});

async function upsertPolicyLink(
  ctx: MutationCtx,
  args: {
    orgId: Id<"organizations">;
    holderId: Id<"certificateHolders">;
    policyId: Id<"policies">;
    policyVersionId?: Id<"policyVersions">;
    relationshipKind:
      | "additional_insured"
      | "loss_payee"
      | "mortgagee"
      | "allowed_holder";
    status?: "current" | "historical" | "review_required" | "dismissed";
    sourceNodeIds?: string[];
    sourceSpanIds?: string[];
    sourceSummary?: string;
    createdByUserId?: Id<"users">;
    updatedByUserId?: Id<"users">;
  },
) {
  const existing = await ctx.db
    .query("certificateHolderPolicyLinks")
    .withIndex("policy", (q) => q.eq("policyId", args.policyId))
    .collect();
  const match = existing.find(
    (link) =>
      link.holderId === args.holderId &&
      link.relationshipKind === args.relationshipKind &&
      link.policyVersionId === args.policyVersionId,
  );
  const now = dayjs().valueOf();
  const patch = {
    status: args.status ?? "current",
    sourceNodeIds: args.sourceNodeIds,
    sourceSpanIds: args.sourceSpanIds,
    sourceSummary: args.sourceSummary,
    updatedByUserId: args.updatedByUserId,
    updatedAt: now,
  };
  if (match) {
    await ctx.db.patch(match._id, patch);
    return match._id;
  }
  return await ctx.db.insert("certificateHolderPolicyLinks", {
    orgId: args.orgId,
    holderId: args.holderId,
    policyId: args.policyId,
    policyVersionId: args.policyVersionId,
    relationshipKind: args.relationshipKind,
    createdByUserId: args.createdByUserId,
    createdAt: now,
    ...patch,
  });
}

export const populateForPolicyInternal = internalMutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, args) => {
    const policy = await ctx.db.get(args.policyId);
    if (!policy?.orgId || policy.deletedAt) {
      return { holderCount: 0, linkCount: 0 };
    }

    const policyVersionId = policy.currentPolicyVersionId;
    const candidates = parseCertificateHolderCandidates({
      operationalProfile: policy.operationalProfile,
      policy,
    });
    let holderCount = 0;
    let linkCount = 0;
    for (const candidate of candidates) {
      const holderId = await upsertCertificateHolder(ctx, {
        orgId: policy.orgId,
        displayName: candidate.displayName,
        email: candidate.email,
        phone: candidate.phone,
        address: candidate.address,
        mapboxMetadata: candidate.mapboxMetadata,
        source: "extraction",
        sourceRef: String(args.policyId),
      });
      holderCount += 1;
      await upsertPolicyLink(ctx, {
        orgId: policy.orgId,
        holderId,
        policyId: args.policyId,
        policyVersionId,
        relationshipKind: candidate.relationshipKind,
        status: "current",
        sourceNodeIds: candidate.sourceNodeIds,
        sourceSpanIds: candidate.sourceSpanIds,
        sourceSummary: candidate.sourceSummary,
      });
      linkCount += 1;
    }
    return { holderCount, linkCount };
  },
});

export const getInternal = internalQuery({
  args: { holderId: v.id("certificateHolders") },
  handler: async (ctx, args) => {
    const holder = await ctx.db.get(args.holderId);
    return holder ? { ...holder, notes: await readHolderNotes(ctx, holder) } : null;
  },
});
